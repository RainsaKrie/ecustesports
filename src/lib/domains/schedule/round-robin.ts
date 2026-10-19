// =====================
// 循环赛配对（2026-10-19）
//
// 段类型里的 `round-robin` 此前**只有类型、没有引擎**（选了会掉进空分支）。
// 这里补上：圆桌轮转法（circle method），奇数队自动补一个轮空位。
//
// 纯函数，不产生 ScheduleMatch —— 只输出「每一轮有哪些配对」，
// 由排期层决定时间、场地、BO，与单败/双败的构建器保持同一分工。
// =====================

import type { Matchup } from "@/lib/domains/registration/format";

/** 轮空占位：奇数队时补一个，配到它的一方本轮休息 */
export const ROUND_ROBIN_BYE = "__BYE__";

export interface RoundRobinOptions {
  /** 双循环：每对打两场（主客互换） */
  doubleRound?: boolean;
  /** 分组名（写进 Matchup.group） */
  group?: string;
}

/**
 * 生成循环赛的每轮配对。
 * 队数 n：单循环 n−1 轮（偶数）或 n 轮（奇数，因补了轮空）；
 * 每轮 ⌊n/2⌋ 场；总场次 = n(n−1)/2（双循环 ×2）。
 */
export function buildRoundRobinRounds(teamIds: string[], options: RoundRobinOptions = {}): Matchup[][] {
  const unique = [...new Set(teamIds.filter((id) => id && id !== ROUND_ROBIN_BYE))];
  if (unique.length < 2) return [];

  // 奇数补轮空，凑成偶数
  const slots = unique.length % 2 === 0 ? [...unique] : [...unique, ROUND_ROBIN_BYE];
  const half = slots.length / 2;

  // 固定第 0 位，其余顺时针轮转
  let rotating = slots.slice(1);
  const rounds: Matchup[][] = [];
  const roundCount = slots.length - 1;

  for (let round = 0; round < roundCount; round += 1) {
    const line = [slots[0], ...rotating];
    const pairs: Matchup[] = [];
    for (let i = 0; i < half; i += 1) {
      const a = line[i];
      const b = line[line.length - 1 - i];
      if (a === ROUND_ROBIN_BYE || b === ROUND_ROBIN_BYE) continue; // 轮空不计场次
      pairs.push({ teamAId: a, teamBId: b, group: options.group });
    }
    if (pairs.length > 0) rounds.push(pairs);
    rotating = [rotating[rotating.length - 1], ...rotating.slice(0, -1)];
  }

  if (!options.doubleRound) return rounds;
  // 双循环：第二轮把主客互换
  const mirrored = rounds.map((pairs) => pairs.map((m) => ({ teamAId: m.teamBId, teamBId: m.teamAId, group: options.group })));
  return [...rounds, ...mirrored];
}

/** 单循环总场次（用于校验与赛期估算） */
export function roundRobinMatchCount(teamCount: number): number {
  return (teamCount * (teamCount - 1)) / 2;
}
