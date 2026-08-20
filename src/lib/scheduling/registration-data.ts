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
  teamId?: string; // 所属队伍
  role?: "首发" | "替补" | "教练"; // 队内角色
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

/** 报名状态 */
export interface RegistrationState {
  players: RegistrationPlayer[];
  teams: RegistrationTeam[];
  frozen: boolean; // 名单是否冻结
}

export function initialRegistration(): RegistrationState {
  return {
    players: [],
    teams: [],
    frozen: false,
  };
}

/** 队伍规格：5 首发 + 1 替补（可选）+ 1 教练（可选） */
export const TEAM_SIZE = 5;
export const MAX_SUBSTITUTE = 1;
export const MAX_COACH = 1;
