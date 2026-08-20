// =====================
// BP 会话状态流转纯函数（可测试）
// 开始 → 推进 → 完成 / 回退 / 交换先手 / 重置
// =====================

import type { BOType } from "./rule-engine";
import type { ScheduleMatch } from "./schedule-data";
import {
  buildBPOrder,
  bpResultMaps,
  currentStep,
  isBPComplete,
  remainingMaps,
  type BPAction,
  type BPStep,
} from "./bp";

export type BPSessionStatus = "进行中" | "已完成";

export interface BPSession {
  id: string; // BP-<matchId>
  matchId: string;
  boType: BOType;
  firstTeamId: string; // 先手方队伍 ID
  firstTeamSide: "A" | "B"; // 先手方在对阵中的原始侧
  firstTeamName: string;
  secondTeamId: string;
  secondTeamName: string;
  order: BPStep[];
  actions: BPAction[];
  status: BPSessionStatus;
  startedAt: string;
  completedAt?: string;
  finalMaps?: string[]; // 完成后写入的比赛地图
}

/** BP 存储：按 matchId 索引的会话表 */
export type BPStore = Record<string, BPSession>;

export interface BPInput {
  match: ScheduleMatch;
  pool: string[];
}

export interface BPOpResult {
  ok: boolean;
  message?: string;
  session?: BPSession;
  finalMaps?: string[];
}

/** 比赛是否具备 BP 条件（已排期、双方真实队伍、无已完成会话） */
export function canStartBP(match: ScheduleMatch, store: BPStore): { ok: boolean; message?: string } {
  if (!match || match.status !== "已排期") {
    return { ok: false, message: "比赛尚未排期或已结束，不能进行 BP" };
  }
  if (match.frozen) {
    return { ok: false, message: "比赛处于冻结状态，须先解冻" };
  }
  if (match.teamAId === "TBD" || match.teamBId === "TBD") {
    return { ok: false, message: "对阵队伍尚未确定" };
  }
  const existing = store[match.id];
  if (existing && existing.status === "已完成") {
    return { ok: false, message: "本场比赛已完成 BP，不能重新开始" };
  }
  return { ok: true };
}

/** 开始 BP：创建会话（已存在进行中会话时返回该会话） */
export function startBP(
  store: BPStore,
  input: BPInput,
): BPOpResult {
  const guard = canStartBP(input.match, store);
  if (!guard.ok) return guard;

  const existing = store[input.match.id];
  if (existing) return { ok: true, session: existing };

  const order = buildBPOrder(input.match.boType, input.pool.length);
  if (order.length === 0) {
    return { ok: false, message: `地图池不足（${input.pool.length} 张），无法进行 ${input.match.boType} 的 BP` };
  }

  const firstTeamSide: "A" | "B" = input.match.teamAId && input.match.teamAId !== "TBD" ? "A" : "B";
  const session: BPSession = {
    id: `BP-${input.match.id}`,
    matchId: input.match.id,
    boType: input.match.boType,
    firstTeamId: firstTeamSide === "A" ? input.match.teamAId : input.match.teamBId,
    firstTeamSide,
    firstTeamName: firstTeamSide === "A" ? input.match.teamAName : input.match.teamBName,
    secondTeamId: firstTeamSide === "A" ? input.match.teamBId : input.match.teamAId,
    secondTeamName: firstTeamSide === "A" ? input.match.teamBName : input.match.teamAName,
    order,
    actions: [],
    status: "进行中",
    startedAt: new Date().toISOString(),
  };
  return { ok: true, session };
}

/** 推进一步：按当前步骤 Ban/Pick 一张可选地图；全部完成后推导最终地图 */
export function advanceBP(
  session: BPSession,
  input: { mapId: string; operatorRole: "team" | "referee" },
  pool: string[],
): BPOpResult {
  if (session.status !== "进行中") {
    return { ok: false, message: "BP 已结束，不能继续操作" };
  }
  const step = currentStep(session.order, session.actions);
  if (!step) {
    return { ok: false, message: "BP 已完成，不能继续操作" };
  }
  const mapId = input.mapId;
  if (!pool.includes(mapId)) {
    return { ok: false, message: "该地图不在当前地图池中" };
  }
  if (!remainingMaps(pool, session.actions).includes(mapId)) {
    return { ok: false, message: "该地图已被 Ban 或 Pick，不能重复操作" };
  }

  const action: BPAction = {
    mapId,
    side: step.side,
    action: step.action,
    operatorRole: input.operatorRole,
    at: new Date().toISOString(),
  };
  const actions = [...session.actions, action];
  const complete = isBPComplete(session.order, actions);
  return {
    ok: true,
    session: {
      ...session,
      actions,
      ...(complete
        ? {
            status: "已完成" as const,
            completedAt: new Date().toISOString(),
            finalMaps: bpResultMaps(pool, session.boType, actions),
          }
        : {}),
    },
    finalMaps: complete ? bpResultMaps(pool, session.boType, actions) : undefined,
  };
}

/** 回退上一步（仅进行中会话） */
export function undoBP(session: BPSession): BPOpResult {
  if (session.status !== "进行中") {
    return { ok: false, message: "BP 已结束，不能回退" };
  }
  if (session.actions.length === 0) {
    return { ok: false, message: "没有可回退的操作" };
  }
  return { ok: true, session: { ...session, actions: session.actions.slice(0, -1) } };
}

/** 交换先手（仅未开始操作时可换，避免流程混乱） */
export function swapFirstBP(session: BPSession): BPOpResult {
  if (session.status !== "进行中") {
    return { ok: false, message: "BP 已结束，不能交换先手" };
  }
  if (session.actions.length > 0) {
    return { ok: false, message: "BP 已开始，不能再交换先手；如需重来请重置" };
  }
  return {
    ok: true,
    session: {
      ...session,
      firstTeamId: session.secondTeamId,
      firstTeamSide: session.firstTeamSide === "A" ? "B" : "A",
      firstTeamName: session.secondTeamName,
      secondTeamId: session.firstTeamId,
      secondTeamName: session.firstTeamName,
    },
  };
}

/** 整体重置：清空操作（仅进行中会话） */
export function resetBP(session: BPSession): BPOpResult {
  if (session.status !== "进行中") {
    return { ok: false, message: "BP 已结束，不能重置" };
  }
  return { ok: true, session: { ...session, actions: [] } };
}

/** 会话中某支队伍是否参与本场比赛（用于身份校验） */
export function teamInSession(session: BPSession, teamId: string): "first" | "second" | null {
  if (session.firstTeamId === teamId) return "first";
  if (session.secondTeamId === teamId) return "second";
  return null;
}

/** 会话对阵是否与当前比赛一致（防赛程重置后的孤儿会话；含侧位对齐校验） */
export function sessionMatchesMatch(session: BPSession, match: ScheduleMatch): boolean {
  if (session.boType !== match.boType) return false;
  const firstOnA = session.firstTeamId === match.teamAId;
  const firstOnB = session.firstTeamId === match.teamBId;
  if (firstOnA) return session.firstTeamSide === "A" && session.secondTeamId === match.teamBId;
  if (firstOnB) return session.firstTeamSide === "B" && session.secondTeamId === match.teamAId;
  return false;
}

/** 当前步骤的操作方队伍 */
export function stepTeam(session: BPSession): string | null {
  const step = currentStep(session.order, session.actions);
  if (!step) return null;
  return step.side === "first" ? session.firstTeamId : session.secondTeamId;
}
