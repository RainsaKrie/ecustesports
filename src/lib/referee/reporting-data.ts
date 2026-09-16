// =====================
// RPT-05 裁判报分数据访问层（可拔插）
// 数据持久化复用项目现有 data-store 抽象：本地 file / 生产 supabase 靠 DATA_BACKEND 一键切换。
// 三个台账（referee / result / evidence）作为 event 文档存储，正式赛果写入已有的 schedule 文档。
// 本层不产生真实 Supabase 调用（靠 data-store 路由），验证留到接云端时执行。
// =====================

import "server-only";

import { readEventData, updateEventData, updateEventDataBatch, writeEventData } from "@/lib/data-store";
import { isHostedRuntime } from "@/lib/deployment";
import { deleteEvidenceObject, storeEvidenceObject } from "@/lib/referee/evidence-store";
import { emptySchedule, normalizeScheduleState, type ScheduleMatch, type ScheduleState } from "@/lib/scheduling/schedule-data";
import type { BOType } from "@/lib/scheduling/rule-engine";
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
} from "@/lib/scheduling/referee-ops";
import type { RefereeLedger } from "@/lib/scheduling/referee-domain";
import { emptyLedger as emptyResultLedger } from "@/lib/scheduling/result-ops";
import type { ResultLedger } from "@/lib/scheduling/result-domain";
import { checkEvidenceFile, emptyEvidenceLedger, registerEvidenceOp } from "@/lib/scheduling/evidence-ops";
import type { EvidenceLedger } from "@/lib/scheduling/evidence-domain";
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
} from "@/lib/scheduling/reporting-service";
import { resolveReviewOp, correctResultOp } from "@/lib/scheduling/result-ops";
import {
  initialRegistration,
  normalizeRegistrationState,
  type RegistrationState,
} from "@/lib/scheduling/registration-data";
import { buildSquadsByTeamId } from "@/lib/referee/identity-match";

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
    eventEndsAt: schedule.config.stageEnd,
    referee,
    result,
    evidence,
  };
}

class ReportingDomainError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "ReportingDomainError";
  }
}

/**
 * 在同一版本快照上重新执行领域操作，并原子写入实际发生变化的文档。
 * referee-ledger 即使只读也参与版本校验，撤销分配与报分并发时不会穿透鉴权。
 */
async function updateReportingState<T>(
  eventId: string,
  operation: (state: ReportingState) => ReportingOpResult<T>,
): Promise<{ ok: true; value?: T } | { ok: false; error: string; code?: string }> {
  let committedValue: T | undefined;

  try {
    await updateEventDataBatch<ReportingDocuments>(eventId, REPORTING_DOCUMENTS, (documents) => {
      const schedule = normalizeScheduleState(documents.schedule);
      const current: ReportingState = {
        matches: schedule.matches,
        scheduleVersion: schedule.version,
        eventEndsAt: schedule.config.stageEnd,
        referee: documents.referee,
        result: documents.result,
        evidence: documents.evidence,
      };
      const outcome = operation(current);
      if (!outcome.ok) throw new ReportingDomainError(outcome.error, outcome.code);

      committedValue = outcome.value;
      const patch: Partial<ReportingDocuments> = {};
      if (outcome.state.matches !== current.matches) {
        patch.schedule = { ...schedule, matches: outcome.state.matches };
      }
      if (outcome.state.result !== current.result) patch.result = outcome.state.result;
      if (outcome.state.evidence !== current.evidence) patch.evidence = outcome.state.evidence;
      if (outcome.state.referee !== current.referee) patch.referee = outcome.state.referee;
      return patch;
    });
  } catch (error) {
    if (error instanceof ReportingDomainError) {
      return { ok: false, error: error.message, code: error.code };
    }
    throw error;
  }

  return { ok: true, value: committedValue };
}

async function loadScheduleAndReferees(eventId: string): Promise<{ schedule: ScheduleState; referee: RefereeLedger }> {
  const [scheduleRaw, referee] = await Promise.all([
    readEventData<ScheduleState>(eventId, "schedule", emptySchedule()),
    readEventData<RefereeLedger>(eventId, DOC_REFEREE, emptyRefereeLedger()),
  ]);
  return { schedule: normalizeScheduleState(scheduleRaw), referee };
}

async function saveEvidenceWithConcurrencyCheck(
  eventId: string,
  planned: EvidenceLedger["evidence"][number],
  eventEndsAt: string,
): Promise<EvidenceLedger["evidence"][number]> {
  const committed = await updateEventData<EvidenceLedger>(eventId, DOC_EVIDENCE, emptyEvidenceLedger(), (current) => {
    const next = registerEvidenceOp(
      {
        eventId: planned.eventId,
        matchId: planned.matchId,
        mimeType: planned.mimeType,
        sizeBytes: planned.sizeBytes,
        sha256: planned.sha256,
        uploadedByRefereeId: planned.uploadedByRefereeId,
        eventEndsAt,
        evidenceId: planned.id,
      },
      current,
    );
    if (!next.ok) {
      throw Object.assign(new Error(next.error), { code: next.code });
    }
    return next.state;
  });

  const record = committed.evidence.find((item) => item.id === planned.id)
    ?? committed.evidence.find((item) => item.matchId === planned.matchId && item.sha256 === planned.sha256);
  if (!record) throw new Error("凭证台账写入失败");
  return record;
}

// =====================
// 演示 seed（仅本地 file 后端 + DEMO_EVENT_ID，幂等）
// =====================

/** 固定演示凭证（可复现，本地开发用；长度须 ≥20 满足 checkCredential） */
const DEMO_CREDENTIAL = "referee-demo-credential-2026-09";

function demoMatch(id: string, teamAId: string, teamAName: string, teamBId: string, teamBName: string, startTime: string, endTime = ""): ScheduleMatch {
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
    // 补上结束时间：真实排期都由 computeEndTime 算出来，留空会让
    // 「与我已认领的场次是否时间重叠」无从判断（零长度区间永不重叠）。
    endTime,
    status: "已排期",
    frozen: false,
  };
  return match;
}

/**
 * 建演示环境：一场演示赛事 + 一名裁判（凭证固定）+ 三场比赛。
 * 幂等：已有裁判台账则直接复用，不重复建。
 *
 * 三场的分工（2026-09-15 调整）：
 *   M-R1 已指派给演示裁判 —— 用来验证「我的比赛」与「被指派」的展示
 *   M-R2 无人认领       —— 用来验证「裁判自助认领」
 *   M-R3 与 M-R1 时间重叠 —— 用来验证认领时的冲突提示
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

  // 建三场 BO3（写入 schedule 文档，仅演示事件）
  // M-R1 已分配给演示裁判；M-R2 未被认领，用来演示「裁判自助认领」；
  // M-R3 刻意与 M-R1 时间重叠，用来演示认领时的冲突提示。
  const matches: ScheduleMatch[] = [
    demoMatch("M-R1", "team-a", "星辰电竞", "team-b", "暗影战队", "2026-10-06T12:00:00", "2026-10-06T13:30:00"),
    demoMatch("M-R2", "team-c", "烈焰先锋", "team-d", "寒冰之刃", "2026-10-06T14:00:00", "2026-10-06T15:30:00"),
    demoMatch("M-R3", "team-e", "雷霆战队", "team-f", "流星战队", "2026-10-06T13:00:00", "2026-10-06T14:30:00"),
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
  error?: string;
}

export async function refereeLogin(eventId: string, credential: string): Promise<RefereeLoginResult> {
  if (eventId === DEMO_EVENT_ID) await seedDemoReporting();
  const state = await loadReportingState(eventId);
  const login = loginRefereeOp(credential, eventId, state);
  if (!login.ok) return { ok: false, error: login.code ?? login.error };
  return { ok: true };
}

export async function refereeMyMatches(eventId: string, credential: string) {
  if (eventId === DEMO_EVENT_ID) await seedDemoReporting();
  const state = await loadReportingState(eventId);
  const login = loginRefereeOp(credential, eventId, state);
  if (!login.ok) return { ok: false, error: login.code ?? login.error };

  // 报名名单用于把截图里的行底色对上队伍——截图只有玩家昵称、没有队名。
  // 读不到就退化为 null：此时裁判仍可手工报分，只是无法自动定向哪组是哪队。
  const registration = await readEventData<RegistrationState>(eventId, "registration", initialRegistration());
  const squadsByTeamId = buildSquadsByTeamId(normalizeRegistrationState(registration).players);

  return {
    ok: true,
    matches: projectMyMatches(state, login.value!.refereeId, squadsByTeamId),
    scheduleVersion: state.scheduleVersion,
  };
}

/**
 * 取某场比赛的报分上下文（鉴权 + 赛果识别所需依据）。
 *
 * 先鉴权再返回：未分配的比赛直接拒绝，不泄露队伍或名单信息。
 * 分配关系的判定复用 projectMyMatches——那里已有一份经过测试的权限逻辑，
 * 不另写一份「这个裁判能不能报这场」，避免两处规则漂移。
 */
export async function refereeMatchContext(
  eventId: string,
  credential: string,
  matchId: string,
): Promise<
  | { ok: true; value: { match: MyMatchSummary } }
  | { ok: false; error: string; code?: string }
> {
  if (eventId === DEMO_EVENT_ID) await seedDemoReporting();
  const state = await loadReportingState(eventId);
  const login = loginRefereeOp(credential, eventId, state);
  if (!login.ok) return { ok: false, error: "裁判凭证无效", code: login.code ?? "INVALID_CREDENTIAL" };

  const registration = await readEventData<RegistrationState>(eventId, "registration", initialRegistration());
  const squadsByTeamId = buildSquadsByTeamId(normalizeRegistrationState(registration).players);
  const match = projectMyMatches(state, login.value!.refereeId, squadsByTeamId)
    .find((item) => item.matchId === matchId);
  if (!match) return { ok: false, error: "这场比赛没有分配给你", code: "NOT_ASSIGNED" };
  return { ok: true, value: { match } };
}

/**
 * 裁判端可认领的比赛列表。
 *
 * 对应实际流程：队伍先在规定时段内完成约赛 → 得到一份有确定时间的比赛列表 →
 * 裁判自己看哪些能执裁 → 直接认领。所以这里只列**已排期、未完成、尚无人认领**的场次。
 */
export async function refereeOpenMatches(
  eventId: string,
  credential: string,
): Promise<
  | { ok: true; matches: OpenMatchSummary[]; scheduleVersion: number }
  | { ok: false; error: string }
> {
  if (eventId === DEMO_EVENT_ID) await seedDemoReporting();
  const state = await loadReportingState(eventId);
  const auth = authenticateReferee(credential, eventId, state.referee);
  if (!auth.ok) return { ok: false, error: "裁判凭证无效" };
  return {
    ok: true,
    matches: projectOpenMatches(state, auth.refereeId),
    scheduleVersion: state.scheduleVersion,
  };
}

/** 认领与释放的共用逻辑：鉴权 → 锁内改裁判台账 → 返回结果 */
async function mutateLedgerWithCredential(
  eventId: string,
  credential: string,
  mutate: (
    refereeId: string,
    current: RefereeLedger,
  ) => { ok: true; state: RefereeLedger; reason?: string } | { ok: false; error: string; code?: string },
): Promise<{ ok: true; reason?: string } | { ok: false; error: string; code?: string }> {
  if (eventId === DEMO_EVENT_ID) await seedDemoReporting();

  const state = await loadReportingState(eventId);
  const auth = authenticateReferee(credential, eventId, state.referee);
  if (!auth.ok) return { ok: false, error: "裁判凭证无效", code: auth.reason };

  try {
    let note: string | undefined;
    await updateEventData<RefereeLedger>(eventId, DOC_REFEREE, emptyRefereeLedger(), (current) => {
      const result = mutate(auth.refereeId, current);
      if (!result.ok) {
        // 抛出去让事务回滚，同时把错误码带到外层
        throw Object.assign(new Error(result.error), { code: result.code });
      }
      note = result.reason;
      return result.state;
    });
    return { ok: true, reason: note };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "裁判台账写入失败",
      code: typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : undefined,
    };
  }
}

/**
 * 裁判认领一场比赛。
 *
 * ★ 并发安全的关键：**「是否已被他人认领」的判断在 updateEventData 的 updater 内完成**
 * ——生产由 PostgreSQL 事务、本地由赛事级写锁串行化。
 * 如果放在锁外先读再写，两名裁判同时点同一场会双双通过检查
 * （各自读到的台账都还是空的），结果是这场有两个裁判都以为自己负责。
 *
 * 比赛本身的合法性（存在、已排期、未完成）在锁外判断。理由：
 * 这些是慢变数据，不会在毫秒级内变化；而「谁先抢到」才是真正的竞争点。
 */
/**
 * 裁判认领比赛。
 *
 * ★ 顺序：**先鉴权，再查比赛**。
 *
 * 反例（原实现）：先 `find` 比赛、发现不存在就回「比赛不存在」，
 * 把鉴权留到 `mutateLedgerWithCredential` 里面。后果是**未登录者也能探测比赛**：
 * 靠不同的报错文案（「比赛不存在」/「该场已结束」/「该场还没有约赛时间」）
 * 就能枚举出哪些比赛存在、什么状态。比赛 ID 是 `M01`/`M02`…连续可猜，抽签后可被逐个问出来。
 *
 * 正确做法与 `submitRefereeResultOp` / `uploadRefereeEvidenceOp` 保持一致：
 * 未鉴权时**只回「凭证无效」**，不透露任何资源信息。
 */
export async function refereeClaimMatch(
  eventId: string,
  credential: string,
  matchId: string,
): Promise<{ ok: true; reason?: string } | { ok: false; error: string; code?: string }> {
  const state = await loadReportingState(eventId);

  // 1. 越权 / 未分配 / 凭证失效 → 统一拒绝，且不泄露比赛是否存在
  const auth = authenticateReferee(credential, eventId, state.referee);
  if (!auth.ok) return { ok: false, error: "裁判凭证无效", code: auth.reason };

  // 2. 鉴权通过后才查比赛（此处报错只回给已确认身份的裁判）
  const match = state.matches.find((m) => m.id === matchId);
  if (!match) return { ok: false, error: "比赛不存在", code: "MATCH_NOT_FOUND" };
  if (match.status === "已完成") return { ok: false, error: "该场已结束，不需要裁判", code: "MATCH_COMPLETED" };
  if (!match.startTime) {
    return { ok: false, error: "该场还没有约赛时间，等双方确定时间后再认领", code: "NOT_SCHEDULED" };
  }

  // 3. 复用第 1 步已确认的 refereeId，不再重复鉴权
  return mutateLedgerWithCredential(eventId, credential, (refereeId, current) =>
    claimMatchOp({ eventId, matchId, refereeId }, current),
  );
}

/**
 * 裁判释放自己认领的比赛（被指派的场次不能自己释放，须负责人撤销）。
 *
 * 未在此处加前置鉴权：资源查询（「你有没有认领这场」）发生在
 * `releaseClaimOp` 内部，而该 op 是在 `mutateLedgerWithCredential` 的
 * **已鉴权回调**里执行的——所以顺序本身就是对的，不会泄露。
 */
export async function refereeReleaseMatch(
  eventId: string,
  credential: string,
  matchId: string,
): Promise<{ ok: true; reason?: string } | { ok: false; error: string; code?: string }> {
  return mutateLedgerWithCredential(eventId, credential, (refereeId, current) =>
    releaseClaimOp({ eventId, matchId, refereeId }, current),
  );
}

export async function refereeSubmit(
  eventId: string,
  credential: string,
  input: { matchId: string; basedOnScheduleVersion: number; games: Parameters<typeof submitRefereeResultOp>[0]["games"]; evidenceIds?: string[] },
) {
  return updateReportingState(eventId, (state) =>
    submitRefereeResultOp(
      { credential, eventId, matchId: input.matchId, basedOnScheduleVersion: input.basedOnScheduleVersion, games: input.games, evidenceIds: input.evidenceIds },
      state,
    ),
  );
}

/**
 * 裁判上传凭证草稿（RPT-07a）。
 * 事件结束时间取赛程 config.stageEnd（用于计算 expiresAt = 当届结束 + 申诉保留期）。
 * 校验真实文件头后先写私有对象，再以并发安全更新提交台账；台账失败会回滚对象。
 */
export async function refereeUploadEvidence(
  eventId: string,
  credential: string,
  input: { matchId: string; mimeType: string; sizeBytes: number; sha256: string; bytes: Uint8Array },
): Promise<{ ok: true; value: { evidenceId: string; objectPath: string; expiresAt: string } } | { ok: false; error: string; code?: string }> {
  const fileCheck = checkEvidenceFile({
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    sha256: input.sha256,
    bytes: input.bytes,
  });
  if (!fileCheck.ok) return { ok: false, error: fileCheck.error, code: fileCheck.code };

  const state = await loadReportingState(eventId);
  const result = uploadRefereeEvidenceOp(
    {
      credential,
      eventId,
      matchId: input.matchId,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
    },
    state,
  );
  if (!result.ok) return { ok: false, error: result.error, code: result.code };

  const planned = result.state!.evidence.evidence.find((item) => item.id === result.value!.evidenceId);
  if (!planned) return { ok: false, error: "凭证注册失败", code: "EVIDENCE_NOT_FOUND" };

  // 相同比赛、相同散列已经存在时直接复用，不重复写对象。
  if (state.evidence.evidence.some((item) => item.id === planned.id)) {
    return { ok: true, value: result.value! };
  }

  await storeEvidenceObject({
    eventId,
    objectName: planned.objectPath,
    mimeType: planned.mimeType,
    bytes: input.bytes,
  });
  try {
    const committed = await saveEvidenceWithConcurrencyCheck(eventId, planned, state.eventEndsAt);
    if (committed.id !== planned.id) {
      await deleteEvidenceObject({ eventId, objectName: planned.objectPath });
    }
    return {
      ok: true,
      value: { evidenceId: committed.id, objectPath: committed.objectPath, expiresAt: committed.expiresAt },
    };
  } catch (error) {
    await deleteEvidenceObject({ eventId, objectName: planned.objectPath }).catch(() => undefined);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "凭证台账写入失败",
      code: typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined,
    };
  }
}

export type { AdminReviewItem, AcceptedResultItem, ReviewRiskTag } from "@/lib/scheduling/reporting-service";

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
