// =====================
// RPT-01 赛果状态机、确认与恢复纯函数（对应 ADR v1.0）
// 无 UI、无数据库、无模型。只有 accepted 决策触碰正式赛果。
// 每个操作返回新的完整状态（matches + ledger），调用方用它替换旧状态。
// =====================

import type { GameResult, ScheduleMatch } from "./schedule-data";
import {
  applyGameResultsToBracket,
  determineWinnerTeamId,
  validateGames,
} from "./schedule-ops";
import type {
  DownstreamImpact,
  MatchReviewPolicy,
  ResultDecision,
  ResultLedger,
  ResultSubmission,
  ResultSubmissionStatus,
  SubmitResultInput,
} from "./result-domain";
import { FORCED_ROUNDS_DEFAULT } from "./result-domain";

// ---------------------------------------------------------------
// 上下文与结果类型
// ---------------------------------------------------------------

export interface MatchAssignment {
  matchId: string;
  refereeId: string;
  status: "assigned" | "revoked" | "completed";
}

export interface ResultContext {
  /** 正式赛果所在（现有 ScheduleMatch 数组） */
  matches: ScheduleMatch[];
  /** 赛果台账（提交记录 + 决策 + 版本计数器） */
  ledger: ResultLedger;
  /** 当前有效赛程版本号（用于版本冲突判定） */
  scheduleVersion: number;
  /** 裁判比赛分配关系 */
  assignments: MatchAssignment[];
  /** 强制复核策略 */
  reviewPolicy?: MatchReviewPolicy;
}

/** 操作结果：成功返回新状态 + 值，失败返回错误码 */
export type ResultOpResult<T = undefined> =
  | { ok: true; state: ResultContext; value: T; reason?: string }
  | { ok: false; error: string; code?: string; state?: undefined; value?: undefined };

export interface SubmitValue {
  submissionId: string;
  status: ResultSubmissionStatus;
  declaredWinnerTeamId: string;
}

// ---------------------------------------------------------------
// 基础函数
// ---------------------------------------------------------------

export function emptyLedger(): ResultLedger {
  return { submissions: [], decisions: [], resultVersion: 0 };
}

function isForcedReviewRound(match: ScheduleMatch, policy: MatchReviewPolicy): boolean {
  if (policy.forceReview) return true;
  return policy.forcedRounds.some((r) => match.round === r);
}

function toSubmission(input: SubmitResultInput, id: string, winnerTeamId: string, status: ResultSubmissionStatus): ResultSubmission {
  return {
    id,
    matchId: input.matchId,
    submittedByRefereeId: input.refereeId,
    basedOnScheduleVersion: input.basedOnScheduleVersion,
    games: input.games,
    declaredWinnerTeamId: winnerTeamId,
    evidenceIds: input.evidenceIds ?? [],
    source: input.source ?? "manual",
    status,
    submittedAt: new Date().toISOString(),
  };
}

function toDecision(
  id: string,
  submissionId: string,
  decision: ResultDecision["decision"],
  actorType: ResultDecision["actorType"],
  actorId: string,
  reason: string,
  before: number,
  after: number,
): ResultDecision {
  return { id, submissionId, decision, actorType, actorId, reason, beforeResultVersion: before, afterResultVersion: after, createdAt: new Date().toISOString() };
}

/** 下游影响判定（decision 6） */
export function computeDownstreamImpact(match: ScheduleMatch, matches: ScheduleMatch[]): DownstreamImpact {
  const downstreamIds = [match.nextMatchId, match.nextLoserMatchId].filter((id): id is string => !!id);
  const affected: string[] = [];
  let hasScheduledDownstream = false;
  let hasProgressedDownstream = false;
  for (const id of downstreamIds) {
    const down = matches.find((m) => m.id === id);
    if (!down) continue;
    const isScheduled = !!down.startTime;
    const isProgressed = (!!down.bpMaps && down.bpMaps.length > 0) || down.status === "已完成" || (!!down.gameResults && down.gameResults.length > 0);
    if (isProgressed) hasProgressedDownstream = true;
    else if (isScheduled) hasScheduledDownstream = true;
    affected.push(id);
  }
  return { hasScheduledDownstream, hasProgressedDownstream, affectedMatchIds: affected };
}

// ---------------------------------------------------------------
// 提交赛果（decision 3「提交即生效」）
// ---------------------------------------------------------------

/**
 * 提交赛果。
 * - 不存在 / 版本过期 / 未分配 / 比分不合法 → 拒绝提交。
 * - 强制复核 → needs-review，不碰正式赛果。
 * - 非强制复核且规则一致 → accepted，当场更新正式赛果 + 晋级。
 * - 幂等：同提交 ID 重复提交返回原状态，不重复推进。
 */
export function submitResultOp(input: SubmitResultInput, ctx: ResultContext): ResultOpResult<SubmitValue> {
  const submissionId = input.submissionId ?? buildSubmissionId(input);

  const match = ctx.matches.find((m) => m.id === input.matchId);
  if (!match) return { ok: false, error: "比赛不存在", code: "MATCH_NOT_FOUND" };

  if (input.basedOnScheduleVersion !== ctx.scheduleVersion) {
    return { ok: false, error: `赛程版本冲突：提交基于 v${input.basedOnScheduleVersion}，当前 v${ctx.scheduleVersion}`, code: "VERSION_CONFLICT" };
  }

  const assigned = ctx.assignments.some(
    (a) => a.matchId === input.matchId && a.refereeId === input.refereeId && a.status === "assigned",
  );
  if (!assigned) return { ok: false, error: "裁判未被分配该比赛", code: "NOT_ASSIGNED" };

  // 幂等：同提交 ID 已存在
  const existing = ctx.ledger.submissions.find((s) => s.id === submissionId);
  if (existing) {
    return {
      ok: true,
      state: ctx,
      value: { submissionId, status: existing.status, declaredWinnerTeamId: existing.declaredWinnerTeamId },
    };
  }

  const check = validateGames(input.games, match.boType);
  if (!check.ok) return { ok: false, error: check.message ?? "比分不合法", code: "INVALID_GAMES" };

  const winnerTeamId = determineWinnerTeamId(match, input.games);
  const policy: MatchReviewPolicy = ctx.reviewPolicy ?? { forcedRounds: [...FORCED_ROUNDS_DEFAULT], forceReview: false };

  // 同场已有 accepted 提交 → 更正路径（decision 5）
  const accepted = ctx.ledger.submissions.find((s) => s.matchId === input.matchId && s.status === "accepted");
  if (accepted && accepted.declaredWinnerTeamId !== winnerTeamId) {
    const submission = toSubmission(input, submissionId, winnerTeamId, "needs-review");
    return {
      ok: true,
      state: { ...ctx, ledger: { ...ctx.ledger, submissions: [...ctx.ledger.submissions, submission] } },
      value: { submissionId, status: "needs-review", declaredWinnerTeamId: winnerTeamId },
      reason: "同场已存在生效赛果且结果冲突，进入复核",
    };
  }

  // 强制复核
  if (isForcedReviewRound(match, policy)) {
    const submission = toSubmission(input, submissionId, winnerTeamId, "needs-review");
    return {
      ok: true,
      state: { ...ctx, ledger: { ...ctx.ledger, submissions: [...ctx.ledger.submissions, submission] } },
      value: { submissionId, status: "needs-review", declaredWinnerTeamId: winnerTeamId },
      reason: "强制复核场次，进入管理员队列",
    };
  }

  // 非强制复核 + 规则一致 → 提交即生效
  return finalizeAccepted(
    ctx,
    input,
    submissionId,
    winnerTeamId,
    "裁判提交，规则一致，非强制复核，直接生效",
    "system",
    "result-engine",
  );
}

/** 生成 accepted 提交 + accept 决策 + 更新正式赛果，返回新状态 */
function finalizeAccepted(
  ctx: ResultContext,
  input: SubmitResultInput,
  submissionId: string,
  winnerTeamId: string,
  reason: string,
  actorType: ResultDecision["actorType"],
  actorId: string,
): ResultOpResult<SubmitValue> {
  const before = ctx.ledger.resultVersion;
  const after = before + 1;
  const decision = toDecision(`DEC-${submissionId}`, submissionId, "accept", actorType, actorId, reason, before, after);
  const submission: ResultSubmission = {
    ...toSubmission(input, submissionId, winnerTeamId, "accepted"),
    resolvedAt: decision.createdAt,
  };
  const match = ctx.matches.find((m) => m.id === input.matchId)!;
  const nextMatches = applyGameResultsToBracket(ctx.matches, match, input.games);
  // upsert：同 id 已存在（如 needs-review 转 accepted）则原地更新，避免产生重复记录
  const existed = ctx.ledger.submissions.some((s) => s.id === submissionId);
  const submissions = existed
    ? ctx.ledger.submissions.map((s) => (s.id === submissionId ? submission : s))
    : [...ctx.ledger.submissions, submission];
  return {
    ok: true,
    state: {
      ...ctx,
      matches: nextMatches,
      ledger: {
        submissions,
        decisions: [...ctx.ledger.decisions, decision],
        resultVersion: after,
      },
    },
    value: { submissionId, status: "accepted", declaredWinnerTeamId: winnerTeamId },
  };
}

// ---------------------------------------------------------------
// 管理员裁决 needs-review 提交
// ---------------------------------------------------------------

export interface ResolveReviewInput {
  submissionId: string;
  accept: boolean;
  actorId: string;
  reason: string;
}

/**
 * 管理员裁决一条 needs-review 提交。
 * accept → 更新正式赛果（其 declaredWinnerTeamId 与 games 来自该提交）。
 * reject → 标记 rejected，不碰正式赛果。
 */
export function resolveReviewOp(input: ResolveReviewInput, ctx: ResultContext): ResultOpResult<{ status: ResultSubmissionStatus }> {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, error: "裁决原因不能为空", code: "REASON_REQUIRED" };
  const submission = ctx.ledger.submissions.find((s) => s.id === input.submissionId);
  if (!submission) return { ok: false, error: "提交记录不存在", code: "SUBMISSION_NOT_FOUND" };
  if (submission.status !== "needs-review") {
    return { ok: false, error: `提交状态为 ${submission.status}，不可裁决`, code: "NOT_PENDING" };
  }

  const match = ctx.matches.find((m) => m.id === submission.matchId);
  if (!match) return { ok: false, error: "比赛不存在", code: "MATCH_NOT_FOUND" };

  if (!input.accept) {
    const decision = toDecision(`DEC-${submission.id}-rej`, submission.id, "reject", "admin", input.actorId, reason, ctx.ledger.resultVersion, ctx.ledger.resultVersion);
    const updated: ResultSubmission = { ...submission, status: "rejected", resolvedAt: decision.createdAt, resolutionReason: reason };
    return {
      ok: true,
      state: {
        ...ctx,
        ledger: {
          submissions: ctx.ledger.submissions.map((s) => (s.id === submission.id ? updated : s)),
          decisions: [...ctx.ledger.decisions, decision],
          resultVersion: ctx.ledger.resultVersion,
        },
      },
      value: { status: "rejected" },
    };
  }

  // accept
  return finalizeAccepted(
    ctx, // finalizeAccepted 需要 SubmitResultInput，这里用提交记录还原
    {
      matchId: submission.matchId,
      refereeId: submission.submittedByRefereeId,
      basedOnScheduleVersion: submission.basedOnScheduleVersion,
      games: submission.games,
      evidenceIds: submission.evidenceIds,
      source: submission.source,
      submissionId: submission.id,
    },
    submission.id,
    submission.declaredWinnerTeamId,
    reason,
    "admin",
    input.actorId,
  );
}

// ---------------------------------------------------------------
// 已生效赛果更正（decision 5 + 6）
// ---------------------------------------------------------------

export interface CorrectResultInput {
  matchId: string;
  actorId: string;
  reason: string;
  newGames: GameResult[];
}

/**
 * 受控更正已生效赛果。
 * - 下游已 BP / 已完赛 → 阻止自动覆盖（decision 6），返回错误。
 * - 否则生成新提交（accepted）+ supersede 决策，更新正式赛果。
 */
export function correctResultOp(input: CorrectResultInput, ctx: ResultContext): ResultOpResult<{ submissionId: string }> {
  const match = ctx.matches.find((m) => m.id === input.matchId);
  if (!match) return { ok: false, error: "比赛不存在", code: "MATCH_NOT_FOUND" };
  const reason = input.reason.trim();
  if (!reason) return { ok: false, error: "更正原因不能为空", code: "REASON_REQUIRED" };
  const accepted = ctx.ledger.submissions.find((s) => s.matchId === input.matchId && s.status === "accepted");
  if (!accepted) return { ok: false, error: "该比赛没有已生效赛果", code: "NO_ACCEPTED_RESULT" };
  const check = validateGames(input.newGames, match.boType);
  if (!check.ok) return { ok: false, error: check.message ?? "比分不合法", code: "INVALID_GAMES" };
  const winnerTeamId = determineWinnerTeamId(match, input.newGames);

  const impact = computeDownstreamImpact(match, ctx.matches);
  if (impact.hasProgressedDownstream) {
    return { ok: false, error: `下游已 BP 或已完赛，禁止自动覆盖，进入人工恢复。受影响比赛：${impact.affectedMatchIds.join(",")}`, code: "DOWNSTREAM_PROGRESSED" };
  }

  const submissionId = `CR-${input.matchId}-${ctx.ledger.resultVersion + 1}`;
  const before = ctx.ledger.resultVersion;
  const after = before + 1;
  const decision = toDecision(`DEC-${submissionId}`, submissionId, "supersede", "admin", input.actorId, reason, before, after);
  const submission: ResultSubmission = {
    id: submissionId,
    matchId: input.matchId,
    submittedByRefereeId: input.actorId,
    basedOnScheduleVersion: ctx.scheduleVersion,
    games: input.newGames,
    declaredWinnerTeamId: winnerTeamId,
    evidenceIds: [],
    source: "manual",
    status: "accepted",
    submittedAt: decision.createdAt,
    resolvedAt: decision.createdAt,
    resolutionReason: reason,
  };

  // 将被更正比赛的旧 accepted 提交标记 superseded
  const supersededSubmissions = ctx.ledger.submissions.map((s) =>
    s.matchId === input.matchId && s.status === "accepted" ? { ...s, status: "superseded" as const } : s,
  );

  const nextMatches = applyGameResultsToBracket(ctx.matches, match, input.newGames);

  return {
    ok: true,
    state: {
      ...ctx,
      matches: nextMatches,
      ledger: {
        submissions: [...supersededSubmissions, submission],
        decisions: [...ctx.ledger.decisions, decision],
        resultVersion: after,
      },
    },
    value: { submissionId },
  };
}

export { buildSubmissionId };
function buildSubmissionId(input: SubmitResultInput): string {
  const gamesStr = JSON.stringify(input.games.map((g) => [g.map ?? "", g.teamAScore, g.teamBScore]));
  return `${input.matchId}|${input.refereeId}|v${input.basedOnScheduleVersion}|${gamesStr}`;
}
