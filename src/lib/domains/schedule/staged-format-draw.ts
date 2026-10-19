// =====================
// 抽签工具（2026-10-19 从 `staged-format.ts` 抽出）
//
// 洗牌 / 排列 / 补位 / 晋级槽 / 对阵顺序 / 下一场起点 —— 都是**纯函数**，不依赖状态。
// 纯搬家：函数体一行未改，只把两个内部函数改成 export。
// 主文件 re-export 六个对外函数，调用方与测试的 import 都不用改。
// =====================

import type { ScheduleMatch } from "./schedule-data.ts";
import { BYE, PENDING } from "./bracket-engine.ts";
import type { GroupQualifier } from "@/lib/domains/schedule/staged-format";

export function shuffled<T>(values: T[], random: () => number): T[] {
  const items = [...values];
  for (let index = items.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1));
    [items[index], items[target]] = [items[target], items[index]];
  }
  return items;
}

export function permutations<T>(values: T[]): T[][] {
  if (values.length <= 1) return [values];
  return values.flatMap((value, index) =>
    permutations([...values.slice(0, index), ...values.slice(index + 1)]).map((rest) => [value, ...rest]),
  );
}

/**
 * 把待定席位随机插进抽签顺序（只在入围赛抽签、且资格赛尚未全部结束时用）。
 *
 * **为什么必须随机**：位置若固定（比如永远放末尾），末尾那支队就必然对上
 * 「资格赛胜者」，而胜者是从资格赛打上来的、平均实力高于普通队 —— 这支队吃亏；
 * 而且这个位置不是抽出来的，等于少了一个随机维度。
 *
 * 插入后 `drawOrder.length` 正好等于总签位数，于是 `buildQualifierSlots` 算出轮空数 0、
 * 16 场全部要打 —— 这正是「预留席位」与「轮空」的分水岭：
 * 轮空是不打直接晋级，待定是该打、只是对手还没定。
 */
export function withPendingSlots(drawOrder: string[], pendingCount: number, random: () => number = Math.random): string[] {
  if (pendingCount <= 0) return drawOrder;
  return shuffled([...drawOrder, ...Array.from({ length: pendingCount }, () => PENDING)], random);
}

/**
 * 自动把资格赛胜者填进入围赛的待定席位。
 *
 * **为什么要有它**：资格赛最后一场报分之后，入围赛里那个「待定（资格赛胜者）」
 * 本该立刻变成真实队名 —— 胜者是确定的，没有歧义。原来的做法是让负责人再去抽签页
 * 点一次「补齐」，纯属多余的等待。
 *
 * **触发条件（三个都满足才动手）**：
 *   ① 入围赛里存在待定席位（PENDING）；
 *   ② 资格赛的场次已全部完成；
 *   ③ 还有没被填进去的胜者。
 *
 * 不满足时**原样返回、不抛错**：它会在每次报分后被调用，绝大多数时候无事可做。
 *
 * 与「轮空」的区别仍然是关键：待定席位对应的比赛**是要打的**，所以这里只填队名，
 * 不跳过任何比赛。
 */
export function autoFillPendingSlots(
  matches: ScheduleMatch[],
  options: {
    /** 资格赛阶段名（提供胜者的那一段）。 */
    qualifierPhase: string;
    /** 资格赛队伍数；晋级数 = 它的一半。 */
    qualifierTeamCount: number;
    /** 队名查询，用于同步填上 teamAName / teamBName。 */
    teamName: (teamId: string) => string;
  },
): { matches: ScheduleMatch[]; filled: number } {
  const stuck = matches.filter(
    (match) => match.teamAId === PENDING || match.teamBId === PENDING,
  );
  if (stuck.length === 0) return { matches, filled: 0 };

  // 资格赛必须全部打完，否则「胜者」还不完整，填了就是填错
  const qualifierMatches = matches.filter((match) => match.phase === options.qualifierPhase);
  const expectedQualifierMatches = options.qualifierTeamCount / 2;
  if (qualifierMatches.length !== expectedQualifierMatches) return { matches, filled: 0 };
  if (qualifierMatches.some((match) => match.status !== "已完成")) return { matches, filled: 0 };

  const winners = qualifierMatches
    .map((match) => match.winnerTeamId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  // 「已经进入围赛」只统计**待定席位所在那一阶段**的比赛。
  // ★ 一开始这里扫了全部 matches，把资格赛自己的参赛队也算成了「已经在入围赛里」，
  //   于是胜者永远被判为「无需填」——线上会表现成「点了补齐没反应」。测试逮住了它。
  const playInPhase = stuck[0].phase;
  const alreadyIn = new Set(
    matches
      .filter((match) => match.phase === playInPhase)
      .flatMap((match) => [match.teamAId, match.teamBId])
      .filter((id) => id !== PENDING && id !== BYE),
  );
  const incoming = winners.filter((id) => !alreadyIn.has(id));
  if (incoming.length === 0) return { matches, filled: 0 };

  let filled = 0;
  const next = matches.map((match) => {
    if (match.teamAId !== PENDING && match.teamBId !== PENDING) return match;
    const replacement = incoming[filled];
    if (!replacement) return match;
    filled += 1;
    const aIsPending = match.teamAId === PENDING;
    return {
      ...match,
      teamAId: aIsPending ? replacement : match.teamAId,
      teamBId: aIsPending ? match.teamBId : replacement,
      teamAName: aIsPending ? options.teamName(replacement) : match.teamAName,
      teamBName: aIsPending ? match.teamBName : options.teamName(replacement),
    };
  });

  return { matches: next, filled };
}

/**
 * 构造入围赛签位：真实队伍按抽签顺序排列，轮空（BYE）补到末尾场次的客队位。
 * 例如 28 队 → 前 12 场真实对阵 + 后 4 场「真实 vs BYE」，正好 16 队晋级。
 */
export function buildQualifierSlots(drawOrder: string[], totalSlots: number, advancingTeams: number): string[] {
  const byes = totalSlots - drawOrder.length;
  if (byes < 0 || byes > advancingTeams) {
    throw new Error(`入围赛签位数量不合法：${drawOrder.length} 支队伍，总签位 ${totalSlots}。`);
  }
  const realMatches = advancingTeams - byes;
  const slots: string[] = [];
  for (let index = 0; index < realMatches; index++) {
    slots.push(drawOrder[index * 2], drawOrder[index * 2 + 1]);
  }
  for (let index = 0; index < byes; index++) {
    slots.push(drawOrder[realMatches * 2 + index], BYE);
  }
  return slots;
}

/** 生成合法八强签位：每场小组第一对小组第二，同组队伍分处不同半区。 */
export function buildKnockoutDrawOrder(qualifiers: GroupQualifier[], random: () => number = Math.random): string[] {
  const winners = qualifiers.filter((item) => item.placement === 1);
  const runners = qualifiers.filter((item) => item.placement === 2);
  if (winners.length !== 4 || runners.length !== 4) throw new Error("淘汰赛抽签需要四个小组的第一名和第二名。");

  const orderedWinners = shuffled(winners, random);
  const winnerIndexByGroup = new Map(orderedWinners.map((item, index) => [item.group, index]));
  const validRunnerOrders = permutations(runners).filter((order) => order.every((runner, index) => {
    const opponent = orderedWinners[index];
    const mateIndex = winnerIndexByGroup.get(runner.group);
    return opponent.group !== runner.group && mateIndex !== undefined && Math.floor(mateIndex / 2) !== Math.floor(index / 2);
  }));
  if (validRunnerOrders.length === 0) throw new Error("无法生成满足同组半区避让的淘汰赛签位。");
  const runnerOrder = validRunnerOrders[Math.floor(random() * validRunnerOrders.length)];
  return orderedWinners.flatMap((winner, index) => [winner.teamId, runnerOrder[index].teamId]);
}

export function nextMatchStartIndex(matches: ScheduleMatch[]): number {
  return matches.reduce((highest, match) => {
    const parsed = Number(match.id.match(/(\d+)$/)?.[1] ?? 0);
    return Math.max(highest, parsed);
  }, 0) + 1;
}
