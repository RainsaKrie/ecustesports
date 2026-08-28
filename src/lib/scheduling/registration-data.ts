// =====================
// 报名与队伍数据模型（报名内置 MVP）
// 对齐 docs/03-需求定义/05-报名与队伍.md
// =====================

/** 选手（报名最小单元） */
export interface RegistrationPlayer {
  id: string;
  name: string; // 姓名（必填，仅负责人可见）
  studentId: string; // 学号（必填，仅负责人可见）
  gameId: string; // 游戏 ID（必填，公开显示）
  rank: string; // 段位（必填，用于种子计算）
  qq?: string; // 可选
  wechat?: string; // 可选
  phone?: string; // 可选
  college?: string; // 学院（可选）
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
  frozen: boolean;
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
  /** 旧字段兼容：队伍申报截止后名单冻结 */
  frozen: boolean;
}

export function initialRegistration(): RegistrationState {
  return {
    players: [],
    teams: [],
    teamRequests: [],
    operationLogs: [],
    playerRegistrationClosed: false,
    teamRegistrationClosed: false,
    frozen: false,
  };
}

/** 兼容 3.24 及更早只保存 frozen 的赛事报名数据。 */
export function normalizeRegistrationState(value: unknown): RegistrationState {
  const source = typeof value === "object" && value !== null
    ? (value as Partial<RegistrationState>)
    : {};
  const legacyFrozen = source.frozen === true;
  const hasPlayerClosedFlag = typeof source.playerRegistrationClosed === "boolean";
  const hasTeamClosedFlag = typeof source.teamRegistrationClosed === "boolean";
  const reviewStatuses = new Set(["待审核", "已通过", "需修改", "已拒绝"]);
  const teams = Array.isArray(source.teams) ? source.teams : [];
  const legacyConfirmedTeamIds = new Set(teams.filter((team) => team.status === "已冻结").map((team) => team.id));
  return {
    players: Array.isArray(source.players) ? source.players.map((player) => ({
      ...player,
      reviewStatus: reviewStatuses.has(player.reviewStatus ?? "")
        ? player.reviewStatus
        : player.teamId && legacyConfirmedTeamIds.has(player.teamId) ? "已通过" : "待审核",
    })) : [],
    teams,
    teamRequests: Array.isArray(source.teamRequests) ? source.teamRequests : [],
    operationLogs: Array.isArray(source.operationLogs) ? source.operationLogs : [],
    playerRegistrationClosed: hasPlayerClosedFlag ? source.playerRegistrationClosed === true : legacyFrozen,
    teamRegistrationClosed: hasTeamClosedFlag ? source.teamRegistrationClosed === true : legacyFrozen,
    frozen: hasTeamClosedFlag ? source.teamRegistrationClosed === true : legacyFrozen,
  };
}

/** 队伍规格：5 首发 + 1 替补（可选）+ 1 教练（可选） */
export const TEAM_SIZE = 5;
export const MAX_SUBSTITUTE = 1;
export const MAX_COACH = 1;
