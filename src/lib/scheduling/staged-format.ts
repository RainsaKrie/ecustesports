import type { Group, SeedPot } from "./format-data";
import type { StageConfig } from "./format-templates";
import type { ScheduleMatch } from "./schedule-data";
import { QUALIFIER_MIN_TEAMS } from "./format-support";
import { BYE } from "./bracket-engine";

export interface StageDrawRecord {
  stageIndex: number;
  kind: "qualifier" | "groups" | "knockout";
  drawOrder?: string[];
  seedPots?: SeedPot[];
  groups?: Group[];
  publishedAt?: string;
}

export interface StagedFormatState {
  drawType?: string;
  drawOrder?: string[];
  seedPots?: SeedPot[];
  groups?: Group[];
  stageDraws?: StageDrawRecord[];
  stageConfigs?: StageConfig[];
  /** 入围赛轮空直接晋级的队伍 id（32 强签位中与 BYE 相邻的队伍）。 */
  qualifierByes?: string[];
}

export interface GroupQualifier {
  teamId: string;
  group: string;
  placement: 1 | 2;
}

export type StagedDrawGate =
  | { status: "ready"; stageIndex: number; stage: StageConfig; entrantIds: string[]; qualifiers?: GroupQualifier[] }
  | { status: "waiting"; stageIndex: number; stage: StageConfig; completedMatches: number; totalMatches: number; message: string }
  | { status: "blocked"; stageIndex: number; stage: StageConfig; message: string }
  | { status: "complete"; stageIndex: 3; message: string };

function stageMatches(matches: ScheduleMatch[], phase: string): ScheduleMatch[] {
  return matches.filter((match) => match.phase === phase);
}

function completedWinners(matches: ScheduleMatch[]): string[] {
  return matches
    .filter((match) => match.status === "已完成" && Boolean(match.winnerTeamId) && match.winnerTeamId !== "TBD")
    .map((match) => match.winnerTeamId as string);
}

export function extractGslQualifiers(matches: ScheduleMatch[], phase: string): GroupQualifier[] {
  const relevant = stageMatches(matches, phase);
  const qualifiers: GroupQualifier[] = [];
  for (const match of relevant) {
    if (match.status !== "已完成" || !match.winnerTeamId || match.winnerTeamId === "TBD") continue;
    const round = match.round ?? "";
    if (round.endsWith("胜者组出线战")) {
      qualifiers.push({ teamId: match.winnerTeamId, group: round.replace(/\s*胜者组出线战$/, ""), placement: 1 });
    }
    if (round.endsWith("最终出线战")) {
      qualifiers.push({ teamId: match.winnerTeamId, group: round.replace(/\s*最终出线战$/, ""), placement: 2 });
    }
  }
  return qualifiers.sort((a, b) => a.group.localeCompare(b.group, "zh-CN") || a.placement - b.placement);
}

/**
 * 32 → 16 → 8 的阶段门控。后续抽签只读取已完成比赛的真实晋级队伍，
 * 不会用 TBD 或报名名单提前生成未来阶段。
 */
export function resolveStagedDrawGate(
  stages: [StageConfig, StageConfig, StageConfig],
  frozenTeamIds: string[],
  matches: ScheduleMatch[],
  qualifierByes: string[] = [],
): StagedDrawGate {
  const [qualifierStage, groupStage, knockoutStage] = stages;
  const qualifierMatches = stageMatches(matches, qualifierStage.name);

  if (qualifierMatches.length === 0) {
    const realTeamCount = frozenTeamIds.length;
    if (realTeamCount < QUALIFIER_MIN_TEAMS || realTeamCount > qualifierStage.teamCount) {
      return {
        status: "blocked",
        stageIndex: 0,
        stage: qualifierStage,
        message: `入围赛需要 ${QUALIFIER_MIN_TEAMS} 到 ${qualifierStage.teamCount} 支已确认队伍，当前为 ${realTeamCount} 支。不足 ${QUALIFIER_MIN_TEAMS} 队请先调整赛制。`,
      };
    }
    return { status: "ready", stageIndex: 0, stage: qualifierStage, entrantIds: frozenTeamIds };
  }

  const expectedMatches = groupStage.teamCount - qualifierByes.length;
  if (qualifierMatches.length !== expectedMatches) {
    return { status: "blocked", stageIndex: 0, stage: qualifierStage, message: `入围赛应有 ${expectedMatches} 场，当前赛程为 ${qualifierMatches.length} 场，请先核对赛程。` };
  }
  const qualifierWinners = completedWinners(qualifierMatches);
  const qualifiedIds = [...qualifierWinners, ...qualifierByes];
  if (qualifiedIds.length < groupStage.teamCount) {
    return {
      status: "waiting",
      stageIndex: 0,
      stage: qualifierStage,
      completedMatches: qualifierWinners.length,
      totalMatches: expectedMatches,
      message: `完成全部 ${expectedMatches} 场入围赛并提交赛果后，才会开放小组赛抽签。`,
    };
  }
  if (new Set(qualifiedIds).size !== groupStage.teamCount) {
    return { status: "blocked", stageIndex: 1, stage: groupStage, message: "入围赛胜者数据存在重复或缺失，无法生成 16 支小组赛队伍。" };
  }

  const groupMatches = stageMatches(matches, groupStage.name);
  if (groupMatches.length === 0) {
    return { status: "ready", stageIndex: 1, stage: groupStage, entrantIds: qualifiedIds };
  }
  const groupExpected = (groupStage.groupCount ?? 4) * 5;
  if (groupMatches.length !== groupExpected) {
    return { status: "blocked", stageIndex: 1, stage: groupStage, message: `小组赛应有 ${groupExpected} 场，当前赛程为 ${groupMatches.length} 场，请先核对赛程。` };
  }
  const completedGroupMatches = groupMatches.filter((match) => match.status === "已完成").length;
  if (completedGroupMatches < groupExpected) {
    return {
      status: "waiting",
      stageIndex: 1,
      stage: groupStage,
      completedMatches: completedGroupMatches,
      totalMatches: groupExpected,
      message: `完成全部 ${groupExpected} 场小组赛并提交赛果后，才会开放淘汰赛抽签。`,
    };
  }

  const qualifiers = extractGslQualifiers(matches, groupStage.name);
  if (qualifiers.length !== knockoutStage.teamCount || new Set(qualifiers.map((item) => item.teamId)).size !== knockoutStage.teamCount) {
    return { status: "blocked", stageIndex: 2, stage: knockoutStage, message: "无法从小组赛结果中确认每组第一和第二，请核对胜者出线战与最终出线战赛果。" };
  }

  const knockoutMatches = stageMatches(matches, knockoutStage.name);
  if (knockoutMatches.length === 0) {
    return { status: "ready", stageIndex: 2, stage: knockoutStage, entrantIds: qualifiers.map((item) => item.teamId), qualifiers };
  }
  const knockoutExpected = knockoutStage.teamCount * 2 - 2;
  if (knockoutMatches.length !== knockoutExpected) {
    return { status: "blocked", stageIndex: 2, stage: knockoutStage, message: `淘汰赛应有 ${knockoutExpected} 场，当前赛程为 ${knockoutMatches.length} 场，请先核对赛程。` };
  }
  const completedKnockoutMatches = knockoutMatches.filter((match) => match.status === "已完成").length;
  if (completedKnockoutMatches < knockoutExpected) {
    return {
      status: "waiting",
      stageIndex: 2,
      stage: knockoutStage,
      completedMatches: completedKnockoutMatches,
      totalMatches: knockoutExpected,
      message: `淘汰赛已发布，当前完成 ${completedKnockoutMatches} / ${knockoutExpected} 场。`,
    };
  }
  return { status: "complete", stageIndex: 3, message: "三个阶段均已发布并完成。" };
}

function shuffled<T>(values: T[], random: () => number): T[] {
  const items = [...values];
  for (let index = items.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1));
    [items[index], items[target]] = [items[target], items[index]];
  }
  return items;
}

function permutations<T>(values: T[]): T[][] {
  if (values.length <= 1) return [values];
  return values.flatMap((value, index) =>
    permutations([...values.slice(0, index), ...values.slice(index + 1)]).map((rest) => [value, ...rest]),
  );
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
