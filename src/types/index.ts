// =====================
// 核心类型定义
// =====================

/** 赛事状态 */
export type EventStatus = "draft" | "registration" | "ongoing" | "completed" | "archived";

/** 赛制类型 */
export type TournamentFormat = "single-elimination" | "double-elimination" | "round-robin" | "multi-stage";

/** 无畏契约地图 */
export interface ValMap {
  id: string;
  name: string;
  codeName: string;
  image?: string;
}

/** 选手 */
export interface Player {
  id: string;
  nickname: string;
  gameId: string;
  qq: string;
  teamId?: string;
  registeredAt: string;
}

/** 队伍 */
export interface Team {
  id: string;
  name: string;
  seed: number;
  captainId: string;
  playerIds: string[];
  status: "pending" | "approved" | "rejected" | "incomplete";
  registeredAt: string;
  logoColor?: string;
}

/** 对阵/比赛 */
export interface Match {
  id: string;
  round: number;
  matchIndex: number;
  teamAId?: string;
  teamBId?: string;
  scoreA: number | null;
  scoreB: number | null;
  winnerId?: string;
  status: "pending" | "ready" | "ongoing" | "completed";
  scheduledTime?: string;
  bpSessionId?: string;
}

/** 轮次信息 */
export interface RoundInfo {
  round: number;
  name: string;
  matchCount: number;
}

/** 赛事 */
export interface EsportEvent {
  id: string;
  name: string;
  game: string;
  format: TournamentFormat;
  status: EventStatus;
  teamCount: number;
  teamSize: number;
  description: string;
  registrationStart: string;
  registrationEnd: string;
  eventStart: string;
  eventEnd: string;
  rules: string;
  prizePool: string;
  organizer: string;
  coverColor: string;
  posterImage?: string;
  matches: Match[];
  teams: Team[];
  dateLabel?: string;
  registrationLabel?: string;
  stageSummary?: string;
  /**
   * 赛事 QQ 群号（纯数字，空表示未设置）。
   *
   * 玩家侧多页会展示它——报名表单、报名成功、找回信息、赛事详情。
   * 空值时不渲染任何群公告块（见 GroupNotice 的调用处）。
   */
  eventQqGroup?: string;
  preparationSteps?: Array<{ number: string; title: string; detail: string }>;
  rulesList?: Array<{
    title: string;
    detail: string;
    category?: "format" | "match-day" | "conduct" | "incident" | "appeal";
    emphasis?: "normal" | "important" | "warning";
  }>;
  mapPool?: Array<{ id: string; name: string }>;
  stageConfigs?: Array<{
    name: string;
    type: "single-elim" | "single-elim-groups" | "gsl-groups" | "double-elim" | "round-robin";
    teamCount: number;
    boType: "BO1" | "BO3" | "BO5";
    groupCount?: number;
  }>;
}

/** BP 操作类型 */
export type BPAction = "ban" | "pick";

/** BP 操作记录 */
export interface BPActionRecord {
  id: string;
  action: BPAction;
  teamId: string;
  mapId: string;
  timestamp: string;
}

/** BP 会话 */
export interface BPSession {
  id: string;
  matchId: string;
  eventId: string;
  teamAId: string;
  teamBId: string;
  banPickOrder: BPAction[]; // 轮流顺序
  actions: BPActionRecord[];
  currentStep: number;
  status: "waiting" | "in-progress" | "completed";
  mapPool: ValMap[];
}

/** 导航菜单项 */
export interface NavItem {
  label: string;
  href: string;
  icon?: string;
}

/** AI 生成内容 */
export interface AIContent {
  type: "report" | "social" | "moment";
  content: string;
  generatedAt: string;
}
