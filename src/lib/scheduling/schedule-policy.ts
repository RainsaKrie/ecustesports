// =====================
// 从赛事配置推导「排期参数与比赛日窗口」（2026-10-16）
//
// 为什么单独抽出来：命令行排期脚本（tools/gate6/auto-schedule.ts）与后台界面按钮都要做这件事。
// 两处各写一份就会变成"同一个真值散落两处"—— 正是这几天反复踩的那类坑（见
// 《数据结构与状态精简方案》第九节的变更登记表）。
//
// 设计要点：**`now` 可注入**。窗口按"今天之后的周末"生成，若直接读系统时间，测试就无法固定，
// 断言会随日期漂移（今天写 10-17 就会在明天变成红）。
// =====================

import type { SchedulingConfig, BOType } from "./rule-engine";
import type { ScheduleWindow } from "./bulk-schedule";

/** 客户端与脚本都能传的最小事件形状（只读，不依赖具体类型定义） */
export interface SchedulePolicyEvent {
  eventDateLabel?: string;
  constraints?: unknown;
}

export interface SchedulePlanInput {
  config: SchedulingConfig;
  windows: ScheduleWindow[];
}

const pad = (n: number) => String(n).padStart(2, "0");
const fmtDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * 比赛日候选：赛期内的周六周日（默认取前 8 天，够排一届小组赛 + 淘汰赛）。
 * 赛期从 `eventDateLabel`（形如「比赛时间10.7-11.8」）解析，取不到时退回"从现在起 14 天"。
 */
export function matchdayCandidates(event: SchedulePolicyEvent, now: Date = new Date()): string[] {
  const span = String(event.eventDateLabel ?? "").match(/(\d{1,2})[.\-/](\d{1,2})\s*[-~至]\s*(\d{1,2})[.\-/](\d{1,2})/);
  const year = now.getFullYear();
  const end = span
    ? new Date(year, Number(span[3]) - 1, Number(span[4]))
    : new Date(now.getTime() + 14 * 86_400_000);
  const out: string[] = [];
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() + 1);
  while (cursor <= end && out.length < 8) {
    if (cursor.getDay() === 6 || cursor.getDay() === 0) out.push(fmtDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

/**
 * 排出本次排期要用的配置与窗口。
 *
 * @param options.days 显式指定比赛日（覆盖自动生成）；每项形如 `2026-10-17`
 * @param options.now  注入"现在"，便于测试固定日期
 */
export function schedulePlanInputFromEvent(
  event: SchedulePolicyEvent,
  options: { days?: string[]; now?: Date } = {},
): SchedulePlanInput {
  const constraints = (event.constraints ?? {}) as Record<string, unknown>;
  const durations = (constraints.durations ?? {}) as Record<string, number>;
  const sessionStart = String(constraints.sessionStart ?? "12:00");
  const sessionEnd = String(constraints.sessionEnd ?? "18:00");
  const windowOf = (day: string): ScheduleWindow => ({ start: `${day}T${sessionStart}:00`, end: `${day}T${sessionEnd}:00` });

  const days = options.days && options.days.length > 0
    ? options.days.filter(Boolean)
    : matchdayCandidates(event, options.now);
  const fallback = fmtDate(options.now ?? new Date());

  return {
    config: {
      maxConcurrentMatches: Number(constraints.maxConcurrent ?? 2),
      boDurations: {
        BO1: durations.BO1 ?? 45,
        BO3: durations.BO3 ?? 90,
        BO5: durations.BO5 ?? 150,
      } as Record<BOType, number>,
      stageStart: windowOf(days[0] ?? fallback).start,
      stageEnd: windowOf(days[days.length - 1] ?? fallback).end,
    },
    windows: days.map(windowOf),
  };
}

/** 待排期的场次里，哪些因为「参赛队还没定」本轮排不了（组内决赛、淘汰赛后续轮次都属这类） */
export function partitionSchedulable<T extends { status: string; teamAId: string; teamBId: string }>(
  matches: T[],
): { schedulable: T[]; awaitingTeams: T[] } {
  const pending = matches.filter((m) => m.status === "待排期");
  return {
    schedulable: pending.filter((m) => m.teamAId !== "TBD" && m.teamBId !== "TBD"),
    awaitingTeams: pending.filter((m) => m.teamAId === "TBD" || m.teamBId === "TBD"),
  };
}
