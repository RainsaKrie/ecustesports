// =====================
// RPT-02 裁判身份与凭证领域类型（对应 ADR v1.0 第 3 节 + 工作包 02 §4）
// 独立于管理员密码与选手参赛码；服务端只存凭证哈希。
// =====================

/** 裁判身份 */
export interface RefereeIdentity {
  id: string;
  eventId: string; // 绑定赛事，凭证不得跨赛事访问
  displayName: string;
  status: "active" | "disabled";
  /** 服务端只保存凭证哈希，绝不保存明文 */
  credentialHash: string;
  credentialExpiresAt: string;
  createdAt: string;
  disabledAt?: string;
}

/**
 * 比赛分配（权威定义；result-ops 中的 MatchAssignment 是其查询级简化视图）
 *
 * 两种来源需要区分（2026-09-15 补）：
 *   · 负责人指派：`assignedBy` 是管理员的 actorId，`selfClaimed` 为 undefined
 *   · 裁判自助认领：`selfClaimed === true`，`assignedBy` 是裁判自己的 id
 * 区分它们的实际用途：**裁判只能释放自己认领的比赛**，
 * 负责人指派的场次要走负责人撤销——否则裁判可以把指派给他的活单方面丢掉。
 */
export interface RefereeAssignment {
  id: string;
  eventId: string;
  matchId: string;
  refereeId: string;
  status: "assigned" | "revoked" | "completed";
  assignedBy: string;
  assignedAt: string;
  revokedAt?: string;
  /** 是否由裁判本人认领（而非负责人指派） */
  selfClaimed?: boolean;
  /** 认领时间；仅 selfClaimed 时有意义 */
  claimedAt?: string;
}

/** 裁判相关的操作审计（供管理员追溯分配与重置） */
export interface RefereeAuditEntry {
  id: string;
  eventId: string;
  action:
    | "create-referee"
    | "disable-referee"
    | "reset-credential"
    | "assign-match"
    | "revoke-assignment"
    | "claim-match"
    | "release-claim";
  actorId: string; // 操作者：管理员为管理员 id，自助认领为裁判 id
  refereeId?: string;
  matchId?: string;
  createdAt: string;
}

/** 裁判台账：身份 + 分配 + 审计，独立于赛果台账 */
export interface RefereeLedger {
  referees: RefereeIdentity[];
  assignments: RefereeAssignment[];
  audit: RefereeAuditEntry[];
}

/** 创建裁判输入 */
export interface CreateRefereeInput {
  eventId: string;
  displayName: string;
  actorId: string;
  /** 凭证有效期（ISO 时间字符串）；缺省由调用方给定赛事周期 */
  credentialExpiresAt: string;
}

/** 重置凭证输入 */
export interface ResetCredentialInput {
  refereeId: string;
  actorId: string;
  newCredentialExpiresAt: string;
}

/** 分配比赛输入 */
export interface AssignMatchInput {
  eventId: string;
  matchId: string;
  refereeId: string;
  actorId: string;
}

/** 撤销分配输入 */
export interface RevokeAssignmentInput {
  assignmentId: string;
  actorId: string;
}

/** 裁判自助认领比赛输入 */
export interface ClaimMatchInput {
  eventId: string;
  matchId: string;
  refereeId: string;
}

/** 裁判释放自己认领的比赛输入 */
export interface ReleaseClaimInput {
  eventId: string;
  matchId: string;
  refereeId: string;
}

/** 凭证校验统一结果：不区分「不存在」与「凭证错误」（防枚举） */
export type CredentialCheck =
  | { ok: true; referee: RefereeIdentity }
  | { ok: false; reason: "INVALID_CREDENTIAL" } // 统一失败，不泄露是哪个原因

/** 权限推导结果：凭证 → 身份 → 是否能操作某场比赛 */
export type RefereeAuthz =
  | { ok: true; refereeId: string }
  | { ok: false; reason: "INVALID_CREDENTIAL" | "DISABLED" | "EXPIRED" | "NOT_ASSIGNED" | "WRONG_EVENT" };