// =====================
// RPT-05 裁判报分数据访问层（可拔插）
// 数据持久化复用项目现有 data-store 抽象：本地 file / 生产 supabase 靠 DATA_BACKEND 一键切换。
// 三个台账（referee / result / evidence）作为 event 文档存储，正式赛果写入已有的 schedule 文档。
// 本层不产生真实 Supabase 调用（靠 data-store 路由），验证留到接云端时执行。
// =====================

import { readEventData, writeEventData } from "@/lib/data-store";
import { isHostedRuntime } from "@/lib/deployment";
import { emptySchedule, normalizeScheduleState, type ScheduleMatch, type ScheduleState } from "@/lib/scheduling/schedule-data";
import type { BOType } from "@/lib/scheduling/rule-engine";
import {
  emptyRefereeLedger,
  createRefereeOp,
  assignMatchOp,
  disableRefereeOp,
  resetCredentialOp,
  revokeAssignmentOp,
  hashCredential,
  type RefereeOpResult,
} from "@/lib/scheduling/referee-ops";
import type { RefereeLedger } from "@/lib/scheduling/referee-domain";
import { emptyLedger as emptyResultLedger } from "@/lib/scheduling/result-ops";
import type { ResultLedger } from "@/lib/scheduling/result-domain";
import { emptyEvidenceLedger } from "@/lib/scheduling/evidence-ops";
import type { EvidenceLedger } from "@/lib/scheduling/evidence-domain";
import {
  loginRefereeOp,
  submitRefereeResultOp,
  uploadRefereeEvidenceOp,
  projectMyMatches,
  projectPublicResults,
  projectAdminReviewQueue,
  projectAcceptedResults,
  buildResultContext,
  type ReportingState,
} from "@/lib/scheduling/reporting-service";
import { resolveReviewOp, correctResultOp } from "@/lib/scheduling/result-ops";

// 文档名（须通过 assertSafeDocumentName：仅 a-zA-Z0-9_-）
export const DOC_REFEREE = "referee-ledger";
export const DOC_RESULT = "result-ledger";
export const DOC_EVIDENCE = "evidence-ledger";

/** 演示赛事 ID（本地开发用，绝不碰真实赛事数据）。接云端后由管理员分配的登录链接带真实 eventId。 */
export const DEMO_EVENT_ID = "demo-referee";

/** 从各文档组装 RPT-04 聚合根 */
export async function loadReportingState(eventId: string): Promise<ReportingState> {
  const [scheduleRaw, referee, result, evidence] = await Promise.all([
    readEventData<ScheduleState>(eventId, "schedule", emptySchedule()),
    readEventData<RefereeLedger>(eventId, DOC_REFEREE, emptyRefereeLedger()),
    readEventData<ResultLedger>(eventId, DOC_RESULT, emptyResultLedger()),
    readEventData<EvidenceLedger>(eventId, DOC_EVIDENCE, emptyEvidenceLedger()),
  ]);
  const schedule = normalizeScheduleState(scheduleRaw);
  return {
    matches: schedule.matches,
    scheduleVersion: schedule.version,
    referee,
    result,
    evidence,
  };
}

/** 把聚合根拆回各文档（正式赛果写回 schedule 的 matches，台账各归各位） */
export async function saveReportingState(eventId: string, state: ReportingState): Promise<void> {
  const scheduleRaw = await readEventData<ScheduleState>(eventId, "schedule", emptySchedule());
  const schedule = normalizeScheduleState(scheduleRaw);
  const nextSchedule: ScheduleState = { ...schedule, matches: state.matches };
  await Promise.all([
    writeEventData(eventId, "schedule", nextSchedule),
    writeEventData(eventId, DOC_REFEREE, state.referee),
    writeEventData(eventId, DOC_RESULT, state.result),
    writeEventData(eventId, DOC_EVIDENCE, state.evidence),
  ]);
}

// =====================
// 演示 seed（仅本地 file 后端 + DEMO_EVENT_ID，幂等）
// =====================

/** 固定演示凭证（可复现，本地开发用；长度须 ≥20 满足 checkCredential） */
export const DEMO_CREDENTIAL = "referee-demo-credential-2026-09";

function demoMatch(id: string, teamAId: string, teamAName: string, teamBId: string, teamBName: string, startTime: string): ScheduleMatch {
  const teamA = teamAId;
  const teamB = teamBId;
  const boType: BOType = "BO3";
  const match: ScheduleMatch = {
    id,
    phase: "小组赛",
    round: "第一轮",
    teamAId: teamA,
    teamAName,
    teamBId: teamB,
    teamBName,
    boType,
    startTime,
    endTime: "",
    status: "已排期",
    frozen: false,
  };
  return match;
}

/**
 * 建演示环境：一场赛事 + 两名裁判（凭证固定）+ 已分配比赛 + 两场比赛。
 * 幂等：已有裁判台账则直接复用，不重复建。
 */
export async function seedDemoReporting(): Promise<{
  eventId: string;
  credential: string;
  refereeId: string;
  assignedMatchIds: string[];
}> {
  // 生产/托管环境绝不 seed 演示数据（铁律：不碰生产数据）
  if (isHostedRuntime()) {
    throw new Error("演示环境仅限本地开发使用");
  }
  const eventId = DEMO_EVENT_ID;
  const existing = await readEventData<RefereeLedger>(eventId, DOC_REFEREE, emptyRefereeLedger());
  const credential = DEMO_CREDENTIAL;
  const credentialHash = hashCredential(credential);

  // 已有裁判 → 返回现有分配
  if (existing.referees.length > 0) {
    const referee = existing.referees[0];
    const assigned = existing.assignments.filter((a) => a.status === "assigned").map((a) => a.matchId);
    return { eventId, credential, refereeId: referee.id, assignedMatchIds: assigned };
  }

  // 建两场 BO3（写入 schedule 文档，仅演示事件）
  const matches: ScheduleMatch[] = [
    demoMatch("M-R1", "team-a", "星辰电竞", "team-b", "暗影战队", "2026-10-06T12:00:00"),
    demoMatch("M-R2", "team-c", "烈焰先锋", "team-d", "寒冰之刃", "2026-10-06T14:00:00"),
  ];
  const schedule = normalizeScheduleState(emptySchedule());
  await writeEventData(eventId, "schedule", { ...schedule, version: 1, configConfirmed: true, matches });

  // 建裁判 + 分配 M-R1
  let referee: RefereeLedger = emptyRefereeLedger();
  const made = createRefereeOp(
    { eventId, displayName: "演示裁判", actorId: "demo-admin", credentialExpiresAt: "2026-12-31T23:59:59.000Z" },
    referee,
  ) as RefereeOpResult<{ refereeId: string; credential: string }>;
  referee = made.state!;
  const refereeId = made.value!.refereeId;

  // 用固定凭证覆盖（演示可复现）
  const identity = referee.referees.map((r) => (r.id === refereeId ? { ...r, credentialHash } : r));
  referee = { ...referee, referees: identity };

  const assigned = assignMatchOp({ eventId, matchId: "M-R1", refereeId, actorId: "demo-admin" }, referee);
  referee = assigned.state!;

  await writeEventData(eventId, DOC_REFEREE, referee);

  return { eventId, credential, refereeId, assignedMatchIds: ["M-R1"] };
}

// =====================
// 高阶操作（API route 层直接调用）
// =====================

export interface RefereeLoginResult {
  ok: boolean;
  refereeId?: string;
  error?: string;
}

export async function refereeLogin(eventId: string, credential: string): Promise<RefereeLoginResult> {
  if (eventId === DEMO_EVENT_ID) await seedDemoReporting();
  const state = await loadReportingState(eventId);
  const login = loginRefereeOp(credential, eventId, state);
  if (!login.ok) return { ok: false, error: login.code ?? login.error };
  return { ok: true, refereeId: login.value!.refereeId };
}

export async function refereeMyMatches(eventId: string, credential: string) {
  if (eventId === DEMO_EVENT_ID) await seedDemoReporting();
  const state = await loadReportingState(eventId);
  const login = loginRefereeOp(credential, eventId, state);
  if (!login.ok) return { ok: false, error: login.code ?? login.error };
  return { ok: true, matches: projectMyMatches(state, login.value!.refereeId), scheduleVersion: state.scheduleVersion };
}

export async function refereeSubmit(
  eventId: string,
  credential: string,
  input: { matchId: string; basedOnScheduleVersion: number; games: Parameters<typeof submitRefereeResultOp>[0]["games"]; evidenceIds?: string[] },
) {
  const state = await loadReportingState(eventId);
  const result = submitRefereeResultOp(
    { credential, eventId, matchId: input.matchId, basedOnScheduleVersion: input.basedOnScheduleVersion, games: input.games, evidenceIds: input.evidenceIds },
    state,
  );
  if (!result.ok) return { ok: false, error: result.error, code: result.code };
  await saveReportingState(eventId, result.state!);
  return { ok: true, value: result.value };
}

/**
 * 裁判上传凭证草稿（RPT-07a）。
 * 事件结束时间取赛程 config.stageEnd（用于计算 expiresAt = 当届结束 + 申诉保留期）。
 * 只注册台账、不挂提交；字节写入由路由层负责（storeEvidenceObject），挂载在提交时一步完成。
 */
export async function refereeUploadEvidence(
  eventId: string,
  credential: string,
  input: { matchId: string; mimeType: string; sizeBytes: number; sha256: string },
): Promise<{ ok: true; value: { evidenceId: string; objectPath: string; expiresAt: string } } | { ok: false; error: string; code?: string }> {
  const state = await loadReportingState(eventId);
  const scheduleRaw = await readEventData<ScheduleState>(eventId, "schedule", emptySchedule());
  const schedule = normalizeScheduleState(scheduleRaw);
  const eventEndsAt = schedule.config.stageEnd || "2026-12-31T23:59:59.000Z";
  const result = uploadRefereeEvidenceOp(
    {
      credential,
      eventId,
      matchId: input.matchId,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
      eventEndsAt,
    },
    state,
  );
  if (!result.ok) return { ok: false, error: result.error, code: result.code };
  await saveReportingState(eventId, result.state!);
  return { ok: true, value: result.value! };
}

// re-export 供 API/UI 层与纯函数对齐（避免 UI 直接 import scheduling 内部）
export { buildResultContext, projectPublicResults, uploadRefereeEvidenceOp };
export type { ReportingState };
export type { AdminReviewItem, AcceptedResultItem, ReviewRiskTag } from "@/lib/scheduling/reporting-service";

/** 读管理员异常队列（needs-review 提交投影） */
export async function adminReviewQueue(eventId: string) {
  const state = await loadReportingState(eventId);
  return projectAdminReviewQueue(state);
}

/** 读已生效赛果列表（供受控更正选择） */
export async function adminAcceptedResults(eventId: string) {
  const state = await loadReportingState(eventId);
  return projectAcceptedResults(state);
}

/** 管理员裁决一条 needs-review 提交（accept 写入正式赛果 + 晋级；reject 不碰正式赛果） */
export async function adminResolveReview(
  eventId: string,
  input: { submissionId: string; accept: boolean; actorId: string; reason: string },
) {
  const state = await loadReportingState(eventId);
  const result = resolveReviewOp(
    { submissionId: input.submissionId, accept: input.accept, actorId: input.actorId, reason: input.reason },
    buildResultContext(state),
  );
  if (!result.ok) return { ok: false, error: result.error, code: result.code };
  await saveReportingState(eventId, { ...state, matches: result.state!.matches, result: result.state!.ledger });
  return { ok: true, value: result.value };
}

/** 管理员受控更正已生效赛果（下游已进度则被纯函数阻止，绝不自动覆盖） */
export async function adminCorrectResult(
  eventId: string,
  input: { matchId: string; actorId: string; reason: string; newGames: Parameters<typeof correctResultOp>[0]["newGames"]; newWinnerTeamId: string },
) {
  const state = await loadReportingState(eventId);
  const result = correctResultOp(
    { matchId: input.matchId, actorId: input.actorId, reason: input.reason, newGames: input.newGames, newWinnerTeamId: input.newWinnerTeamId },
    buildResultContext(state),
  );
  if (!result.ok) return { ok: false, error: result.error, code: result.code };
  await saveReportingState(eventId, { ...state, matches: result.state!.matches, result: result.state!.ledger });
  return { ok: true, value: result.value };
}

// =====================
// 管理员裁判管理（RPT-07a）
// 复用管理员 session 鉴权（route 层），这里只做数据读写 + 纯函数编排。
// 创建/重置返回一次性凭证明文；停用立即拒绝后续写操作。
// =====================

/** 裁判列表投影：只给管理员返回必要展示字段，绝不返回 credentialHash */
export async function adminListReferees(eventId: string) {
  const state = await loadReportingState(eventId);
  const referees = state.referee.referees.map((r) => ({
    id: r.id,
    displayName: r.displayName,
    status: r.status,
    credentialExpiresAt: r.credentialExpiresAt,
    createdAt: r.createdAt,
    disabledAt: r.disabledAt,
    assignmentCount: state.referee.assignments.filter((a) => a.refereeId === r.id && a.status === "assigned").length,
  }));
  const matches = state.matches.map((m) => ({
    matchId: m.id,
    teamAName: m.teamAName,
    teamBName: m.teamBName,
    boType: m.boType,
    round: m.round ?? "",
    status: m.status,
    assignedRefereeIds: state.referee.assignments
      .filter((a) => a.matchId === m.id && a.status === "assigned")
      .map((a) => a.refereeId),
  }));
  // 真实分配关系（含 assignmentId，供撤销动作准确定位）
  const assignments = state.referee.assignments
    .filter((a) => a.status === "assigned")
    .map((a) => ({ assignmentId: a.id, matchId: a.matchId, refereeId: a.refereeId }));
  return { referees, matches, assignments };
}

export async function adminCreateReferee(
  eventId: string,
  input: { displayName: string; actorId: string; credentialExpiresAt: string },
) {
  const state = await loadReportingState(eventId);
  const result = createRefereeOp(
    { eventId, displayName: input.displayName, actorId: input.actorId, credentialExpiresAt: input.credentialExpiresAt },
    state.referee,
  ) as RefereeOpResult<{ refereeId: string; credential: string }>;
  if (!result.ok) return { ok: false, error: result.error, code: result.code };
  await saveReportingState(eventId, { ...state, referee: result.state! });
  return { ok: true, value: result.value };
}

export async function adminDisableReferee(eventId: string, input: { refereeId: string; actorId: string }) {
  const state = await loadReportingState(eventId);
  const result = disableRefereeOp(input.refereeId, input.actorId, state.referee);
  if (!result.ok) return { ok: false, error: result.error, code: result.code };
  await saveReportingState(eventId, { ...state, referee: result.state! });
  return { ok: true, value: { disabled: true } };
}

export async function adminResetCredential(eventId: string, input: { refereeId: string; actorId: string; newCredentialExpiresAt: string }) {
  const state = await loadReportingState(eventId);
  const result = resetCredentialOp(
    { refereeId: input.refereeId, actorId: input.actorId, newCredentialExpiresAt: input.newCredentialExpiresAt },
    state.referee,
  ) as RefereeOpResult<{ credential: string }>;
  if (!result.ok) return { ok: false, error: result.error, code: result.code };
  await saveReportingState(eventId, { ...state, referee: result.state! });
  return { ok: true, value: { credential: result.value!.credential } };
}

export async function adminAssignMatch(eventId: string, input: { refereeId: string; matchId: string; actorId: string }) {
  const state = await loadReportingState(eventId);
  const result = assignMatchOp({ eventId, refereeId: input.refereeId, matchId: input.matchId, actorId: input.actorId }, state.referee);
  if (!result.ok) return { ok: false, error: result.error, code: result.code };
  await saveReportingState(eventId, { ...state, referee: result.state! });
  return { ok: true, value: result.value };
}

export async function adminRevokeAssignment(eventId: string, input: { assignmentId: string; actorId: string }) {
  const state = await loadReportingState(eventId);
  const assignment = state.referee.assignments.find((a) => a.id === input.assignmentId);
  if (!assignment) return { ok: false, error: "分配关系不存在", code: "ASSIGNMENT_NOT_FOUND" };
  const result = revokeAssignmentOp({ assignmentId: input.assignmentId, actorId: input.actorId }, state.referee);
  if (!result.ok) return { ok: false, error: result.error, code: result.code };
  await saveReportingState(eventId, { ...state, referee: result.state! });
  return { ok: true, value: { revoked: true } };
}