// =====================
// 裁判端数据访问（2026-10-26 从 reporting-data.ts 拆出）
// 登录 / 我的比赛 / 抢单 / 释放 / 提交赛果 / 上传证据；reporting-data.ts 仍原样转出（门面）。
// =====================

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

import { loadReportingState, seedDemoReporting, updateReportingState, saveEvidenceWithConcurrencyCheck, DEMO_EVENT_ID, DOC_REFEREE, DOC_RESULT, DOC_EVIDENCE } from "./reporting-state.ts";

export interface RefereeLoginResult {
  ok: boolean;
  error?: string;
  code?: string;
}

/**
 * 失败形状与 `refereeMatchContext` 保持一致：`error` 是给人看的兜底文案，
 * `code` 交给路由判状态码（见 `failure-response.ts`）。
 *
 * ★ 原先这里只把**内部码**塞进 `error`（`login.code ?? login.error`），
 *   靠调用方硬编码一句中文兜住 —— 调用方一改成透传，裁判屏幕上就会出现
 *   `INVALID_CREDENTIAL` 这种内部码。
 */
export async function refereeLogin(eventId: string, credential: string): Promise<RefereeLoginResult> {
  if (eventId === DEMO_EVENT_ID) await seedDemoReporting();
  const state = await loadReportingState(eventId);
  const login = loginRefereeOp(credential, eventId, state);
  if (!login.ok) return { ok: false, error: "裁判凭证无效", code: login.code ?? "INVALID_CREDENTIAL" };
  return { ok: true };
}

export async function refereeMyMatches(eventId: string, credential: string) {
  if (eventId === DEMO_EVENT_ID) await seedDemoReporting();
  const state = await loadReportingState(eventId);
  const login = loginRefereeOp(credential, eventId, state);
  if (!login.ok) return { ok: false, error: "裁判凭证无效", code: login.code ?? "INVALID_CREDENTIAL" };

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
  | { ok: false; error: string; code?: string }
> {
  if (eventId === DEMO_EVENT_ID) await seedDemoReporting();
  const state = await loadReportingState(eventId);
  const auth = authenticateReferee(credential, eventId, state.referee);
  // 带上 code，路由才能判「这是未授权（401）还是校验失败（400）」，
  // 不然只能靠硬编码 401 兜住，形状一改就错。
  if (!auth.ok) return { ok: false, error: "裁判凭证无效", code: auth.reason };
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
  input: {
    matchId: string;
    basedOnScheduleVersion: number;
    games: Parameters<typeof submitRefereeResultOp>[0]["games"];
    evidenceIds?: string[];
    /** 裁判端回传的「我看到的两队队名」，用于逐场前置条件校验（见 submitResultOp） */
    expectedTeamAName?: string;
    expectedTeamBName?: string;
  },
) {
  return updateReportingState(eventId, (state) =>
    submitRefereeResultOp(
      {
        credential,
        eventId,
        matchId: input.matchId,
        basedOnScheduleVersion: input.basedOnScheduleVersion,
        games: input.games,
        evidenceIds: input.evidenceIds,
        expectedTeamAName: input.expectedTeamAName,
        expectedTeamBName: input.expectedTeamBName,
      },
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

