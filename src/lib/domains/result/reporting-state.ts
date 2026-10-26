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
export const DOC_REFEREE = "referee-ledger";
export const DOC_RESULT = "result-ledger";
export const DOC_EVIDENCE = "evidence-ledger";

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
export async function updateReportingState<T>(
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
        /**
         * 报分 / 改分落地时，把这场上还挂着的改期申请一并作废。
         *
         * 申请与比赛是两份独立数据，报分只改 matches，申请不会自己消失。
         * 留着它的后果很实际：负责人点「批准并更新赛程」会把这场**已完成的比赛**
         * 改回「已排期」（approveRescheduleOp 里的 updatedMatch），而 `...match` 又带着
         * 已写好的赛果 —— 比赛显示未开始、赛果还挂着，还会重新出现在 BP 列表里。
         *
         * 收口放在这里而不是 result-ops：ReportingState 里没有 requests，
         * 而这里恰好同时持有 schedule 原文档与操作结果，是本链路唯一能同时改两者的地方。
         */
        const beforeStatus = new Map(current.matches.map((m) => [m.id, m.status]));
        const affected = new Set(
          outcome.state.matches
            .filter((m) => m.status === "已完成" && beforeStatus.get(m.id) !== "已完成")
            .map((m) => m.id),
        );
        const requests = affected.size > 0
          ? [...affected].reduce(
              (acc, matchId) => expirePendingRequests(acc, matchId),
              schedule.requests ?? [],
            )
          : schedule.requests;
        const requestsChanged = affected.size > 0 && requests !== schedule.requests;
        /**
         * ★ 递增 `version`（赛程写入契约，2026-10-12 统一）。
         *
         * 这里一度是刻意的例外：`submitResultOp` 用「提交版本必须等于当前版本」严格比对，
         * 递增会把裁判页面上还没提交的人全部拒掉。现在那条比对已换成**逐场前置条件**
         * （见 result-ops.ts 的 `submitResultOp`），所以本路径不再需要例外 ——
         * 而例外正是那次「赛果被管理端旧快照静默覆盖」的成因。
         */
        patch.schedule = stampScheduleVersion(schedule, {
          ...schedule,
          matches: outcome.state.matches,
          ...(requestsChanged ? { requests } : {}),
        });
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

export async function loadScheduleAndReferees(eventId: string): Promise<{ schedule: ScheduleState; referee: RefereeLedger }> {
  const [scheduleRaw, referee] = await Promise.all([
    readEventData<ScheduleState>(eventId, "schedule", emptySchedule()),
    readEventData<RefereeLedger>(eventId, DOC_REFEREE, emptyRefereeLedger()),
  ]);
  return { schedule: normalizeScheduleState(scheduleRaw), referee };
}

export async function saveEvidenceWithConcurrencyCheck(
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
