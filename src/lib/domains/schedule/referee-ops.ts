// =====================
// RPT-02 裁判身份、凭证与比赛分配纯函数
// 无 UI、无数据库、无模型。凭证用加密安全随机数 + 服务端只存哈希。
// 权限推导不依赖任何客户端传入的 refereeId。
// =====================

import { createHash, randomBytes } from "node:crypto";
import type {
  AssignMatchInput,
  ClaimMatchInput,
  CreateRefereeInput,
  CredentialCheck,
  RefereeAssignment,
  RefereeAuditEntry,
  RefereeAuthz,
  RefereeIdentity,
  RefereeLedger,
  ReleaseClaimInput,
  ResetCredentialInput,
  RevokeAssignmentInput,
} from "./referee-domain.ts";

/** 操作结果：成功返回新 ledger + 值，失败返回错误码 */
export type RefereeOpResult<T = undefined> =
  | { ok: true; state: RefereeLedger; value?: T; reason?: string }
  | { ok: false; error: string; code?: string; state?: undefined; value?: undefined };

export function emptyRefereeLedger(): RefereeLedger {
  return { referees: [], assignments: [], audit: [] };
}

// ---------------------------------------------------------------
// 凭证生成与哈希
// ---------------------------------------------------------------

/** 生成凭证：加密安全随机数（24 字节 → base64url），返回明文 + 哈希。明文只展示一次。 */
export function issueCredential(): { credential: string; credentialHash: string } {
  const credential = randomBytes(24).toString("base64url");
  return { credential, credentialHash: hashCredential(credential) };
}

export function hashCredential(credential: string): string {
  return createHash("sha256").update(credential).digest("hex");
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

function audit(action: RefereeAuditEntry["action"], actorId: string, eventId: string, extra: Partial<RefereeAuditEntry> = {}): RefereeAuditEntry {
  return { id: newId("AUD"), eventId, action, actorId, createdAt: new Date().toISOString(), ...extra };
}

function now(): string {
  return new Date().toISOString();
}

function validIsoTime(value: string): boolean {
  return value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

// ---------------------------------------------------------------
// 管理员操作
// ---------------------------------------------------------------

/** 创建裁判 + 一次性展示凭证明文 */
export function createRefereeOp(input: CreateRefereeInput, ledger: RefereeLedger): RefereeOpResult<{ refereeId: string; credential: string }> {
  const displayName = input.displayName.trim();
  if (!displayName) return { ok: false, error: "裁判姓名不能为空", code: "DISPLAY_NAME_REQUIRED" };
  if (!validIsoTime(input.credentialExpiresAt)) {
    return { ok: false, error: "凭证有效期格式不合法", code: "INVALID_EXPIRY" };
  }
  const { credential, credentialHash } = issueCredential();
  const referee: RefereeIdentity = {
    id: newId("REF"),
    eventId: input.eventId,
    displayName,
    status: "active",
    credentialHash,
    credentialExpiresAt: input.credentialExpiresAt,
    createdAt: now(),
  };
  return {
    ok: true,
    state: {
      ...ledger,
      referees: [...ledger.referees, referee],
      audit: [...ledger.audit, audit("create-referee", input.actorId, input.eventId, { refereeId: referee.id })],
    },
    value: { refereeId: referee.id, credential },
  };
}

/** 停用裁判：立即拒绝后续写操作 */
export function disableRefereeOp(refereeId: string, actorId: string, ledger: RefereeLedger): RefereeOpResult {
  const referee = ledger.referees.find((r) => r.id === refereeId);
  if (!referee) return { ok: false, error: "裁判不存在", code: "REFEREE_NOT_FOUND" };
  if (referee.status === "disabled") return { ok: true, state: ledger, reason: "已停用" };
  return {
    ok: true,
    state: {
      ...ledger,
      referees: ledger.referees.map((r) => (r.id === refereeId ? { ...r, status: "disabled" as const, disabledAt: now() } : r)),
      audit: [...ledger.audit, audit("disable-referee", actorId, referee.eventId, { refereeId })],
    },
  };
}

/** 重置凭证：旧凭证立即失效，返回新明文（一次性展示） */
export function resetCredentialOp(input: ResetCredentialInput, ledger: RefereeLedger): RefereeOpResult<{ credential: string }> {
  const referee = ledger.referees.find((r) => r.id === input.refereeId);
  if (!referee) return { ok: false, error: "裁判不存在", code: "REFEREE_NOT_FOUND" };
  if (!validIsoTime(input.newCredentialExpiresAt)) {
    return { ok: false, error: "凭证有效期格式不合法", code: "INVALID_EXPIRY" };
  }
  const { credential, credentialHash } = issueCredential();
  return {
    ok: true,
    state: {
      ...ledger,
      referees: ledger.referees.map((r) =>
        r.id === input.refereeId
          ? { ...r, credentialHash, credentialExpiresAt: input.newCredentialExpiresAt }
          : r,
      ),
      audit: [...ledger.audit, audit("reset-credential", input.actorId, referee.eventId, { refereeId: referee.id })],
    },
    value: { credential },
  };
}

// ---------------------------------------------------------------
// 比赛分配与撤销
// ---------------------------------------------------------------

export function assignMatchOp(input: AssignMatchInput, ledger: RefereeLedger): RefereeOpResult<{ assignmentId: string }> {
  const referee = ledger.referees.find((r) => r.id === input.refereeId);
  if (!referee) return { ok: false, error: "裁判不存在", code: "REFEREE_NOT_FOUND" };
  if (referee.status === "disabled") return { ok: false, error: "裁判已停用", code: "REFEREE_DISABLED" };
  if (referee.eventId !== input.eventId) {
    return { ok: false, error: "裁判与比赛不属于同一赛事", code: "WRONG_EVENT" };
  }

  // 同一裁判、同一比赛不重复分配
  const existing = ledger.assignments.find(
    (a) => a.refereeId === input.refereeId && a.matchId === input.matchId && a.status === "assigned",
  );
  if (existing) return { ok: true, state: ledger, value: { assignmentId: existing.id }, reason: "已分配" };

  // ★ 该场已被别人认领/指派时拒绝，不静默覆盖。
  // 原实现只防「同一裁判重复分配」，靠负责人人工避免撞车；
  // 但裁判自助认领上线后就可能出现「裁判刚认领、负责人又指派给别人」，
  // 若允许覆盖会出现两个裁判都以为自己负责这场。
  const takenByOther = ledger.assignments.find(
    (a) => a.matchId === input.matchId && a.status === "assigned" && a.refereeId !== input.refereeId,
  );
  if (takenByOther) {
    const owner = ledger.referees.find((r) => r.id === takenByOther.refereeId);
    return {
      ok: false,
      error: takenByOther.selfClaimed
        ? `该场已由《${owner?.displayName ?? "其他裁判"}》认领，如需改派请先撤销其认领`
        : `该场已指派给《${owner?.displayName ?? "其他裁判"}》，如需改派请先撤销原分配`,
      code: "MATCH_TAKEN",
    };
  }

  const assignment: RefereeAssignment = {
    id: newId("ASG"),
    eventId: input.eventId,
    matchId: input.matchId,
    refereeId: input.refereeId,
    status: "assigned",
    assignedBy: input.actorId,
    assignedAt: now(),
  };
  return {
    ok: true,
    state: {
      ...ledger,
      assignments: [...ledger.assignments, assignment],
      audit: [...ledger.audit, audit("assign-match", input.actorId, input.eventId, { refereeId: input.refereeId, matchId: input.matchId })],
    },
    value: { assignmentId: assignment.id },
  };
}

/**
 * 裁判自助认领一场比赛。
 *
 * ⚠️ 并发注意：本函数只做纯判断。**必须在数据层的锁内调用**，
 * 否则两个裁判同时认领同一场时都会通过检查（先读后写的经典竞态）。
 * 「该场是否已被他人认领」的判定就落在这里，调用方负责把它放进事务。
 */
export function claimMatchOp(input: ClaimMatchInput, ledger: RefereeLedger): RefereeOpResult<{ assignmentId: string }> {
  const referee = ledger.referees.find((r) => r.id === input.refereeId);
  if (!referee) return { ok: false, error: "裁判不存在", code: "REFEREE_NOT_FOUND" };
  if (referee.status === "disabled") return { ok: false, error: "裁判账号已停用", code: "REFEREE_DISABLED" };
  if (referee.eventId !== input.eventId) {
    return { ok: false, error: "裁判与比赛不属于同一赛事", code: "WRONG_EVENT" };
  }

  // 自己已认领 → 幂等成功（重复点击不应报错）
  const mine = ledger.assignments.find(
    (a) => a.refereeId === input.refereeId && a.matchId === input.matchId && a.status === "assigned",
  );
  if (mine) return { ok: true, state: ledger, value: { assignmentId: mine.id }, reason: "你已认领该场" };

  // ★ 已被他人占走 —— 这是自助认领最容易发生的情况（两人同时点）
  const taken = ledger.assignments.find(
    (a) => a.matchId === input.matchId && a.status === "assigned" && a.refereeId !== input.refereeId,
  );
  if (taken) {
    const owner = ledger.referees.find((r) => r.id === taken.refereeId);
    return {
      ok: false,
      error: `这场已被《${owner?.displayName ?? "其他裁判"}》认领`,
      code: "MATCH_TAKEN",
    };
  }

  const at = now();
  const assignment: RefereeAssignment = {
    id: newId("ASG"),
    eventId: input.eventId,
    matchId: input.matchId,
    refereeId: input.refereeId,
    status: "assigned",
    assignedBy: input.refereeId,
    assignedAt: at,
    selfClaimed: true,
    claimedAt: at,
  };
  return {
    ok: true,
    state: {
      ...ledger,
      assignments: [...ledger.assignments, assignment],
      audit: [...ledger.audit, audit("claim-match", input.refereeId, input.eventId, { refereeId: input.refereeId, matchId: input.matchId })],
    },
    value: { assignmentId: assignment.id },
  };
}

/**
 * 裁判释放自己认领的比赛。
 *
 * 只能释放 **selfClaimed** 的分配。负责人指派的场次不能由裁判自己丢掉——
 * 否则「指派」这个兜底手段就失效了（被指派的人可以直接卸责）。
 */
export function releaseClaimOp(input: ReleaseClaimInput, ledger: RefereeLedger): RefereeOpResult {
  const mine = ledger.assignments.find(
    (a) => a.refereeId === input.refereeId && a.matchId === input.matchId && a.status === "assigned",
  );
  if (!mine) return { ok: false, error: "你没有认领这场比赛", code: "NOT_CLAIMED" };
  if (!mine.selfClaimed) {
    return { ok: false, error: "这场是负责人指派的，如需退出请联系负责人撤销", code: "NOT_SELF_CLAIMED" };
  }
  return {
    ok: true,
    state: {
      ...ledger,
      assignments: ledger.assignments.map((a) =>
        a.id === mine.id ? { ...a, status: "revoked" as const, revokedAt: now() } : a,
      ),
      audit: [...ledger.audit, audit("release-claim", input.refereeId, input.eventId, { refereeId: input.refereeId, matchId: input.matchId })],
    },
  };
}

export function revokeAssignmentOp(input: RevokeAssignmentInput, ledger: RefereeLedger): RefereeOpResult {
  const assignment = ledger.assignments.find((a) => a.id === input.assignmentId);
  if (!assignment) return { ok: false, error: "分配关系不存在", code: "ASSIGNMENT_NOT_FOUND" };
  if (assignment.status === "revoked") return { ok: true, state: ledger, reason: "已撤销" };
  return {
    ok: true,
    state: {
      ...ledger,
      assignments: ledger.assignments.map((a) =>
        a.id === input.assignmentId ? { ...a, status: "revoked" as const, revokedAt: now() } : a,
      ),
      audit: [...ledger.audit, audit("revoke-assignment", input.actorId, assignment.eventId, { refereeId: assignment.refereeId, matchId: assignment.matchId })],
    },
  };
}

// ---------------------------------------------------------------
// 凭证校验与权限推导（不依赖客户端 refereeId）
// ---------------------------------------------------------------

/**
 * 凭证 → 身份。统一返回 INVALID_CREDENTIAL（不区分不存在/凭证错），防枚举。
 */
export function checkCredential(credential: string, ledger: RefereeLedger): CredentialCheck {
  if (!credential || credential.length < 20) return { ok: false, reason: "INVALID_CREDENTIAL" };
  const hash = hashCredential(credential);
  const referee = ledger.referees.find((r) => r.credentialHash === hash);
  if (!referee) return { ok: false, reason: "INVALID_CREDENTIAL" };
  return { ok: true, referee };
}

function authenticateActiveReferee(
  credential: string,
  eventId: string,
  ledger: RefereeLedger,
  nowTime: string,
): RefereeAuthz {
  const check = checkCredential(credential, ledger);
  if (!check.ok) return { ok: false, reason: "INVALID_CREDENTIAL" };

  const referee = check.referee;
  if (referee.eventId !== eventId) return { ok: false, reason: "WRONG_EVENT" };
  const expiresAt = Date.parse(referee.credentialExpiresAt);
  const checkedAt = Date.parse(nowTime);
  if (!Number.isFinite(expiresAt) || !Number.isFinite(checkedAt) || expiresAt <= checkedAt) {
    return { ok: false, reason: "EXPIRED" };
  }
  if (referee.status === "disabled") return { ok: false, reason: "DISABLED" };
  return { ok: true, refereeId: referee.id };
}

/**
 * 裁判能否操作某场比赛？从「凭证 → 身份 → 分配关系」推导，不接受客户端 refereeId。
 * 校验顺序：凭证 → 事件范围 → 过期 → 停用 → 分配。
 */
export function authorizeReferee(
  credential: string,
  eventId: string,
  matchId: string,
  ledger: RefereeLedger,
  nowTime: string = now(),
): RefereeAuthz {
  const authenticated = authenticateActiveReferee(credential, eventId, ledger, nowTime);
  if (!authenticated.ok) return authenticated;

  const assigned = ledger.assignments.some(
    (a) => a.eventId === eventId
      && a.refereeId === authenticated.refereeId
      && a.matchId === matchId
      && a.status === "assigned",
  );
  if (!assigned) return { ok: false, reason: "NOT_ASSIGNED" };
  return authenticated;
}

/** 凭证 → 身份（用于「我的比赛」列表，只要求凭证有效，不检查单场分配） */
export function authenticateReferee(credential: string, eventId: string, ledger: RefereeLedger, nowTime: string = now()): RefereeAuthz {
  return authenticateActiveReferee(credential, eventId, ledger, nowTime);
}
