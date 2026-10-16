// =====================
// 批量排期规划器（2026-10-16，P2）
//
// 为什么需要它：赛程页排期是**逐场**设置的，一次要排 11 场（淘汰赛还有 14 场）时，
// 手工排最怕的是**撞车** —— 同一时段超过并发上限、或越出比赛时段。
// 手工做这件事要一边看已有排期一边算时长，很容易出错。
//
// 所以把"填时间"这件事抽成一个**确定性纯函数**：同样的输入永远得到同样的输出，
// 于是它可以被断言、可以重跑、可以在写入前先跑一遍看结果（dry-run）。
//
// 约束来源：`SchedulingConfig`（并发上限 / 各 BO 时长 / 时段窗口），与单场排期用的是同一份配置。
// =====================

import { computeEndTime, type SchedulingConfig } from "./rule-engine";
import type { ScheduleMatch } from "./schedule-data";

/** 时间推进粒度：15 分钟（排期以整点/半点为主，粒度太细会产生奇怪的时间） */
const STEP_MINUTES = 15;

export interface BulkAssignment {
  matchId: string;
  startTime: string;
  endTime: string;
}

export interface BulkPlan {
  /** 可以排上的场次（按给定顺序） */
  assignments: BulkAssignment[];
  /** 排不上的场次与原因（不静默丢弃） */
  skipped: Array<{ matchId: string; reason: string }>;
}

const toMs = (value: string) => new Date(value).getTime();
const formatLocal = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

function durationMinutes(boType: ScheduleMatch["boType"], config: SchedulingConfig): number {
  return config.boDurations[boType] ?? config.boDurations.BO3;
}

/** 某个时刻正在进行的场次数（半开区间，首尾相接不算重叠） */
function concurrentAt(intervals: Array<{ start: number; end: number }>, at: number): number {
  return intervals.filter((interval) => interval.start <= at && at < interval.end).length;
}

/**
 * 把待排期的场次依次填进时段。
 *
 * @param pending  待排期的场次，**按给定顺序**依次安置（调用方决定先排哪场）
 * @param occupied 已排期 / 已完成的场次（它们占用的时段必须被尊重）
 * @param config   并发上限、BO 时长、时段窗口
 *
 * 规则：从 `stageStart` 起以 15 分钟为步长找**最早**的可用时间；
 * 一个时刻的并发数（含已占用）不得超过 `maxConcurrentMatches`；
 * 结束时间超出 `stageEnd` 的场次记为 skipped 并写明原因，**不静默丢弃**。
 */
export function planBulkSchedule(
  pending: ScheduleMatch[],
  occupied: ScheduleMatch[],
  config: SchedulingConfig,
): BulkPlan {
  const windowStart = toMs(config.stageStart);
  const windowEnd = toMs(config.stageEnd);
  const intervals = occupied
    .filter((match) => Boolean(match.startTime) && Boolean(match.endTime))
    .map((match) => ({ start: toMs(match.startTime), end: toMs(match.endTime) }));

  const assignments: BulkAssignment[] = [];
  const skipped: BulkPlan["skipped"] = [];

  for (const match of pending) {
    const minutes = durationMinutes(match.boType, config);
    let placed: BulkAssignment | null = null;

    for (let cursor = windowStart; cursor + minutes * 60_000 <= windowEnd; cursor += STEP_MINUTES * 60_000) {
      const startTime = formatLocal(new Date(cursor));
      const endTime = computeEndTime(startTime, match.boType, config);
      const end = toMs(endTime);
      if (end > windowEnd) break;
      // 整场都不得超并发：检查期间每个起点时刻的并发数
      let peak = 0;
      for (let probe = cursor; probe < end; probe += STEP_MINUTES * 60_000) {
        peak = Math.max(peak, concurrentAt([...intervals, ...assignments.map((a) => ({ start: toMs(a.startTime), end: toMs(a.endTime) }))], probe));
      }
      if (peak < config.maxConcurrentMatches) {
        placed = { matchId: match.id, startTime, endTime };
        break;
      }
    }

    if (placed) assignments.push(placed);
    else skipped.push({ matchId: match.id, reason: `比赛时段（${config.stageStart} ~ ${config.stageEnd}）内已排不下 ${match.boType}` });
  }

  return { assignments, skipped };
}

/** 把规划结果套用到赛程上（纯函数，返回新数组；不动没被排的场次） */
export function applyBulkAssignments(matches: ScheduleMatch[], assignments: BulkAssignment[]): ScheduleMatch[] {
  const byId = new Map(assignments.map((item) => [item.matchId, item]));
  return matches.map((match) => {
    const hit = byId.get(match.id);
    if (!hit) return match;
    return { ...match, startTime: hit.startTime, endTime: hit.endTime, status: "已排期" as const };
  });
}
