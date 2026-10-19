// =====================
// 赛程状态流转纯函数（可测试）
// 覆盖完整闭环：导入对阵 → 排期 → 改期申请/审批 → 报分 → 晋级推进（胜者/败者两路）
// =====================

import type {
  ScheduleState,
  ScheduleMatch,
  RescheduleRecord,
  NotificationDraft,
  GameResult,
} from "./schedule-data.ts";
import { teamSwapRefusal, swapTeamSlots, type TeamSlot } from "./team-swap.ts";
import {
  validateReschedule,
  validateMatchTime,
  computeEndTime,
  DEFAULT_CONFIG,
  type ScheduledMatch,
  type ValidationResult,
  type SchedulingConfig,
} from "./rule-engine.ts";

export interface OpResult<T = never> {
  state: ScheduleState;
  result?: ValidationResult | null;
  value?: T;
}

export interface CaptainRequestResult {
  ok: boolean;
  message: string;
  request?: RescheduleRecord;
  validation?: ValidationResult;
}

/** 整份保存赛程时，某场比赛会丢掉的成果。 */
export interface ScheduleLoss {
  matchId: string;
  /** 人类可读的丢失项，直接用于提示负责人。 */
  lost: string[];
}

/**
 * 检测「整份覆盖保存」会丢掉哪些**别的路径已经写进去的成果**。
 *
 * 为什么需要这道护栏（2026-10-12 复现确认）：管理端赛程页只在挂载时读一次，
 * 之后把整份快照留着；当时裁判报分、BP 完成、队长约赛这三条路径都会写 `schedule`
 * 却**不递增 `schedule.version`**，于是 `version` 这道乐观锁护栏对它们形同虚设 ——
 * 负责人随后做任意一次赛程操作保存，就会把裁判已报的赛果**静默覆盖**，两条路径都不报错。
 *
 * **现状（2026-10-12 统一写入契约之后）**：上面那三条路径已改为同样递增 `version`
 * （见 `stampScheduleVersion`），所以「别的路径写过」一定表现为版本不一致，
 * 在 `applyScheduleSave` 的版本比对那一步就被拦下了，**这道内容护栏通常不会再被走到**。
 * 保留它是**纵深防御**：将来若有新写入路径忘了递增版本，仍然会被它拦下并明确点名
 * 「哪一场的哪几项成果会被覆盖回去」，而不是静默丢失。**不要因为「看起来没人调用」删掉它。**
 *
 * 护栏的口径刻意**只覆盖「同一场比赛在前后两份里都存在」的情况**：
 *   - 整场比赛消失不在范围内 —— 「归档并清空」「从抽签重新导入」会正当地让比赛消失，
 *     而它们本身有自己的版本与归档记录，这里不去拦。
 *   - 判据是「变少」而不是「不相等」，所以正常补写比分、补选地图不会被误伤。
 */
export function detectScheduleLosses(
  current: ScheduleMatch[],
  incoming: ScheduleMatch[],
): ScheduleLoss[] {
  const incomingById = new Map(incoming.map((match) => [match.id, match]));
  const losses: ScheduleLoss[] = [];

  for (const before of current) {
    const after = incomingById.get(before.id);
    if (!after) continue;

    const lost: string[] = [];
    if (before.status === "已完成" && after.status !== "已完成") {
      lost.push("已完成赛果");
    }
    const beforeGames = before.gameResults?.length ?? 0;
    const afterGames = after.gameResults?.length ?? 0;
    if (beforeGames > afterGames) lost.push("逐局比分");
    const beforeMaps = before.bpMaps?.length ?? 0;
    const afterMaps = after.bpMaps?.length ?? 0;
    if (beforeMaps > afterMaps) lost.push("BP 选图");

    if (lost.length > 0) losses.push({ matchId: before.id, lost });
  }

  return losses;
}

/** 整份保存赛程的裁决结果。 */
export type ScheduleSaveOutcome =
  | { kind: "saved"; state: ScheduleState }
  | { kind: "version-conflict" }
  | { kind: "loss"; losses: ScheduleLoss[] };

/**
 * 赛程文档的**唯一版本递增点** —— 写入契约（2026-10-12 统一）。
 *
 * 契约：`version` 是「赛程文档的修订号」。**任何改动文档内容的写入路径都必须经过这里**，
 * 让 `version` 单调 +1。当前有五条路径，覆盖面如下：
 *
 *   | 写入路径 | 位置 | 改变的内容 |
 *   |---|---|---|
 *   | 管理端整份保存 | `api/data/schedule` → `applyScheduleSave` | 全部 |
 *   | 裁判报分 / 管理员裁决与更正 | `reporting-data.updateReportingState` | matches |
 *   | BP 完成写入选图 | `api/data/bp` → `commitBPMaps` | bpMaps / notifications |
 *   | 队长提交约赛申请 | `api/public/schedule/request` POST | requests |
 *   | 对手队长确认 / 拒绝 | `api/public/schedule/request` PATCH | requests |
 *
 * 为什么必须统一：管理端编辑器只在挂载时读一次，之后靠 `If-Match` 上的版本号判断
 * 「我这份快照还新不新」。只要有一条写入路径不递增，**这条路径写的成果就对
 * 版本护栏不可见**，会被管理端随后的整份保存静默覆盖回去 —— 这正是 2026-10-12
 * 复现出的那次裁判赛果丢失。
 *
 * 两个刻意的细节：
 *   - 内容**没变**时原样返回（判引用相等，与各调用点原有的判断口径一致）。
 *     不递增是为了避免「点一下但没改任何东西」也让别人手里的编辑器失效。
 *   - 只在**成功后**递增：失败路径由调用方抛错回滚，不会走到这里。
 */
export function stampScheduleVersion(before: ScheduleState, next: ScheduleState): ScheduleState {
  if (next === before) return before;
  assertResultsPreserved(before, next);
  return { ...next, version: before.version + 1 };
}

/** 一次写入把「已经产生过成果的比赛」弄丢了。带上是哪几场，便于排查与告警。 */
export class ScheduleResultsLossError extends Error {
  constructor(readonly matchIds: string[]) {
    super(`这次写入会丢失 ${matchIds.length} 场已有赛果或已排期的比赛：${matchIds.join("、")}`);
  }
}

/**
 * 硬护栏：**已经产生过成果的比赛不得因为一次写入凭空消失**（2026-10-14 加）。
 *
 * 落点在 `stampScheduleVersion` 是因为：写入契约要求所有直写赛程的路径都走这个入口，
 * 拦在这里能一次覆盖全部写入点。**已核实 5 个生产调用点都传「库里的当前状态」作为 before**
 * （调整赛制 / BP 完成 / 队长约赛申请 ×2 / 裁判报分），契约是统一的。
 *
 * 为什么要它：2026-10-14 线上出现过「40 场（含 20 场已录赛果）被写成 0 场」，
 * 那次写入**绕过了**整份保存的内容丢失护栏（`detectScheduleLosses` 只在 `data/schedule` 那条路上），
 * 20 场赛果凭空消失，事后只能靠公开缓存里的快照救回。
 * **宁可这次写入失败并报错，也不能让赛果静默消失。**
 *
 * 只保护「有成果」的场次（已完成 / 有胜者 / 有比分 / 有开赛时间）；
 * **纯待排期骨架允许被删** —— 换赛制清掉未开打骨架是合法路径，护栏不能把它也拦死。
 */
export function assertResultsPreserved(before: ScheduleState, next: ScheduleState): void {
  const kept = new Set(next.matches.map((match) => match.id));
  const lost = before.matches.filter((match) =>
    !kept.has(match.id)
    && (match.status === "已完成"
      || Boolean(match.winnerTeamId)
      || (match.gameResults?.length ?? 0) > 0
      || Boolean(match.startTime)));
  if (lost.length > 0) {
    throw new ScheduleResultsLossError(lost.map((match) => match.id));
  }
}

/**
 * 整份保存赛程时的裁决：先比版本号，再比内容，最后才合并写入。
 *
 * 抽成纯函数是为了让「版本号一致但内容过期」这个场景**可以被直接测试** ——
 * 它是本次复现出的数据丢失路径，靠端到端脚本很难稳定重放。
 *
 * 版本号的写入口径与其余四条路径完全一致：成功后一律 `current.version + 1`，
 * 不再信任客户端传来的版本值（客户端那份本来就是基于 `expectedVersion` 改的，
 * 让它「抬价」只会给版本护栏开一个后门）。
 */
export function applyScheduleSave(
  current: ScheduleState,
  incoming: ScheduleState,
  expectedVersion: number,
): ScheduleSaveOutcome {
  if (current.version !== expectedVersion) return { kind: "version-conflict" };

  const losses = detectScheduleLosses(current.matches, incoming.matches);
  if (losses.length > 0) return { kind: "loss", losses };

  return { kind: "saved", state: stampScheduleVersion(current, incoming) };
}

export function toScheduledMatch(m: ScheduleMatch): ScheduledMatch {
  return {
    id: m.id,
    teamAId: m.teamAId,
    teamBId: m.teamBId,
    boType: m.boType,
    startTime: m.startTime,
    endTime: m.endTime,
    frozen: m.frozen,
    prerequisiteMatchId: m.prerequisiteId,
    status: m.status,
  };
}

/** BO 胜局目标（BO1:1 / BO3:2 / BO5:3） */
export function winTarget(bo: string): number {
  return { BO1: 1, BO3: 2, BO5: 3 }[bo] ?? 1;
}

/** 该 BO 允许的最多局数（2×目标−1） */
export function maxGames(bo: string): number {
  return 2 * winTarget(bo) - 1;
}

/** 校验逐局结果是否构成合法完赛比分 */
export function validateGames(
  games: GameResult[],
  boType: string,
): { ok: boolean; message?: string } {
  const target = winTarget(boType);
  if (games.length === 0 || games.length > maxGames(boType)) {
    return { ok: false, message: `局数应在 1~${maxGames(boType)} 之间` };
  }
  if (games.some((g) =>
    !Number.isSafeInteger(g.teamAScore)
    || !Number.isSafeInteger(g.teamBScore)
    || g.teamAScore < 0
    || g.teamBScore < 0
  )) {
    return { ok: false, message: "比分必须是非负整数" };
  }
  if (games.some((g) => g.teamAScore === g.teamBScore)) {
    return { ok: false, message: "每局比分不能平局" };
  }
  const winsA = games.filter((g) => g.teamAScore > g.teamBScore).length;
  const winsB = games.length - winsA;
  if (winsA !== target && winsB !== target) {
    return { ok: false, message: `BO${boType.replace("BO", "")} 需一方先达到 ${target} 胜局` };
  }
  if (winsA > target || winsB > target) {
    return { ok: false, message: "比分超过该赛制最大局数" };
  }
  const completedBeforeLast = games.slice(0, -1);
  const earlyWinsA = completedBeforeLast.filter((g) => g.teamAScore > g.teamBScore).length;
  const earlyWinsB = completedBeforeLast.length - earlyWinsA;
  if (earlyWinsA >= target || earlyWinsB >= target) {
    return { ok: false, message: "系列赛已提前决出胜负，不能继续录入后续局" };
  }
  return { ok: true };
}

/** 从已校验的逐局比分推导胜者；客户端无须也不得另传胜者。 */
export function determineWinnerTeamId(match: ScheduleMatch, games: GameResult[]): string {
  const winsA = games.filter((g) => g.teamAScore > g.teamBScore).length;
  return winsA > games.length - winsA ? match.teamAId : match.teamBId;
}

/**
 * 把已校验赛果写入比赛并推进胜者/败者路径。
 * 管理员手工报分与裁判报分共用这一处，避免两套晋级逻辑逐渐分叉。
 *
 * ★ 同时**作废这场比赛上所有未完结的改期申请**。
 *   原因：报分把比赛标成「已完成」，但改期申请是独立记录，不会自己消失。
 *   留着它有两个实际后果：
 *     1. 「待审批」的申请被批准时，approveRescheduleOp 会把这场比赛改回「已排期」
 *        （见下方 updatedMatch 的 status），而 `...match` 会带上已写好的赛果——
 *        比赛显示未开始、赛果还挂着，且它重新出现在 BP 列表里，可能被当成没打。
 *     2. 「待对手确认」的申请，对手再点确认会推进到「待审批」，等于给上面那条铺路。
 *   两处都靠「申请状态」自我把关，都不看比赛是否已完成，所以必须在这里收口。
 */
export function applyGameResultsToBracket(
  source: ScheduleMatch[],
  match: ScheduleMatch,
  gameResults: GameResult[],
): ScheduleMatch[] {
  const winnerTeamId = determineWinnerTeamId(match, gameResults);
  const loserTeamId = winnerTeamId === match.teamAId ? match.teamBId : match.teamAId;
  let matches = source.map((item) =>
    item.id === match.id
      ? { ...item, gameResults, winnerTeamId, status: "已完成" as const }
      : item,
  );

  const fill = (targetId: string | undefined, side: "A" | "B" | undefined, teamId: string, teamName: string) => {
    if (!targetId || !side) return;
    matches = matches.map((item) =>
      item.id === targetId
        ? side === "A"
          ? { ...item, teamAId: teamId, teamAName: teamName }
          : { ...item, teamBId: teamId, teamBName: teamName }
        : item,
    );
  };

  if (match.nextMatchId) {
    fill(
      match.nextMatchId,
      match.nextSide,
      winnerTeamId,
      winnerTeamId === match.teamAId ? match.teamAName : match.teamBName,
    );
  }
  if (match.nextLoserMatchId) {
    fill(
      match.nextLoserMatchId,
      match.nextLoserSide,
      loserTeamId,
      loserTeamId === match.teamAId ? match.teamAName : match.teamBName,
    );
  }

  return matches;
}

/** 导入对阵生成比赛列表（重置版本与队列） */
export function importMatchesOp(state: ScheduleState, matches: ScheduleMatch[]): ScheduleState {
  return {
    config: state.config,
    configConfirmed: state.configConfirmed,
    version: 1,
    matches,
    versions: [
      { version: 1, matches, note: "从赛制抽签导入对阵", createdAt: new Date().toISOString() },
    ],
    requests: [],
    notifications: [],
  };
}

/** 清空当前赛程前保留完整快照，供旧数据迁移或负责人重新抽签。 */
export function archiveAndClearScheduleOp(state: ScheduleState, note = "归档旧赛程并重新抽签"): ScheduleState {
  if (state.matches.length === 0) return state;
  const archivedVersion = Math.max(1, state.version);
  const hasCurrentSnapshot = state.versions.some(
    (version) => version.version === archivedVersion && version.matches.length === state.matches.length,
  );
  const archived = hasCurrentSnapshot
    ? state.versions
    : [
        ...state.versions,
        {
          version: archivedVersion,
          matches: state.matches,
          note: "清空前自动归档",
          createdAt: new Date().toISOString(),
        },
      ];
  const nextVersion = archivedVersion + 1;
  return {
    config: state.config,
    configConfirmed: state.configConfirmed,
    version: nextVersion,
    matches: [],
    versions: [
      ...archived,
      { version: nextVersion, matches: [], note, createdAt: new Date().toISOString() },
    ],
    requests: [],
    notifications: state.notifications,
  };
}

/** 发布后续赛事阶段：保留既有排期、赛果、申请和通知，只追加新阶段比赛。 */
export function appendMatchesOp(state: ScheduleState, matches: ScheduleMatch[], note: string): ScheduleState {
  const existingIds = new Set(state.matches.map((match) => match.id));
  if (matches.some((match) => existingIds.has(match.id))) {
    throw new Error("新阶段比赛编号与现有赛程重复，已停止发布。");
  }
  const nextMatches = [...state.matches, ...matches];
  const nextVersion = Math.max(0, state.version) + 1;
  return {
    ...state,
    version: nextVersion,
    matches: nextMatches,
    versions: [
      ...state.versions,
      { version: nextVersion, matches: nextMatches, note, createdAt: new Date().toISOString() },
    ],
  };
}

/** 提交改期申请并校验 */
export function submitRequestOp(
  state: ScheduleState,
  input: {
    matchId: string;
    newStartTime: string;
    reason: string;
    teamAConfirmed: boolean;
    teamBConfirmed: boolean;
  },
  config: SchedulingConfig = DEFAULT_CONFIG,
): OpResult<ValidationResult> {
  const scheduled = state.matches.map(toScheduledMatch);
  const result = validateReschedule(
    { ...input, basedOnVersion: state.version },
    scheduled,
    state.version,
    config,
  );
  const record: RescheduleRecord = {
    id: `REQ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    matchId: input.matchId,
    newStartTime: input.newStartTime,
    reason: input.reason,
    teamAConfirmed: input.teamAConfirmed,
    teamBConfirmed: input.teamBConfirmed,
    basedOnVersion: state.version,
    submittedAt: new Date().toISOString(),
    status: "待审批",
    conflicts: result.conflicts,
  };
  return { state: { ...state, requests: [record, ...state.requests] }, result, value: result };
}

/** 队长提出双方已协商的候选时间；先校验硬约束，再等待对手队长确认。 */
export function submitCaptainRequestOp(
  state: ScheduleState,
  input: { matchId: string; newStartTime: string; reason: string; proposedByTeamId: string },
  config: SchedulingConfig = state.config ?? DEFAULT_CONFIG,
): OpResult<CaptainRequestResult> {
  if (!state.configConfirmed) {
    return { state, value: { ok: false, message: "赛事负责人尚未确认本届排程时间范围。" } };
  }
  const match = state.matches.find((item) => item.id === input.matchId);
  if (!match || ![match.teamAId, match.teamBId].includes(input.proposedByTeamId)) {
    return { state, value: { ok: false, message: "你不是本场比赛的参赛队长。" } };
  }
  if (match.status === "已完成") {
    return { state, value: { ok: false, message: "比赛已完成，不能再提交约赛时间。" } };
  }
  const active = state.requests.find((request) =>
    request.matchId === match.id && ["待对手确认", "待审批"].includes(request.status),
  );
  if (active) {
    return { state, value: { ok: false, message: "本场已有待处理的约赛申请，请先处理原申请。", request: active } };
  }

  // 候选时间先按“两队最终均确认”预校验，避免把明显不可行的时间发给对手。
  const validation = validateReschedule({
    matchId: match.id,
    newStartTime: input.newStartTime,
    teamAConfirmed: true,
    teamBConfirmed: true,
    basedOnVersion: state.version,
  }, state.matches.map(toScheduledMatch), state.version, config);
  if (!validation.approved) {
    return { state, result: validation, value: { ok: false, message: validation.conflicts[0]?.message ?? "该时间无法提交。", validation } };
  }

  const now = new Date().toISOString();
  const request: RescheduleRecord = {
    id: `REQ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    matchId: match.id,
    newStartTime: input.newStartTime,
    reason: input.reason,
    teamAConfirmed: input.proposedByTeamId === match.teamAId,
    teamBConfirmed: input.proposedByTeamId === match.teamBId,
    proposedByTeamId: input.proposedByTeamId,
    basedOnVersion: state.version,
    submittedAt: now,
    status: "待对手确认",
    conflicts: [],
  };
  return {
    state: { ...state, requests: [request, ...state.requests] },
    result: validation,
    value: { ok: true, message: "约赛时间已提交，等待对手队长确认。", request, validation },
  };
}

/** 对手队长确认或拒绝候选时间；确认后进入负责人审批队列。 */
export function resolveCaptainRequestOp(
  state: ScheduleState,
  input: { requestId: string; actorTeamId: string; decision: "accept" | "reject" },
  config: SchedulingConfig = state.config ?? DEFAULT_CONFIG,
): OpResult<CaptainRequestResult> {
  const request = state.requests.find((item) => item.id === input.requestId);
  const match = request ? state.matches.find((item) => item.id === request.matchId) : undefined;
  if (!request || !match || request.status !== "待对手确认") {
    return { state, value: { ok: false, message: "该约赛申请已失效或已经处理。" } };
  }
  const opponentTeamId = request.proposedByTeamId === match.teamAId ? match.teamBId : match.teamAId;
  if (!request.proposedByTeamId || input.actorTeamId !== opponentTeamId) {
    return { state, value: { ok: false, message: "只有对手队长可以处理该申请。", request } };
  }
  const now = new Date().toISOString();
  if (input.decision === "reject") {
    const rejected = { ...request, status: "已驳回" as const, resolvedAt: now };
    return {
      state: { ...state, requests: state.requests.map((item) => item.id === request.id ? rejected : item) },
      value: { ok: true, message: "已拒绝该约赛时间。", request: rejected },
    };
  }

  const validation = validateReschedule({
    matchId: match.id,
    newStartTime: request.newStartTime,
    teamAConfirmed: true,
    teamBConfirmed: true,
    basedOnVersion: request.basedOnVersion,
  }, state.matches.map(toScheduledMatch), state.version, config);
  const updated: RescheduleRecord = validation.approved
    ? { ...request, teamAConfirmed: true, teamBConfirmed: true, status: "待审批", conflicts: [], confirmedAt: now }
    : { ...request, teamAConfirmed: true, teamBConfirmed: true, status: "已失效", conflicts: validation.conflicts, resolvedAt: now };
  return {
    state: { ...state, requests: state.requests.map((item) => item.id === request.id ? updated : item) },
    result: validation,
    value: {
      ok: validation.approved,
      message: validation.approved ? "双方已确认，等待赛事负责人审批。" : validation.conflicts[0]?.message ?? "赛程已变化，请重新提交。",
      request: updated,
      validation,
    },
  };
}

/**
 * 批准改期：批准前基于当前赛程与版本重新校验（AC-03）。
 * 返回 null 结果表示操作无效（申请不存在或已处理）。
 */
/**
 * 批准改期：批准前基于当前赛程与版本重新校验（AC-03）。
 * 返回 null 结果表示操作无效（申请不存在或已处理）。
 *
 * `options.ownerAttestsBothTeams` 用于「双方私下商定、负责人落库」这条实际路径。
 * 背景：约赛实际发生在 QQ/微信里，对手通常不会再上平台点一次确认，
 * 申请于是永远停在「待对手确认」，管理端也没有任何按钮可用。
 *
 * 开启后：
 *   · 允许批准「待对手确认」状态的申请；
 *   · HC-02（双方须确认同一时间）由负责人的核对代替——**记录 ownerAttestedAt 作为担保凭据**，
 *     不去篡改 teamAConfirmed / teamBConfirmed。这一点很重要：
 *     改那两个字段等于伪造「对手点过确认」，出事时无从分辨。
 */
export function approveRequestOp(
  state: ScheduleState,
  requestId: string,
  config: SchedulingConfig = DEFAULT_CONFIG,
  options: { ownerAttestsBothTeams?: boolean } = {},
): OpResult<ValidationResult | null> {
  const req = state.requests.find((r) => r.id === requestId);
  const match = req ? state.matches.find((m) => m.id === req.matchId) : undefined;
  const ownerAttests = options.ownerAttestsBothTeams === true;
  const statusAllowed = req?.status === "待审批" || (ownerAttests && req?.status === "待对手确认");
  if (!req || !match || !statusAllowed) {
    return { state, result: null, value: null };
  }

  /**
   * 这里原先有一段短路：`req.conflicts.length > 0` 就把**存下来的**冲突直接返回、不再校验。
   *
   * **2026-10-09 去掉。** 存下来的冲突是**上一次校验时的快照**，它会过期 ——
   * 申请第一次批准失败是因为「版本号对不上」（那条规则当天已删），
   * 这个 HC-01 就被写进申请的 `conflicts` 字段并存了下来；
   * 之后不管规则怎么修，批准都拿这份旧快照直接拒绝，**永远过不去**
   * （线上三条红字反复出现、改了规则也不消失，就是卡在这里）。
   *
   * 去掉是安全的：紧接着就是**基于当前赛程**的重新校验，真冲突一个都不会放过，
   * 而且结论永远是最新的。校验失败时仍会把 conflicts 写回申请（见下面那个分支），
   * 所以「界面上能看出为什么不能批」这个行为没变。
   */

  // 基于当前赛程重新校验（申请提交后赛程可能已经变过，以当下为准）
  const scheduled = state.matches.map(toScheduledMatch);
  const result = validateReschedule(
    {
      matchId: req.matchId,
      newStartTime: req.newStartTime,
      // 负责人已核对双方商定时，视同双方确认——这是「谁做的担保」，不是「对手点过」
      teamAConfirmed: req.teamAConfirmed || ownerAttests,
      teamBConfirmed: req.teamBConfirmed || ownerAttests,
      basedOnVersion: req.basedOnVersion ?? state.version,
    },
    scheduled,
    state.version,
    config,
  );
  if (!result.approved) {
    return {
      state: {
        ...state,
        requests: state.requests.map((r) =>
          r.id === requestId ? { ...r, conflicts: result.conflicts } : r,
        ),
      },
      result,
      value: result,
    };
  }

  const endTime = computeEndTime(req.newStartTime, match.boType, config);
  const updatedMatch: ScheduleMatch = {
    ...match,
    startTime: req.newStartTime,
    endTime,
    status: "已排期",
  };
  const newMatches = state.matches.map((m) => (m.id === match.id ? updatedMatch : m));
  const newVersion = state.version + 1;
  const resolvedAt = new Date().toISOString();
  const attestNote = ownerAttests && !(req.teamAConfirmed && req.teamBConfirmed)
    ? "，由负责人核对双方商定"
    : "";

  const versionRecord = {
    version: newVersion,
    matches: newMatches,
    note: `${match.id} 改期至 ${formatNoticeTime(req.newStartTime)}（${req.reason || "未填写原因"}${attestNote}）`,
    createdAt: resolvedAt,
  };

  const notification: NotificationDraft = {
    id: `NT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    version: newVersion,
    content: `【赛程变更 v${newVersion}】${match.teamAName} vs ${match.teamBName} 已改期至 ${formatNoticeTime(req.newStartTime)}。请双方队伍与裁判知悉。`,
    createdAt: resolvedAt,
  };

  return {
    state: {
      config: state.config,
      configConfirmed: state.configConfirmed,
      version: newVersion,
      matches: newMatches,
      versions: [...state.versions, versionRecord],
      requests: state.requests.map((r) =>
        r.id === requestId
          ? {
              ...r,
              status: "已批准" as const,
              resolvedAt,
              ...(ownerAttests ? { ownerAttestedAt: resolvedAt } : {}),
            }
          : r,
      ),
      notifications: [notification, ...state.notifications],
    },
    result: { approved: true, conflicts: [], primaryConflict: "" },
    value: { approved: true, conflicts: [], primaryConflict: "" },
  };
}

/** 驳回改期申请 */
export function rejectRequestOp(state: ScheduleState, requestId: string): ScheduleState {
  return {
    ...state,
    requests: state.requests.map((r) => (r.id === requestId ? { ...r, status: "已驳回" as const, resolvedAt: new Date().toISOString() } : r)),
  };
}

/** 切换比赛冻结状态 */
export function toggleFrozenOp(state: ScheduleState, matchId: string): ScheduleState {
  return {
    ...state,
    matches: state.matches.map((m) => (m.id === matchId ? { ...m, frozen: !m.frozen } : m)),
  };
}

/** 标记通知为已发送 */
/**
 * 把 ISO 时间转成通知文案里用的形状：`2026-10-08 18:00`。
 *
 * 原来直接用 `replace("T", " ")`，结果是 `2026-10-08 18:00:00`——
 * 这段文字是要被复制到赛事群里的，秒对读者没有意义，只会显得啰嗦。
 */
export function formatNoticeTime(iso: string): string {
  const trimmed = (iso ?? "").trim();
  if (!trimmed) return "";
  return trimmed.slice(0, 16).replace("T", " ");
}

/**
 * 取最近的赛程变更通知，按时间倒序。
 *
 * 取代原来的「草稿 / 已发送」状态筛选。理由见 NotificationDraft 的注释：
 * 那个状态依赖一个不会发生的动作（负责人回来点「标记已发布」），
 * 结果是列表只增不减。改成按条数截断后，列表天然有界。
 */
export const RECENT_NOTIFICATION_LIMIT = 5;

export function recentNotifications(
  state: ScheduleState,
  limit: number = RECENT_NOTIFICATION_LIMIT,
): NotificationDraft[] {
  return [...state.notifications]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, limit);
}

/**
 * 作废某场比赛上所有未完结的改期申请（「待对手确认」/「待审批」）。
 *
 * 报分后必须调用。这些申请自己不会消失，而它们的状态检查都不看比赛是否已完成：
 * approveRescheduleOp 会把已完成的比赛改回「已排期」并覆盖时间（赛果仍挂着），
 * resolveCaptainRequestOp 又会把「待对手确认」推进到「待审批」给前者铺路。
 *
 * 记成「已失效」而不是删掉——负责人事后要能查到「这场曾经申请过改期、后来作废了」。
 */
export function expirePendingRequests(
  requests: RescheduleRecord[],
  matchId: string,
  reason = "比赛已完成，改期申请自动失效",
): RescheduleRecord[] {
  const now = new Date().toISOString();
  return requests.map((request) =>
    request.matchId === matchId && ["待对手确认", "待审批"].includes(request.status)
      ? { ...request, status: "已失效" as const, resolvedAt: now, conflicts: [
          ...request.conflicts,
          { code: "HC-01" as const, message: reason },
        ] }
      : request,
  );
}

/** 报分：校验逐局结果、判定胜者、标记完成，并推进胜者与败者进入后续场次 */
export function reportGameResultsOp(
  state: ScheduleState,
  matchId: string,
  gameResults: GameResult[],
): OpResult<{ ok: boolean; message?: string }> {
  const match = state.matches.find((m) => m.id === matchId);
  if (!match) {
    return { state, result: { approved: false, conflicts: [{ code: "HC-01", message: "比赛不存在" }], primaryConflict: "HC-01" }, value: { ok: false, message: "比赛不存在" } };
  }

  const check = validateGames(gameResults, match.boType);
  if (!check.ok) {
    return { state, result: { approved: false, conflicts: [{ code: "HC-01", message: check.message ?? "比分不合法" }], primaryConflict: "HC-01" }, value: { ok: false, message: check.message } };
  }

  const matches = applyGameResultsToBracket(state.matches, match, gameResults);
  // 比赛已结束，这场上还挂着的改期申请必须一起作废——
  // 否则「批准改期」会把已完成的比赛改回「已排期」，赛果被架在中间。
  const requests = expirePendingRequests(state.requests ?? [], matchId);
  return { state: { ...state, matches, requests }, value: { ok: true } };
}

/**
 * 排期 / 直接改期（负责人直接设置比赛时间，不经过两队确认流程）。
 * 校验 HC-03~HC-08 硬约束；通过后生成新版本记录。
 */
export function setMatchTimeOp(
  state: ScheduleState,
  matchId: string,
  newStartTime: string,
  config: SchedulingConfig = DEFAULT_CONFIG,
  reason = "",
): OpResult<ValidationResult> {
  const match = state.matches.find((m) => m.id === matchId);
  const scheduled = state.matches.map(toScheduledMatch);
  const target = scheduled.find((m) => m.id === matchId);
  const result = validateMatchTime(target, newStartTime, scheduled, config);

  if (!match || !result.approved) {
    return { state, result, value: result };
  }

  const endTime = computeEndTime(newStartTime, match.boType, config);
  const updatedMatch: ScheduleMatch = {
    ...match,
    startTime: newStartTime,
    endTime,
    status: "已排期",
  };
  const newMatches = state.matches.map((m) => (m.id === matchId ? updatedMatch : m));
  const newVersion = state.version + 1;
  const isInitial = !match.startTime;
  const versionRecord = {
    version: newVersion,
    matches: newMatches,
    note: `${match.id} ${isInitial ? "排期" : "调整时间"}至 ${formatNoticeTime(newStartTime)}${reason ? `（${reason}）` : ""}`,
    createdAt: new Date().toISOString(),
  };
  const notification: NotificationDraft | undefined = isInitial ? undefined : {
    id: `NT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    version: newVersion,
    content: `【赛程变更 v${newVersion}】${match.teamAName} vs ${match.teamBName} 已调整至 ${formatNoticeTime(newStartTime)}${reason ? `，原因：${reason}` : ""}。请双方队伍与裁判知悉。`,
    createdAt: new Date().toISOString(),
  };

  return {
    state: {
      ...state,
      version: newVersion,
      matches: newMatches,
      versions: [...state.versions, versionRecord],
      notifications: notification ? [notification, ...state.notifications] : state.notifications,
    },
    result: { approved: true, conflicts: [], primaryConflict: "" },
    value: { approved: true, conflicts: [], primaryConflict: "" },
  };
}

/**
 * 调整对阵：交换两个签位的队伍，并把理由写进版本记录的说明里（2026-10-16）。
 *
 * 为什么走操作层而不是在界面里直接改 matches：**版本历史的说明是事后排查的第一人证**
 * （改期、抽签那些操作的说明都写在这里，见《数据流转与写入点登记表》的排查手册）。
 * 理由**在这一层强制**，所以绕不过去 —— 界面上忘记校验也不会留下"无理由的对阵改动"。
 */
export function swapTeamsOp(state: ScheduleState, from: TeamSlot, to: TeamSlot, reason: string): ScheduleState {
  const trimmed = reason.trim();
  if (!trimmed) throw new Error("必须填写调整对阵的理由（事后要能说明依据）。");
  const refusal = teamSwapRefusal(state.matches, from, to);
  if (refusal) throw new Error(refusal);

  const newMatches = swapTeamSlots(state.matches, from, to);
  const newVersion = state.version + 1;
  const teamNameAt = (slot: TeamSlot) => {
    const target = state.matches.find((m) => m.id === slot.matchId);
    if (!target) return "?";
    return slot.side === "A" ? target.teamAName : target.teamBName;
  };
  const versionRecord = {
    version: newVersion,
    matches: newMatches,
    note: `调整对阵：${teamNameAt(to)} 换到 ${from.matchId} 的 ${from.side} 位、${teamNameAt(from)} 换到 ${to.matchId} 的 ${to.side} 位（理由：${trimmed}）`,
    createdAt: new Date().toISOString(),
  };

  return { ...state, version: newVersion, matches: newMatches, versions: [...state.versions, versionRecord] };
}

/** 保存 BP 选出的地图 */
export function saveBPMapsOp(state: ScheduleState, matchId: string, maps: string[]): ScheduleState {
  return {
    ...state,
    matches: state.matches.map((m) => (m.id === matchId ? { ...m, bpMaps: maps } : m)),
  };
}
