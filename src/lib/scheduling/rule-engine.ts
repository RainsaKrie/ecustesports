// =====================
// 排程约束校验规则引擎（P0 临时改期闭环）
// 对应硬约束 HC-01 ~ HC-08，见 docs/03-需求定义/02-最小约束与人工例外确认表.md
// =====================

export type BOType = "BO1" | "BO3" | "BO5";

/** 一场已排程的比赛（用于约束校验的输入快照） */
export interface ScheduledMatch {
  id: string;
  teamAId: string;
  teamBId: string;
  boType: BOType;
  startTime: string; // 本地时间字符串，如 "2026-10-06T12:00:00"
  endTime: string; // 由 boType 计算得到
  frozen: boolean;
  prerequisiteMatchId?: string; // 前置比赛（晋级依赖）
  status?: string; // 比赛状态（用于排期校验：已完成不可再改时间）
}

/** 改期申请 */
export interface RescheduleRequest {
  matchId: string;
  newStartTime: string;
  teamAConfirmed: boolean;
  teamBConfirmed: boolean;
  basedOnVersion: number; // 申请基于的赛程版本号
}

/** 排程规则配置 */
export interface SchedulingConfig {
  maxConcurrentMatches: number; // 时段最大并发场次（默认 2）
  boDurations: Record<BOType, number>; // 各 BO 时长（分钟）
  stageStart: string; // 阶段起止
  stageEnd: string;
}

/** 冲突项 */
export interface Conflict {
  code: string; // HC-01 ~ HC-08
  message: string;
}

/** 校验结果 */
export interface ValidationResult {
  approved: boolean; // 是否可批准
  conflicts: Conflict[]; // 全部冲突（按首要原因排序）
  primaryConflict: string; // 首要阻塞约束编号（无冲突为空字符串）
}

export const DEFAULT_CONFIG: SchedulingConfig = {
  maxConcurrentMatches: 2,
  boDurations: { BO1: 45, BO3: 90, BO5: 150 },
  stageStart: "2026-10-06T12:00:00",
  stageEnd: "2026-10-08T18:00:00",
};

/** 根据开始时间 + BO 时长计算结束时间 */
export function computeEndTime(startTime: string, boType: BOType, config: SchedulingConfig): string {
  const start = new Date(startTime).getTime();
  const durationMs = config.boDurations[boType] * 60 * 1000;
  const end = new Date(start + durationMs);
  return formatLocal(end);
}

function formatLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 两个时间段是否重叠（半开区间 [aStart, aEnd) 与 [bStart, bEnd)） */
function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return new Date(aStart).getTime() < new Date(bEnd).getTime() &&
    new Date(bStart).getTime() < new Date(aEnd).getTime();
}

/**
 * 计算候选比赛持续期间的峰值并发，而不是把所有曾与候选比赛相交的场次直接相加。
 * 例如两场比赛分别占用 12:00-12:45 和 12:45-13:30，候选比赛横跨整个时段时，
 * 峰值是 2 场，不是 3 场。相同时间点先处理结束事件，保持半开区间语义。
 */
function peakConcurrentMatches(
  candidateStart: string,
  candidateEnd: string,
  otherMatches: ScheduledMatch[],
): number {
  const start = new Date(candidateStart).getTime();
  const end = new Date(candidateEnd).getTime();
  const events: Array<{ time: number; delta: 1 | -1 }> = [];

  for (const match of otherMatches) {
    if (!overlaps(candidateStart, candidateEnd, match.startTime, match.endTime)) continue;
    events.push(
      { time: Math.max(start, new Date(match.startTime).getTime()), delta: 1 },
      { time: Math.min(end, new Date(match.endTime).getTime()), delta: -1 },
    );
  }

  events.sort((a, b) => a.time - b.time || a.delta - b.delta);
  let active = 1;
  let peak = 1;
  for (const event of events) {
    active += event.delta;
    peak = Math.max(peak, active);
  }
  return peak;
}

/** 首要原因排序：越靠前越优先作为"首要阻塞" */
const PRIORITY = ["HC-01", "HC-02", "HC-08", "HC-06", "HC-04", "HC-05", "HC-07", "HC-03"];

/**
 * 校验一次改期申请是否可批准。
 * @param request 改期申请
 * @param matches 当前赛程的所有比赛
 * @param currentVersion 当前有效赛程版本号
 * @param config 规则配置
 */
export function validateReschedule(
  request: RescheduleRequest,
  matches: ScheduledMatch[],
  currentVersion: number,
  config: SchedulingConfig = DEFAULT_CONFIG,
): ValidationResult {
  const conflicts: Conflict[] = [];
  const target = matches.find((m) => m.id === request.matchId);

  // HC-01：比赛存在 + 申请基于当前有效版本
  if (!target) {
    return { approved: false, conflicts: [{ code: "HC-01", message: "比赛不存在" }], primaryConflict: "HC-01" };
  }
  if (target.status === "已完成") {
    return { approved: false, conflicts: [{ code: "HC-01", message: "比赛已完成，不能再改期" }], primaryConflict: "HC-01" };
  }
  if (request.basedOnVersion !== currentVersion) {
    conflicts.push({
      code: "HC-01",
      message: `申请基于旧版本 v${request.basedOnVersion}，当前为 v${currentVersion}，需刷新后重新提交`,
    });
  }

  // HC-02：两队队长确认同一个约赛时间
  if (!request.teamAConfirmed || !request.teamBConfirmed) {
    conflicts.push({ code: "HC-02", message: "两队队长未都确认同一约赛开始时间" });
  }

  // HC-03：能从 BO 类型得到完整占用时长
  const duration = config.boDurations[target.boType];
  if (duration === undefined || duration <= 0) {
    conflicts.push({ code: "HC-03", message: "无法从 BO 类型得到占用时长" });
  }

  const newStart = request.newStartTime;
  const newEnd = duration > 0 ? computeEndTime(newStart, target.boType, config) : newStart;

  // HC-08：冻结比赛必须先解冻
  if (target.frozen) {
    conflicts.push({ code: "HC-08", message: "比赛处于冻结状态，须先由负责人解除冻结" });
  }

  // HC-07：约赛时间不超出阶段起止范围
  if (new Date(newStart).getTime() < new Date(config.stageStart).getTime() ||
    new Date(newEnd).getTime() > new Date(config.stageEnd).getTime()) {
    conflicts.push({ code: "HC-07", message: "约赛时间超出赛事阶段起止范围" });
  }

  // HC-05：后续比赛不能早于前置比赛结束
  if (target.prerequisiteMatchId) {
    const prereq = matches.find((m) => m.id === target.prerequisiteMatchId);
    if (prereq && new Date(newStart).getTime() < new Date(prereq.endTime).getTime()) {
      conflicts.push({ code: "HC-05", message: `前置比赛 ${prereq.id} 尚未结束` });
    }
  }

  // HC-04：参赛队伍在该时段没有其他比赛
  const otherMatches = matches.filter((m) => m.id !== target.id);
  for (const m of otherMatches) {
    const sharesTeam =
      m.teamAId === target.teamAId || m.teamAId === target.teamBId ||
      m.teamBId === target.teamAId || m.teamBId === target.teamBId;
    if (sharesTeam && overlaps(newStart, newEnd, m.startTime, m.endTime)) {
      conflicts.push({ code: "HC-04", message: `参赛队伍在申请时段已有比赛 ${m.id}` });
    }
  }

  // HC-06：时段并发不超过裁判容量
  const peakConcurrent = peakConcurrentMatches(newStart, newEnd, otherMatches);
  if (peakConcurrent > config.maxConcurrentMatches) {
    conflicts.push({
      code: "HC-06",
      message: `该时段峰值并发 ${peakConcurrent} 场，超过裁判容量 ${config.maxConcurrentMatches}`,
    });
  }

  conflicts.sort((a, b) => PRIORITY.indexOf(a.code) - PRIORITY.indexOf(b.code));

  return {
    approved: conflicts.length === 0,
    conflicts,
    primaryConflict: conflicts.length > 0 ? conflicts[0].code : "",
  };
}

/**
 * 校验一次「排期 / 直接改期」操作（负责人直接设置比赛时间，不经过两队确认流程）。
 * 跳过 HC-01 版本与 HC-02 双方确认，检查 HC-03~HC-08 的硬约束。
 * @param target 目标比赛（当前状态快照）
 * @param newStartTime 新的开始时间
 * @param matches 当前赛程的所有比赛
 * @param config 规则配置
 */
export function validateMatchTime(
  target: ScheduledMatch | undefined,
  newStartTime: string,
  matches: ScheduledMatch[],
  config: SchedulingConfig = DEFAULT_CONFIG,
): ValidationResult {
  if (!target) {
    return { approved: false, conflicts: [{ code: "HC-01", message: "比赛不存在" }], primaryConflict: "HC-01" };
  }

  const conflicts: Conflict[] = [];

  // 已完成的比赛不能再调整时间
  if (target.status === "已完成") {
    conflicts.push({ code: "HC-01", message: "比赛已完成，不能再调整时间" });
  }

  // HC-03：能从 BO 类型得到完整占用时长
  const duration = config.boDurations[target.boType];
  if (duration === undefined || duration <= 0) {
    conflicts.push({ code: "HC-03", message: "无法从 BO 类型得到占用时长" });
  }

  const newStart = newStartTime;
  const newEnd = duration > 0 ? computeEndTime(newStart, target.boType, config) : newStart;

  // HC-08：冻结比赛必须先解冻
  if (target.frozen) {
    conflicts.push({ code: "HC-08", message: "比赛处于冻结状态，须先由负责人解除冻结" });
  }

  // HC-07：时间不超出阶段起止范围
  if (new Date(newStart).getTime() < new Date(config.stageStart).getTime() ||
    new Date(newEnd).getTime() > new Date(config.stageEnd).getTime()) {
    conflicts.push({ code: "HC-07", message: "时间超出赛事阶段起止范围" });
  }

  // HC-05：后续比赛不能早于前置比赛结束
  if (target.prerequisiteMatchId) {
    const prereq = matches.find((m) => m.id === target.prerequisiteMatchId);
    if (prereq && new Date(newStart).getTime() < new Date(prereq.endTime).getTime()) {
      conflicts.push({ code: "HC-05", message: `前置比赛 ${prereq.id} 尚未结束` });
    }
  }

  // HC-04：参赛队伍在该时段没有其他比赛（待定队伍占位不校验）
  const knownTeams = target.teamAId !== "TBD" && target.teamBId !== "TBD";
  if (knownTeams) {
    const otherMatches = matches.filter((m) => m.id !== target.id && m.startTime);
    for (const m of otherMatches) {
      const sharesTeam =
        m.teamAId === target.teamAId || m.teamAId === target.teamBId ||
        m.teamBId === target.teamAId || m.teamBId === target.teamBId;
      if (sharesTeam && overlaps(newStart, newEnd, m.startTime, m.endTime)) {
        conflicts.push({ code: "HC-04", message: `参赛队伍在申请时段已有比赛 ${m.id}` });
      }
    }
  }

  // HC-06：时段并发不超过裁判容量
  const peakConcurrent = peakConcurrentMatches(
    newStart,
    newEnd,
    matches.filter((m) => m.id !== target.id && m.startTime),
  );
  if (peakConcurrent > config.maxConcurrentMatches) {
    conflicts.push({
      code: "HC-06",
      message: `该时段峰值并发 ${peakConcurrent} 场，超过裁判容量 ${config.maxConcurrentMatches}`,
    });
  }

  conflicts.sort((a, b) => PRIORITY.indexOf(a.code) - PRIORITY.indexOf(b.code));

  return {
    approved: conflicts.length === 0,
    conflicts,
    primaryConflict: conflicts.length > 0 ? conflicts[0].code : "",
  };
}
