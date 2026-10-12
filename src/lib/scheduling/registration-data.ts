// =====================
// 报名与队伍数据模型（报名内置 MVP）
// 对齐 docs/03-需求定义/05-报名与队伍.md
// =====================

/** 无畏契约擅长位置（多选） */
export const POSITIONS = ["一突", "二突", "烟位", "先锋", "哨位"] as const;
export type Position = (typeof POSITIONS)[number];

/** 选手（报名最小单元） */
export interface RegistrationPlayer {
  id: string;
  name: string; // 姓名（必填，仅负责人可见）
  studentId: string; // 学号（必填，仅负责人可见）
  gameId: string; // 游戏 ID（必填，公开显示）
  rank: string; // 段位（必填，用于种子计算）
  qq?: string; // QQ（报名必填；字段保持可选以兼容旧数据）
  phone?: string; // 手机号（报名必填；字段保持可选以兼容旧数据）
  positions?: string[]; // 擅长位置（报名必填，多选，仅负责人可见）
  intro?: string; // 自我介绍（选填）
  submittedAt: string;
  status: "已报名" | "已入队" | "已退赛";
  /** 负责人审核状态；与是否组队分开，避免一个 status 承担两种语义。 */
  reviewStatus?: "待审核" | "已通过" | "需修改" | "已拒绝";
  teamId?: string; // 所属队伍
  role?: "首发" | "替补" | "教练"; // 队内角色
  /** 参赛管理码摘要；原始管理码只在报名成功时返回给本人。 */
  manageTokenHash?: string;
}

/** 队伍（一组选手） */
export interface RegistrationTeam {
  id: string;
  name: string;
  captainId: string; // 队长（选手 id）
  memberIds: string[]; // 成员（含队长）
  status: "报名中" | "已冻结" | "已退赛";
  createdAt: string;
}

export type TeamRequestType = "application" | "invitation";
export type TeamRequestStatus = "pending" | "accepted" | "rejected" | "cancelled";

/** 组队必须经过双方确认：选手申请由队长处理，队长邀请由选手处理。 */
export interface TeamRequest {
  id: string;
  type: TeamRequestType;
  teamId: string;
  playerId: string;
  role: "首发" | "替补" | "教练";
  initiatedByPlayerId: string;
  status: TeamRequestStatus;
  createdAt: string;
  resolvedAt?: string;
}

export interface RegistrationSnapshot {
  players: RegistrationPlayer[];
  teams: RegistrationTeam[];
  teamRequests: TeamRequest[];
  playerRegistrationClosed: boolean;
  teamRegistrationClosed: boolean;
}

export interface RegistrationAuditLog {
  id: string;
  action: string;
  summary: string;
  reason?: string;
  actor: "赛事负责人";
  createdAt: string;
  undoneAt?: string;
  /** 用于安全撤销；仅后台返回，不进入公开接口。 */
  before: RegistrationSnapshot;
  after: RegistrationSnapshot;
}

/** 报名状态 */
export interface RegistrationState {
  players: RegistrationPlayer[];
  teams: RegistrationTeam[];
  teamRequests?: TeamRequest[];
  operationLogs?: RegistrationAuditLog[];
  /** 是否停止接收新的个人报名 */
  playerRegistrationClosed: boolean;
  /** 是否停止建队、入队与名单调整 */
  teamRegistrationClosed: boolean;
}

export function initialRegistration(): RegistrationState {
  return {
    players: [],
    teams: [],
    teamRequests: [],
    operationLogs: [],
    playerRegistrationClosed: false,
    teamRegistrationClosed: false,
  };
}

/**
 * 兼容 3.24 及更早只保存 frozen 的赛事报名数据。
 *
 * `frozen` 字段本身已于 2026-10-12 从 `RegistrationState` 删除 ——
 * 它只写不读，且每个写入点都与 `teamRegistrationClosed` 同步写同样的值。
 * 但**老数据里可能只有 `frozen` 没有后面那两个布尔**，所以这里仍要能读到它。
 */
export function normalizeRegistrationState(value: unknown): RegistrationState {
  const source = typeof value === "object" && value !== null
    ? (value as Partial<RegistrationState> & { frozen?: boolean })
    : {};
  const legacyFrozen = source.frozen === true;
  const hasPlayerClosedFlag = typeof source.playerRegistrationClosed === "boolean";
  const hasTeamClosedFlag = typeof source.teamRegistrationClosed === "boolean";
  /**
   * 审核口径（2026-09-17 改为「默认通过 + 手动标记需修改」）：
   * 负责人不需要逐个审核报名；只有在选手列表里**主动标记**过的才是不通过。
   * 因此这里把未设置、历史「待审核」、以及任何脏值都归为「已通过」，
   * 只保留明确标记的「需修改」「已拒绝」——这两个会挡住建队/入队/换人/冻结名单
   * （见 registration-admin-ops.ts 的四处门槛）。
   *
   * 这样归一化后无需迁移生产数据：库里即使是「待审核」，读写时也按「已通过」处理，
   * 下次写回即自动落成「已通过」。
   */
  const flaggedStatuses = new Set(["需修改", "已拒绝"]);
  const teams = Array.isArray(source.teams) ? source.teams : [];
  return {
    players: Array.isArray(source.players) ? source.players.map((player) => ({
      ...player,
      reviewStatus: flaggedStatuses.has(player.reviewStatus ?? "") ? player.reviewStatus : "已通过",
    })) : [],
    teams,
    teamRequests: Array.isArray(source.teamRequests) ? source.teamRequests : [],
    operationLogs: Array.isArray(source.operationLogs) ? source.operationLogs : [],
    playerRegistrationClosed: hasPlayerClosedFlag ? source.playerRegistrationClosed === true : legacyFrozen,
    teamRegistrationClosed: hasTeamClosedFlag ? source.teamRegistrationClosed === true : legacyFrozen,
  };
}

/** 队伍规格：5 首发 + 1 替补（可选）+ 1 教练（可选） */
export const TEAM_SIZE = 5;
export const MAX_SUBSTITUTE = 1;
export const MAX_COACH = 1;
