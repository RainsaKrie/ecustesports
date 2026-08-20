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
} from "./schedule-data";
import {
  validateReschedule,
  validateMatchTime,
  computeEndTime,
  DEFAULT_CONFIG,
  type ScheduledMatch,
  type ValidationResult,
  type SchedulingConfig,
} from "./rule-engine";

export interface OpResult<T = never> {
  state: ScheduleState;
  result?: ValidationResult | null;
  value?: T;
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
  return { ok: true };
}

/** 导入对阵生成比赛列表（重置版本与队列） */
export function importMatchesOp(state: ScheduleState, matches: ScheduleMatch[]): ScheduleState {
  return {
    version: 1,
    matches,
    versions: [
      { version: 1, matches, note: "从赛制抽签导入对阵", createdAt: new Date().toISOString() },
    ],
    requests: [],
    notifications: [],
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

/**
 * 批准改期：批准前基于当前赛程与版本重新校验（AC-03）。
 * 返回 null 结果表示操作无效（申请不存在或已处理）。
 */
export function approveRequestOp(
  state: ScheduleState,
  requestId: string,
  config: SchedulingConfig = DEFAULT_CONFIG,
): OpResult<ValidationResult | null> {
  const req = state.requests.find((r) => r.id === requestId);
  const match = req ? state.matches.find((m) => m.id === req.matchId) : undefined;
  if (!req || !match || req.status !== "待审批") {
    return { state, result: null, value: null };
  }

  // 提交时已有冲突的申请不能进入批准
  if (req.conflicts.length > 0) {
    const blocked: ValidationResult = {
      approved: false,
      conflicts: req.conflicts,
      primaryConflict: req.conflicts[0].code,
    };
    return { state, result: blocked, value: blocked };
  }

  // 基于当前赛程重新校验（旧版本申请会命中 HC-01）
  const scheduled = state.matches.map(toScheduledMatch);
  const result = validateReschedule(
    {
      matchId: req.matchId,
      newStartTime: req.newStartTime,
      teamAConfirmed: req.teamAConfirmed,
      teamBConfirmed: req.teamBConfirmed,
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
  };
  const newMatches = state.matches.map((m) => (m.id === match.id ? updatedMatch : m));
  const newVersion = state.version + 1;

  const versionRecord = {
    version: newVersion,
    matches: newMatches,
    note: `${match.id} 改期至 ${req.newStartTime.replace("T", " ")}（${req.reason || "未填写原因"}）`,
    createdAt: new Date().toISOString(),
  };

  const notification: NotificationDraft = {
    id: `NT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    version: newVersion,
    content: `【赛程变更 v${newVersion}】${match.teamAName} vs ${match.teamBName} 已改期至 ${req.newStartTime.replace("T", " ")}。请双方队伍与裁判知悉。`,
    status: "草稿",
    createdAt: new Date().toISOString(),
  };

  return {
    state: {
      version: newVersion,
      matches: newMatches,
      versions: [...state.versions, versionRecord],
      requests: state.requests.map((r) =>
        r.id === requestId ? { ...r, status: "已批准" as const } : r,
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
    requests: state.requests.map((r) => (r.id === requestId ? { ...r, status: "已驳回" as const } : r)),
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
export function markNotificationSentOp(state: ScheduleState, notificationId: string): ScheduleState {
  return {
    ...state,
    notifications: state.notifications.map((n) =>
      n.id === notificationId ? { ...n, status: "已发送" as const } : n,
    ),
  };
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

  const winsA = gameResults.filter((g) => g.teamAScore > g.teamBScore).length;
  const winsB = gameResults.length - winsA;
  const winnerTeamId = winsA > winsB ? match.teamAId : match.teamBId;
  const loserTeamId = winnerTeamId === match.teamAId ? match.teamBId : match.teamAId;

  let matches = state.matches.map((m) =>
    m.id === matchId
      ? { ...m, gameResults, winnerTeamId, status: "已完成" as const }
      : m,
  );

  const fill = (targetId: string | undefined, side: "A" | "B" | undefined, teamId: string, teamName: string) => {
    if (!targetId || !side) return;
    matches = matches.map((m) =>
      m.id === targetId
        ? side === "A"
          ? { ...m, teamAId: teamId, teamAName: teamName }
          : { ...m, teamBId: teamId, teamBName: teamName }
        : m,
    );
  };

  // 胜者晋级（胜者路径）
  if (match.nextMatchId) {
    fill(match.nextMatchId, match.nextSide, winnerTeamId,
      winnerTeamId === match.teamAId ? match.teamAName : match.teamBName);
  }
  // 败者进入败者组（双败路径）
  if (match.nextLoserMatchId) {
    fill(match.nextLoserMatchId, match.nextLoserSide, loserTeamId,
      loserTeamId === match.teamAId ? match.teamAName : match.teamBName);
  }

  return { state: { ...state, matches }, value: { ok: true } };
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
    note: `${match.id} ${isInitial ? "排期" : "调整时间"}至 ${newStartTime.replace("T", " ")}`,
    createdAt: new Date().toISOString(),
  };

  return {
    state: {
      ...state,
      version: newVersion,
      matches: newMatches,
      versions: [...state.versions, versionRecord],
    },
    result: { approved: true, conflicts: [], primaryConflict: "" },
    value: { approved: true, conflicts: [], primaryConflict: "" },
  };
}

/** 保存 BP 选出的地图 */
export function saveBPMapsOp(state: ScheduleState, matchId: string, maps: string[]): ScheduleState {
  return {
    ...state,
    matches: state.matches.map((m) => (m.id === matchId ? { ...m, bpMaps: maps } : m)),
  };
}
