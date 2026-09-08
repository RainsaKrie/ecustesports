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

/** 比赛分配（权威定义；result-ops 中的 MatchAssignment 是其查询级简化视图） */
export interface RefereeAssignment {
  id: string;
  eventId: string;
  matchId: string;
  refereeId: string;
  status: "assigned" | "revoked" | "completed";
  assignedBy: string;
  assignedAt: string;
  revokedAt?: string;
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
    | "revoke-assignment";
  actorId: string; // 操作的管理员
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

/** 凭证校验统一结果：不区分「不存在」与「凭证错误」（防枚举） */
export type CredentialCheck =
  | { ok: true; referee: RefereeIdentity }
  | { ok: false; reason: "INVALID_CREDENTIAL" } // 统一失败，不泄露是哪个原因

/** 权限推导结果：凭证 → 身份 → 是否能操作某场比赛 */
export type RefereeAuthz =
  | { ok: true; refereeId: string }
  | { ok: false; reason: "INVALID_CREDENTIAL" | "DISABLED" | "EXPIRED" | "NOT_ASSIGNED" | "WRONG_EVENT" };