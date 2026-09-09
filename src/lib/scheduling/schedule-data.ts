// =====================
// 赛程数据模型与初始演示数据（改期闭环 MVP）
// =====================

import { DEFAULT_CONFIG, type BOType, type Conflict, type SchedulingConfig } from "./rule-engine";

export type MatchStatus = "待排期" | "已排期" | "已完成";

/** 单局结果（逐局比分，不简化） */
export interface GameResult {
  map?: string; // 本局地图名
  teamAScore: number; // 本局 A 得分
  teamBScore: number; // 本局 B 得分
}

/** 赛程中的一场比赛 */
export interface ScheduleMatch {
  id: string;
  phase: string; // 阶段名
  teamAId: string; // 队伍 ID（匿名，用于约束校验）
  teamBId: string;
  teamAName: string; // 展示名
  teamBName: string;
  boType: BOType;
  startTime: string; // "2026-10-06T12:00:00"，空表示待排期
  endTime: string;
  status: MatchStatus;
  frozen: boolean;
  prerequisiteId?: string;
  // 比赛执行相关
  gameResults?: GameResult[]; // 逐局结果
  bpMaps?: string[]; // BP 选出的地图（按选图顺序，用于逐局地图）
  winnerTeamId?: string; // 胜者队伍
  nextMatchId?: string; // 胜者晋级到的下一场比赛
  nextSide?: "A" | "B"; // 胜者填入下一场的哪一侧
  nextLoserMatchId?: string; // 败者进入的下一场比赛（双败淘汰）
  nextLoserSide?: "A" | "B"; // 败者填入下一场的哪一侧
  round?: string; // 轮次（首轮 / 次轮 / 决赛等）
}

/** 一条改期申请 */
export interface RescheduleRecord {
  id: string;
  matchId: string;
  newStartTime: string;
  reason: string;
  teamAConfirmed: boolean;
  teamBConfirmed: boolean;
  basedOnVersion: number; // 申请基于的赛程版本号（AC-03：旧版本申请不能直接批准）
  submittedAt: string;
  /** 发起队伍；旧的负责人代录申请可能没有该字段。 */
  proposedByTeamId?: string;
  status: "待对手确认" | "待审批" | "已批准" | "已驳回" | "已失效";
  conflicts: Conflict[]; // 提交或批准前校验时的冲突结果
  confirmedAt?: string;
  resolvedAt?: string;
}

/** 赛程版本快照 */
export interface ScheduleVersion {
  version: number;
  matches: ScheduleMatch[];
  note: string;
  createdAt: string;
}

/** 通知草稿 */
export interface NotificationDraft {
  id: string;
  version: number;
  content: string;
  status: "草稿" | "已发送";
  createdAt: string;
}

/** 完整赛程状态 */
export interface ScheduleState {
  /** 本届赛事实际使用的排程约束；由赛程工作区维护，不再使用固定演示日期。 */
  config: SchedulingConfig;
  /** 新赛事必须由负责人确认一次，避免把演示日期误当作本届规则。 */
  configConfirmed: boolean;
  version: number;
  matches: ScheduleMatch[];
  versions: ScheduleVersion[];
  requests: RescheduleRecord[];
  notifications: NotificationDraft[];
}

/** 对阵图中的占位签位：尚未填队或轮空，都不算真实队伍写入。 */
const BRACKET_PLACEHOLDERS = new Set(["", "TBD", "BYE"]);

/** 是否为一个真实队伍 id（非待定/轮空占位）。 */
export function isRealTeamId(teamId: string): boolean {
  return !BRACKET_PLACEHOLDERS.has(teamId);
}

/** 已写入对阵图的真实队伍 id 集合。抽签发布后，队伍 id 首次落盘即在此。 */
export function bracketTeamIds(matches: ScheduleMatch[]): Set<string> {
  const ids = new Set<string>();
  for (const match of matches) {
    if (isRealTeamId(match.teamAId)) ids.add(match.teamAId);
    if (isRealTeamId(match.teamBId)) ids.add(match.teamBId);
  }
  return ids;
}

/** 该队伍是否已进入对阵图。删除入口据此判断：进图只允许整队退赛，不允许删除。 */
export function teamInBracket(matches: ScheduleMatch[], teamId: string): boolean {
  return bracketTeamIds(matches).has(teamId);
}

/** 新赛事的真实空状态。演示赛程只能由负责人主动载入，不能作为读失败兜底。 */
export function emptySchedule(): ScheduleState {
  return {
    config: { ...DEFAULT_CONFIG, boDurations: { ...DEFAULT_CONFIG.boDurations } },
    configConfirmed: false,
    version: 0,
    matches: [],
    versions: [],
    requests: [],
    notifications: [],
  };
}

/** 兼容早期没有 config 的赛程文件。 */
export function normalizeScheduleState(value: unknown): ScheduleState {
  const source = typeof value === "object" && value !== null
    ? value as Partial<ScheduleState>
    : {};
  const savedConfig = source.config;
  return {
    config: {
      ...DEFAULT_CONFIG,
      ...(savedConfig ?? {}),
      boDurations: {
        ...DEFAULT_CONFIG.boDurations,
        ...(savedConfig?.boDurations ?? {}),
      },
    },
    configConfirmed: source.configConfirmed === true,
    version: typeof source.version === "number" ? source.version : 0,
    matches: Array.isArray(source.matches) ? source.matches : [],
    versions: Array.isArray(source.versions) ? source.versions : [],
    requests: Array.isArray(source.requests) ? source.requests : [],
    notifications: Array.isArray(source.notifications) ? source.notifications : [],
  };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function fmt(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

function mk(
  id: string,
  phase: string,
  teamAId: string,
  teamAName: string,
  teamBId: string,
  teamBName: string,
  boType: BOType,
  start: string,
  durationMin: number,
  extra: Partial<ScheduleMatch> = {},
): ScheduleMatch {
  const startMs = new Date(start).getTime();
  const endMs = startMs + durationMin * 60 * 1000;
  return {
    id,
    phase,
    teamAId,
    teamAName,
    teamBId,
    teamBName,
    boType,
    startTime: start,
    endTime: fmt(new Date(endMs)),
    status: "已排期",
    frozen: false,
    ...extra,
  };
}

/** 初始演示赛程：入围赛 6 场，每时段并发 2 场（满容量），方便演示并发冲突 */
export function initialSchedule(): ScheduleState {
  const matches: ScheduleMatch[] = [
    mk("M01", "入围赛", "A", "星辰电竞", "B", "暗影战队", "BO3", "2026-10-06T12:00:00", 90),
    mk("M02", "入围赛", "C", "烈焰先锋", "D", "寒冰之刃", "BO3", "2026-10-06T12:00:00", 90),
    mk("M03", "入围赛", "E", "雷霆万钧", "F", "风暴联盟", "BO3", "2026-10-06T14:00:00", 90),
    mk("M04", "入围赛", "G", "极光战队", "H", "深渊之怒", "BO3", "2026-10-06T14:00:00", 90),
    mk("M05", "入围赛", "I", "幻影骑士", "J", "铁血战狼", "BO3", "2026-10-06T16:00:00", 90),
    mk("M06", "入围赛", "K", "破晓之光", "L", "暗夜行者", "BO3", "2026-10-06T16:00:00", 90),
  ];
  return {
    config: { ...DEFAULT_CONFIG, boDurations: { ...DEFAULT_CONFIG.boDurations } },
    configConfirmed: true,
    version: 1,
    matches,
    versions: [
      {
        version: 1,
        matches,
        note: "初始赛程草案",
        createdAt: new Date().toISOString(),
      },
    ],
    requests: [],
    notifications: [],
  };
}
