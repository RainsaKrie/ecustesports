// =====================
// 赛制拓扑的底座（2026-10-19 从 `bracket-engine.ts` 抽出）
//
// 占位常量（TBD / BYE / PENDING）、槽位与建场次的类型、以及五个内部工具函数。
// 纯搬家：函数体一行未改，只是把内部符号改成 export 供主文件调用。
// 主文件会 re-export 三个常量，所以引用方与测试都不需要改 import。
// =====================

import type { ScheduleMatch } from "./schedule-data.ts";

export const TBD = "TBD";

/** 轮空占位：签位中该位置直接晋级，不生成比赛。 */
export const BYE = "BYE";

/**
 * 预留席位占位符。
 *
 * 用于「资格赛还没全部打完，但想先把剩余席位抽掉」的场景：
 * 入围赛有 `advancingTeams × 2` 个签位，其中几个要等资格赛胜者，
 * 就把这几个位置填成 PENDING。
 *
 * **与 BYE 的区别**：BYE 表示「对手轮空、本队直接晋级」，**不产生比赛**；
 * PENDING 表示「对手待定」，**比赛照常生成**，等资格赛补齐后再填队。
 * 所以有 PENDING 时轮空数为 0，16 场全打。
 */
export const PENDING = "PENDING";


export interface Slot {
  id: string;
  side: "A" | "B";
}

export interface MatchFactoryOptions {
  startIndex?: number;
  phase: string;
  /** 组内是否打决赛（仅组内单败用）。默认 true；false 时每组只出半决赛。 */
  groupFinalEnabled?: boolean;
  /**
   * 该场比赛所属的轮次名。单轮阶段（资格赛、入围赛）不传时默认等于阶段名 ——
   * 不能写死成「入围赛」：四阶段赛制里资格赛也复用这个构造器，写死会让
   * 资格赛的对阵显示成「资格赛 · 入围赛」。
   */
  round?: string;
  boType: ScheduleMatch["boType"];
}

export function slot(id: string, side: "A" | "B"): Slot {
  return { id, side };
}

export function matchId(index: number): string {
  return `M${String(index).padStart(2, "0")}`;
}

export function createMatch(
  id: string,
  phase: string,
  round: string,
  boType: ScheduleMatch["boType"],
  extra: Partial<ScheduleMatch> = {},
): ScheduleMatch {
  return {
    id,
    phase,
    round,
    boType,
    teamAId: TBD,
    teamBId: TBD,
    teamAName: "待定",
    teamBName: "待定",
    startTime: "",
    endTime: "",
    status: "待排期",
    frozen: false,
    ...extra,
  };
}

export function isPowerOfTwo(value: number): boolean {
  return value >= 2 && (value & (value - 1)) === 0;
}

export function singleEliminationRoundName(entrants: number, roundIndex: number): string {
  if (entrants === 2) return "决赛";
  if (entrants === 4) return "半决赛";
  if (entrants === 8) return "四分之一决赛";
  return `第 ${roundIndex + 1} 轮`;
}

/** 生成完整单败结构；例如 4 队 = 2 场半决赛 + 1 场决赛。 */

/** 去掉一组对阵里的决赛，并断开指向它的连线（2026-10-26，组内决赛开关用）。 */
export function dropFinalRound(matches: ScheduleMatch[], enabled: boolean): ScheduleMatch[] {
  if (enabled) return matches;
  const kept = matches.filter((m) => !(m.round ?? "").endsWith("决赛") || (m.round ?? "").endsWith("半决赛"));
  const gone = new Set(matches.filter((m) => !kept.includes(m)).map((m) => m.id));
  return kept.map((m) => (gone.has(m.nextMatchId ?? "") ? { ...m, nextMatchId: undefined } : m));
}
