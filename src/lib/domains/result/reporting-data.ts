// =====================
// RPT-05 裁判报分数据访问层（可拔插）
// 数据持久化复用项目现有 data-store 抽象：本地 file / 生产 supabase 靠 DATA_BACKEND 一键切换。
// 三个台账（referee / result / evidence）作为 event 文档存储，正式赛果写入已有的 schedule 文档。
// 本层不产生真实 Supabase 调用（靠 data-store 路由），验证留到接云端时执行。
// =====================

import "server-only";

import { readEventData, updateEventData, updateEventDataBatch, writeEventData } from "@/lib/data-store";
import { isHostedRuntime } from "@/lib/deployment";
import { deleteEvidenceObject, storeEvidenceObject } from "@/lib/domains/result/evidence-store";
import { emptySchedule, normalizeScheduleState, type ScheduleMatch, type ScheduleState } from "@/lib/domains/schedule/schedule-data";
import type { BOType } from "@/lib/domains/schedule/rule-engine";
import {
  emptyRefereeLedger,
  createRefereeOp,
  assignMatchOp,
  claimMatchOp,
  releaseClaimOp,
  disableRefereeOp,
  resetCredentialOp,
  revokeAssignmentOp,
  authenticateReferee,
  hashCredential,
  type RefereeOpResult,
} from "@/lib/domains/schedule/referee-ops";
import type { RefereeLedger } from "@/lib/domains/schedule/referee-domain";
import { emptyLedger as emptyResultLedger } from "@/lib/domains/schedule/result-ops";
import type { ResultLedger } from "@/lib/domains/schedule/result-domain";
import { checkEvidenceFile, emptyEvidenceLedger, registerEvidenceOp } from "@/lib/domains/schedule/evidence-ops";
import type { EvidenceLedger } from "@/lib/domains/schedule/evidence-domain";
import {
  loginRefereeOp,
  submitRefereeResultOp,
  uploadRefereeEvidenceOp,
  projectMyMatches,
  projectOpenMatches,
  projectAdminReviewQueue,
  projectAcceptedResults,
  buildResultContext,
  type MyMatchSummary,
  type OpenMatchSummary,
  type ReportingOpResult,
  type ReportingState,
} from "@/lib/domains/schedule/reporting-service";
import { resolveReviewOp, correctResultOp } from "@/lib/domains/schedule/result-ops";
import { expirePendingRequests, stampScheduleVersion } from "@/lib/domains/schedule/schedule-ops";
import {
  initialRegistration,
  normalizeRegistrationState,
  type RegistrationState,
} from "@/lib/domains/registration/data";
import { buildSquadsByTeamId } from "@/lib/domains/result/identity-match";

// 文档名（须通过 assertSafeDocumentName：仅 a-zA-Z0-9_-）
const DOC_REFEREE = "referee-ledger";
const DOC_RESULT = "result-ledger";
const DOC_EVIDENCE = "evidence-ledger";

type ReportingDocuments = {
  schedule: ScheduleState;
  referee: RefereeLedger;
  result: ResultLedger;
  evidence: EvidenceLedger;
};

const REPORTING_DOCUMENTS = {
  schedule: { name: "schedule", fallback: emptySchedule() },
  referee: { name: DOC_REFEREE, fallback: emptyRefereeLedger() },
  result: { name: DOC_RESULT, fallback: emptyResultLedger() },
  evidence: { name: DOC_EVIDENCE, fallback: emptyEvidenceLedger() },
};

/** 演示赛事 ID（本地开发用，绝不碰真实赛事数据）。接云端后由管理员分配的登录链接带真实 eventId。 */
const DEMO_EVENT_ID = "demo-referee";

/** 从各文档组装 RPT-04 聚合根 */
export type { AdminReviewItem, AcceptedResultItem, ReviewRiskTag } from "@/lib/domains/schedule/reporting-service";

/** 一次读取同时生成异常队列与已生效列表，避免同一请求重复读取四份文档。 */
export async function adminReviewData(eventId: string) {
  const state = await loadReportingState(eventId);
  return { queue: projectAdminReviewQueue(state), accepted: projectAcceptedResults(state) };
}

/** 管理员裁决一条 needs-review 提交（accept 写入正式赛果 + 晋级；reject 不碰正式赛果） */
export async function adminResolveReview(
  eventId: string,
  input: { submissionId: string; accept: boolean; actorId: string; reason: string },
) {
  return updateReportingState(eventId, (state) => {
    const result = resolveReviewOp(
      { submissionId: input.submissionId, accept: input.accept, actorId: input.actorId, reason: input.reason },
      buildResultContext(state),
    );
    if (!result.ok) return result;
    return {
      ok: true,
      state: { ...state, matches: result.state.matches, result: result.state.ledger },
      value: result.value,
    };
  });
}

/** 管理员受控更正已生效赛果（下游已进度则被纯函数阻止，绝不自动覆盖） */
export async function adminCorrectResult(
  eventId: string,
  input: { matchId: string; actorId: string; reason: string; newGames: Parameters<typeof correctResultOp>[0]["newGames"] },
) {
  return updateReportingState(eventId, (state) => {
    const result = correctResultOp(
      { matchId: input.matchId, actorId: input.actorId, reason: input.reason, newGames: input.newGames },
      buildResultContext(state),
    );
    if (!result.ok) return result;
    return {
      ok: true,
      state: { ...state, matches: result.state.matches, result: result.state.ledger },
      value: result.value,
    };
  });
}

// =====================
// 管理员裁判管理（RPT-07a）
// 复用管理员 session 鉴权（route 层），这里只做数据读写 + 纯函数编排。
// 创建/重置返回一次性凭证明文；停用立即拒绝后续写操作。
// =====================

/** 裁判列表投影：只给管理员返回必要展示字段，绝不返回 credentialHash */
export async function adminListReferees(eventId: string) {
  const { schedule, referee } = await loadScheduleAndReferees(eventId);
  const referees = referee.referees.map((r) => ({
    id: r.id,
    displayName: r.displayName,
    status: r.status,
    credentialExpiresAt: r.credentialExpiresAt,
    createdAt: r.createdAt,
    disabledAt: r.disabledAt,
    assignmentCount: referee.assignments.filter((a) => a.refereeId === r.id && a.status === "assigned").length,
  }));
  const matches = schedule.matches.map((m) => ({
    matchId: m.id,
    teamAName: m.teamAName,
    teamBName: m.teamBName,
    boType: m.boType,
    round: m.round ?? "",
    status: m.status,
    assignedRefereeIds: referee.assignments
      .filter((a) => a.matchId === m.id && a.status === "assigned")
      .map((a) => a.refereeId),
  }));
  // 真实分配关系（含 assignmentId，供撤销动作准确定位）
  // selfClaimed 让负责人分得清「裁判自己认领的」与「我指派给他的」——
  // 前者要改派时裁判可自行释放，后者需要负责人撤销。
  const assignments = referee.assignments
    .filter((a) => a.status === "assigned")
    .map((a) => ({
      assignmentId: a.id,
      matchId: a.matchId,
      refereeId: a.refereeId,
      selfClaimed: a.selfClaimed === true,
    }));
  return { referees, matches, assignments };
}

export async function adminCreateReferee(
  eventId: string,
  input: { displayName: string; actorId: string; credentialExpiresAt: string },
) {
  return updateReportingState(eventId, (state) => {
    const result = createRefereeOp(
      { eventId, displayName: input.displayName, actorId: input.actorId, credentialExpiresAt: input.credentialExpiresAt },
      state.referee,
    ) as RefereeOpResult<{ refereeId: string; credential: string }>;
    if (!result.ok) return result;
    return { ok: true, state: { ...state, referee: result.state }, value: result.value };
  });
}

export async function adminDisableReferee(eventId: string, input: { refereeId: string; actorId: string }) {
  return updateReportingState(eventId, (state) => {
    const result = disableRefereeOp(input.refereeId, input.actorId, state.referee);
    if (!result.ok) return result;
    return { ok: true, state: { ...state, referee: result.state }, value: { disabled: true } };
  });
}

export async function adminResetCredential(eventId: string, input: { refereeId: string; actorId: string; newCredentialExpiresAt: string }) {
  return updateReportingState(eventId, (state) => {
    const result = resetCredentialOp(
      { refereeId: input.refereeId, actorId: input.actorId, newCredentialExpiresAt: input.newCredentialExpiresAt },
      state.referee,
    ) as RefereeOpResult<{ credential: string }>;
    if (!result.ok) return result;
    return { ok: true, state: { ...state, referee: result.state }, value: { credential: result.value!.credential } };
  });
}

export async function adminAssignMatch(eventId: string, input: { refereeId: string; matchId: string; actorId: string }) {
  return updateReportingState(eventId, (state) => {
    if (!state.matches.some((match) => match.id === input.matchId)) {
      return { ok: false, error: "比赛不存在", code: "MATCH_NOT_FOUND" };
    }
    const result = assignMatchOp({ eventId, refereeId: input.refereeId, matchId: input.matchId, actorId: input.actorId }, state.referee);
    if (!result.ok) return result;
    return { ok: true, state: { ...state, referee: result.state }, value: result.value };
  });
}

export async function adminRevokeAssignment(eventId: string, input: { assignmentId: string; actorId: string }) {
  return updateReportingState(eventId, (state) => {
    const result = revokeAssignmentOp({ assignmentId: input.assignmentId, actorId: input.actorId }, state.referee);
    if (!result.ok) return result;
    return { ok: true, state: { ...state, referee: result.state }, value: { revoked: true } };
  });
}

import { loadReportingState, loadScheduleAndReferees, updateReportingState } from "./reporting-state.ts";

// =====================
// 门面（2026-10-26）：裁判端已拆到 `reporting-referee.ts`，基础层在 `reporting-state.ts`。
// 这里原样转出，**调用点零改动**。
// =====================
export { loadReportingState, seedDemoReporting } from "./reporting-state.ts";
export {
  refereeLogin, refereeMyMatches, refereeMatchContext, refereeOpenMatches,
  refereeClaimMatch, refereeReleaseMatch, refereeSubmit, refereeUploadEvidence,
} from "./reporting-referee.ts";
export type { RefereeLoginResult } from "./reporting-referee.ts";
