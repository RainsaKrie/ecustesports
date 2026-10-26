// =====================
// 改期申请与审批（2026-10-26 从 schedule-ops.ts 拆出）
//
// 拆分原因：`schedule-ops.ts` 已 825 行，被架构守卫锁行。
// 这一组函数是"申请 → 审批 → 再校验"的完整闭环，内部耦合紧、对外只依赖 `toScheduledMatch`，
// 拆出来独立成文件后可以单独测。
//
// ★ `schedule-ops.ts` 仍原样导出这些函数（门面），**30 多个调用点一行都不用改**。
// =====================

import type { ScheduleState, ScheduleMatch, RescheduleRecord, NotificationDraft } from "./schedule-data.ts";
export interface CaptainRequestResult {
  ok: boolean;
  message: string;
  request?: RescheduleRecord;
  validation?: ValidationResult;
}

export interface OpResult<T = never> {
  state: ScheduleState;
  result?: ValidationResult | null;
  value?: T;
}
import { validateReschedule, computeEndTime, DEFAULT_CONFIG, type SchedulingConfig, type ScheduledMatch, type ValidationResult } from "./rule-engine.ts";

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

export function formatNoticeTime(iso: string): string {
  const trimmed = (iso ?? "").trim();
  if (!trimmed) return "";
  return trimmed.slice(0, 16).replace("T", " ");
}
