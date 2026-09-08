// =====================
// RPT-04 裁判报分服务编排层（对应工作包 02 §6）
// 把 RPT-01（赛果）、RPT-02（裁判身份/凭证）、RPT-03（凭证）组合成可测的原子服务能力。
// 无 Supabase、无 HTTP：凭证鉴权 + 提交 + 证据关联 + 权限推导在同一聚合根内完成。
// 服务端权限铁律（ADR §5）：每次写操作从「凭证 → 身份 → 分配关系」推导，
// 绝不信任客户端传入的 refereeId 或角色字段。
// =====================

import type { ScheduleMatch } from "./schedule-data";
import {
  computeDownstreamImpact,
  emptyLedger as emptyResultLedger,
  submitResultOp,
  type ResultContext,
  type SubmitValue,
} from "./result-ops";
import { FORCED_ROUNDS_DEFAULT } from "./result-domain";
import type { DownstreamImpact, ResultLedger, ResultSubmission } from "./result-domain";
import type { SubmitResultInput } from "./result-domain";
import {
  authenticateReferee,
  authorizeReferee,
  emptyRefereeLedger,
} from "./referee-ops";
import type { RefereeLedger } from "./referee-domain";
import {
  attachEvidenceOp,
  emptyEvidenceLedger,
  registerEvidenceOp,
  type EvidenceOpResult,
} from "./evidence-ops";
import type { EvidenceLedger } from "./evidence-domain";

/** RPT-04 聚合根：赛果 + 裁判 + 凭证三个台账 + 正式赛果 + 当前赛程版本 */
export interface ReportingState {
  matches: ScheduleMatch[];
  scheduleVersion: number;
  referee: RefereeLedger;
  result: ResultLedger;
  evidence: EvidenceLedger;
}

/** 操作结果：成功返回新聚合根 + 值，失败返回错误码（沿用 OpResult 纪律，无 any/绕过） */
export type ReportingOpResult<T = undefined> =
  | { ok: true; state: ReportingState; value?: T; reason?: string }
  | { ok: false; error: string; code?: string; state?: undefined; value?: undefined };

export function emptyReportingState(matches: ScheduleMatch[], scheduleVersion: number): ReportingState {
  return {
    matches,
    scheduleVersion,
    referee: emptyRefereeLedger(),
    result: emptyResultLedger(),
    evidence: emptyEvidenceLedger(),
  };
}

/** 投影：裁判台账的分配关系 → 赛果上下文的权威分配视图（查询级简化） */
export function toResultAssignments(referee: RefereeLedger): ResultContext["assignments"] {
  return referee.assignments
    .filter((a) => a.status === "assigned")
    .map((a) => ({ matchId: a.matchId, refereeId: a.refereeId, status: a.status }));
}

/** 从聚合根组装赛果上下文（提交/裁决/更正共用的构造点） */
export function buildResultContext(state: ReportingState): ResultContext {
  return {
    matches: state.matches,
    ledger: state.result,
    scheduleVersion: state.scheduleVersion,
    assignments: toResultAssignments(state.referee),
  };
}

/** 把凭证从草稿挂到提交（一张凭证只能挂一个提交，同提交幂等） */
function attachEvidence(evidenceIds: string[], matchId: string, submissionId: string, evidence: EvidenceLedger): EvidenceOpResult {
  let next = evidence;
  for (const id of evidenceIds) {
    const result = attachEvidenceOp({ evidenceId: id, submissionId, matchId }, next);
    if (!result.ok) return result;
    next = result.state!;
  }
  return { ok: true, state: next };
}

// ---------------------------------------------------------------
// 统一鉴权入口：凭证 → 身份（不检查单场，供登录/我的比赛）
// ---------------------------------------------------------------

export function loginRefereeOp(
  credential: string,
  eventId: string,
  state: ReportingState,
  nowTime?: string,
): ReportingOpResult<{ refereeId: string }> {
  const auth = authenticateReferee(credential, eventId, state.referee, nowTime);
  if (!auth.ok) return { ok: false, error: auth.reason, code: auth.reason };
  return { ok: true, state, value: { refereeId: auth.refereeId } };
}

// ---------------------------------------------------------------
// 提交赛果（裁判）：凭证鉴权 + 分配关系推导 + 证据挂载 + 状态机提交
// ---------------------------------------------------------------

export interface RefereeSubmitInput {
  credential: string;
  eventId: string;
  matchId: string;
  basedOnScheduleVersion: number;
  games: SubmitResultInput["games"];
  evidenceIds?: string[];
  source?: SubmitResultInput["source"];
}

/**
 * 裁判提交赛果（atomic）。
 * 顺序：凭证→身份→分配（authorizeReferee）→ 证据已注册且同场 → submitResultOp。
 * refereeId 由服务端从凭证推导，输入里没有 refereeId 字段（铁律）。
 */
export function submitRefereeResultOp(
  input: RefereeSubmitInput,
  state: ReportingState,
): ReportingOpResult<SubmitValue> {
  // 1. 越权 / 未分配 / 凭证失效 → 统一拒绝
  const auth = authorizeReferee(input.credential, input.eventId, input.matchId, state.referee);
  if (!auth.ok) return { ok: false, error: auth.reason, code: auth.reason };

  // 2. 证据须已注册且同属这场比赛（先传后挂，草稿挂起）
  const evidenceIds = input.evidenceIds ?? [];
  for (const id of evidenceIds) {
    const ev = state.evidence.evidence.find((e) => e.id === id);
    if (!ev) return { ok: false, error: "凭证不存在", code: "EVIDENCE_NOT_FOUND" };
    if (ev.matchId !== input.matchId) return { ok: false, error: "凭证与提交不属于同一场比赛", code: "EVIDENCE_MATCH_MISMATCH" };
  }

  // 3. 组合赛果上下文并提交（版本冲突 / 比分非法 / 强力复核由 submitResultOp 判定）
  const ctx = buildResultContext(state);
  const submitted = submitResultOp(
    {
      matchId: input.matchId,
      refereeId: auth.refereeId,
      basedOnScheduleVersion: input.basedOnScheduleVersion,
      games: input.games,
      evidenceIds,
      source: input.source ?? "manual",
    },
    ctx,
  );

  if (!submitted.ok) return { ok: false, error: submitted.error, code: submitted.code };

  // 4. 把证据挂到新提交（同受控更新内完成；幂等：同提交重复提交不改变挂载）
  const attached = attachEvidence(evidenceIds, input.matchId, submitted.value.submissionId, state.evidence);
  if (!attached.ok) return { ok: false, error: attached.error, code: attached.code };

  return {
    ok: true,
    state: {
      ...state,
      matches: submitted.state.matches,
      result: submitted.state.ledger,
      evidence: attached.state!,
    },
    value: submitted.value,
    reason: submitted.reason,
  };
}

// ---------------------------------------------------------------
// 证据上传（裁判）：先传后挂的草稿阶段
// ---------------------------------------------------------------

export interface RefereeEvidenceInput {
  credential: string;
  eventId: string;
  matchId: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  eventEndsAt: string;
}

/**
 * 裁判上传凭证草稿。鉴权：凭证→身份→分配（须已分配该比赛）。
 * 只注册不挂提交，挂载在 submitRefereeResultOp 一步完成。
 */
export function uploadRefereeEvidenceOp(
  input: RefereeEvidenceInput,
  state: ReportingState,
): ReportingOpResult<{ evidenceId: string; objectPath: string; expiresAt: string }> {
  const auth = authorizeReferee(input.credential, input.eventId, input.matchId, state.referee);
  if (!auth.ok) return { ok: false, error: auth.reason, code: auth.reason };

  const registered = registerEvidenceOp(
    {
      eventId: input.eventId,
      matchId: input.matchId,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
      uploadedByRefereeId: auth.refereeId,
      eventEndsAt: input.eventEndsAt,
    },
    state.evidence,
  );
  if (!registered.ok) return { ok: false, error: registered.error, code: registered.code };

  return {
    ok: true,
    state: { ...state, evidence: registered.state! },
    value: registered.value,
  };
}

// ---------------------------------------------------------------
// 最小化投影：对外不泄露凭证 / 内部 ID / 哈希
// ---------------------------------------------------------------

/** 裁判端「我的比赛」列表：只返回被分配比赛的必要字段 */
export function projectMyMatches(state: ReportingState, refereeId: string): Array<{
  matchId: string;
  teamAName: string;
  teamBName: string;
  boType: string;
  status: string;
}> {
  const assigned = state.referee.assignments
    .filter((a) => a.refereeId === refereeId && a.status === "assigned")
    .map((a) => a.matchId);
  return state.matches
    .filter((m) => assigned.includes(m.id))
    .map((m) => ({ matchId: m.id, teamAName: m.teamAName, teamBName: m.teamBName, boType: m.boType, status: m.status }));
}

/** 公开端赛程：只返回已 accepted 的正式赛果（不暴露提交记录、凭证、哈希、内部 ID） */
export function projectPublicResults(state: ReportingState): Array<{
  matchId: string;
  teamAName: string;
  teamBName: string;
  winnerTeamName: string;
  games: SubmitResultInput["games"];
}> {
  const acceptedMatchIds = new Set(
    state.result.submissions.filter((s) => s.status === "accepted").map((s) => s.matchId),
  );
  return state.matches
    .filter((m) => acceptedMatchIds.has(m.id) && m.winnerTeamId)
    .map((m) => {
      const winnerName = m.winnerTeamId === m.teamAId ? m.teamAName : m.teamBName;
      const submission = state.result.submissions.find((s) => s.matchId === m.id && s.status === "accepted");
      return {
        matchId: m.id,
        teamAName: m.teamAName,
        teamBName: m.teamBName,
        winnerTeamName: winnerName,
        games: submission?.games ?? [],
      };
    });
}

// ---------------------------------------------------------------
// 管理员异常队列投影（RPT-06）
// 数据源：result 台账里 status === "needs-review" 的提交。
// 风险标签两类：强制复核（半决赛/决赛） / 结果冲突（同场已有 accepted 但胜者相反）。
// ---------------------------------------------------------------

export type ReviewRiskTag = "强制复核" | "结果冲突";

/** 一条待裁决异常（管理员工作台行级视图） */
export interface AdminReviewItem {
  submissionId: string;
  matchId: string;
  teamAId: string;
  teamBId: string;
  teamAName: string;
  teamBName: string;
  boType: string;
  round: string;
  /** 系统从提交比分判定的胜者队伍名 */
  declaredWinnerTeamName: string;
  /** 提交的裁判（displayName 兜底「未知裁判」） */
  refereeName: string;
  basedOnScheduleVersion: number;
  submittedAt: string;
  riskTag: ReviewRiskTag;
  /** 风险一句话说明（列表行直接呈现「为什么进来」） */
  riskReason: string;
  games: SubmitResultInput["games"];
  evidenceIds: string[];
  /** 同场已有 accepted 提交（结果冲突场景存在），用于对比 */
  existingAcceptedWinnerTeamName?: string;
  /** 下游影响判定（已排期/已推进的下游比赛） */
  downstreamImpact: DownstreamImpact;
}

/** 判定一条 needs-review 提交的风险标签：结果冲突优先于强制复核（冲突是更需警惕的信号） */
function reviewRiskTag(
  state: ReportingState,
  submission: Pick<ResultSubmission, "matchId" | "declaredWinnerTeamId">,
): ReviewRiskTag {
  const conflicting = state.result.submissions.some(
    (s) => s.matchId === submission.matchId && s.status === "accepted" && s.declaredWinnerTeamId !== submission.declaredWinnerTeamId,
  );
  if (conflicting) return "结果冲突";
  return "强制复核";
}

/** 管理员异常队列：投影全部 needs-review 提交，含风险原因 + 下游影响，供工作台渲染 */
export function projectAdminReviewQueue(state: ReportingState): AdminReviewItem[] {
  return state.result.submissions
    .filter((s) => s.status === "needs-review")
    .map((s) => {
      const m = state.matches.find((m) => m.id === s.matchId);
      const referee = state.referee.referees.find((r) => r.id === s.submittedByRefereeId);
      const existingAccepted = state.result.submissions.find(
        (x) => x.matchId === s.matchId && x.status === "accepted",
      );
      const tag = reviewRiskTag(state, s);
      const forcedRound = [...FORCED_ROUNDS_DEFAULT].some((r) => m?.round === r);
      return {
        submissionId: s.id,
        matchId: s.matchId,
        teamAId: m?.teamAId ?? "",
        teamBId: m?.teamBId ?? "",
        teamAName: m?.teamAName ?? "（未找到对阵）",
        teamBName: m?.teamBName ?? "（未找到对阵）",
        boType: m?.boType ?? "",
        round: m?.round ?? "",
        declaredWinnerTeamName: s.declaredWinnerTeamId === m?.teamAId
          ? (m?.teamAName ?? "")
          : (m?.teamBName ?? ""),
        refereeName: referee?.displayName ?? "未知裁判",
        basedOnScheduleVersion: s.basedOnScheduleVersion,
        submittedAt: s.submittedAt,
        riskTag: tag,
        riskReason: tag === "结果冲突"
          ? `裁判判定 ${s.declaredWinnerTeamId === m?.teamAId ? m?.teamAName : m?.teamBName} 胜，但与已生效赛果相反`
          : forcedRound
            ? "半决赛/决赛强制复核场次"
            : "需要管理员复核",
        games: s.games,
        evidenceIds: s.evidenceIds,
        existingAcceptedWinnerTeamName: existingAccepted
          ? (existingAccepted.declaredWinnerTeamId === m?.teamAId ? m?.teamAName : m?.teamBName)
          : undefined,
        downstreamImpact: m ? computeDownstreamImpact(m, state.matches) : { hasScheduledDownstream: false, hasProgressedDownstream: false, affectedMatchIds: [] },
      };
    });
}

/** 已生效赛果（accepted），供管理员「受控更正」选择；带下游影响，缺 teamId 用展示名兜底 */
export interface AcceptedResultItem {
  matchId: string;
  teamAId: string;
  teamBId: string;
  teamAName: string;
  teamBName: string;
  boType: string;
  round: string;
  winnerTeamId: string;
  winnerTeamName: string;
  games: SubmitResultInput["games"];
  resultVersion: number;
  downstreamImpact: DownstreamImpact;
}

/** 管理员受控更正列表：全部 accepted 正式赛果（含下游影响） */
export function projectAcceptedResults(state: ReportingState): AcceptedResultItem[] {
  // 每场比赛取最新 accepted（submissions 按提交顺序追加，latest accepted 覆盖旧）
  const latestAccepted = new Map<string, ResultSubmission>();
  for (const s of state.result.submissions) {
    if (s.status === "accepted") latestAccepted.set(s.matchId, s);
  }
  return state.matches
    .filter((m) => latestAccepted.has(m.id))
    .map((m) => {
      const s = latestAccepted.get(m.id)!;
      return {
        matchId: m.id,
        teamAId: m.teamAId,
        teamBId: m.teamBId,
        teamAName: m.teamAName,
        teamBName: m.teamBName,
        boType: m.boType,
        round: m.round ?? "",
        winnerTeamId: s.declaredWinnerTeamId,
        winnerTeamName: s.declaredWinnerTeamId === m.teamAId ? m.teamAName : m.teamBName,
        games: s.games,
        resultVersion: state.result.resultVersion,
        downstreamImpact: computeDownstreamImpact(m, state.matches),
      };
    });
}