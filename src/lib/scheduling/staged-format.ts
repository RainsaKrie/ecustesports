import type { Group, SeedPot } from "./format-data";
import type { StageConfig } from "./format-templates";
import type { ScheduleMatch } from "./schedule-data";
import { QUALIFIER_MIN_TEAMS } from "./format-support";
import { BYE, PENDING } from "./bracket-engine";

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
  /**
   * 资格赛抽签结果（仅四阶段赛制使用）。
   *
   * 独立于 stageDraws：四阶段赛制里「入围赛/小组赛/淘汰赛」沿用 stageIndex 0/1/2，
   * 与既有三阶段语义完全一致，不必为资格赛腾序号。
   */
  playInDraw?: {
    drawOrder: string[];
    publishedAt?: string;
  };
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

/**
 * 小组赛阶段应有的总场次数。
 * GSL：每组 5 场（4 队组）；**组内单败**：每组 `组内队数 − 1` 场（4 队组 = 3 场）。
 * 两个数字差 8 场，写死任一个都会让另一套赛制的门控永远判「场次不对」。
 */
function groupStageExpectedMatches(groupStage: StageConfig): number {
  const groups = groupStage.groupCount ?? 4;
  if (groupStage.type === "single-elim-groups") {
    const perGroup = Math.max(2, Math.floor(groupStage.teamCount / groups));
    return groups * (perGroup - 1);
  }
  return groups * 5;
}

/** 小组赛晋级名单：两套小组赛制的名次判据不同，按阶段类型分流。 */
function extractGroupQualifiers(groupStage: StageConfig, matches: ScheduleMatch[]): GroupQualifier[] {
  return groupStage.type === "single-elim-groups"
    ? extractGroupSingleElimQualifiers(matches, groupStage.name)
    : extractGslQualifiers(matches, groupStage.name);
}

function completedWinners(matches: ScheduleMatch[]): string[] {
  return matches
    .filter((match) => match.status === "已完成" && Boolean(match.winnerTeamId) && match.winnerTeamId !== "TBD")
    .map((match) => match.winnerTeamId as string);
}

/**
 * 资格赛门控结果。字段形状与 StagedDrawGate 对齐（含 stageIndex / message），
 * 便于抽签界面共用同一套渲染分支。
 */
export type PlayInGate =
  | { status: "ready"; stageIndex: 0; stage: StageConfig; entrantIds: string[] }
  /**
   * 资格赛已开打、但还没全部结束。
   *
   * 允许**先把入围赛抽了**：已决出的胜者先进签位，剩余席位留成待定（PENDING），
   * 等资格赛补齐再填人。这样不必为了等某一场的结果，把整个入围赛的赛程拖住。
   *
   * 用 `pendingCount` 明确告诉调用方要留几个待定席位 —— 不要让它自己去减，
   * 减错了会变成轮空（语义完全不同：轮空是不打，待定是要打）。
   */
  | { status: "partial"; stageIndex: 0; stage: StageConfig; advancingTeamIds: string[]; pendingCount: number; completedMatches: number; totalMatches: number; message: string }
  | { status: "blocked"; stageIndex: 0; stage: StageConfig; message: string }
  | { status: "complete"; stageIndex: 0; stage: StageConfig; message: string; advancingTeamIds: string[] };

/**
 * 资格赛门控（并入型阶段）。
 *
 * 用于队伍数超过入围赛席位的情况：先让最弱的一批打一轮资格赛，
 * 胜者并入入围赛，把队伍数收敛到入围赛容量（如 36 → 32）。
 *
 * **资格赛仍然独立成阶段**（D-054：每个阶段只在前一阶段赛果全部确认后解锁），
 * 但**不再要求它全部打完才能抽入围赛**：未决出的席位返回 `partial`，
 * 由调用方留成待定（PENDING）占位，等资格赛补齐再填人。
 * 这样「还剩一场没打」不会把整个入围赛的赛程拖住。
 *
 * 资格赛队伍数恒为偶数，一半晋级。
 */
export function resolvePlayInGate(
  playInStage: StageConfig,
  playInTeamIds: string[],
  matches: ScheduleMatch[],
): PlayInGate {
  if (playInTeamIds.length !== playInStage.teamCount) {
    return {
      status: "blocked",
      stageIndex: 0,
      stage: playInStage,
      message: `${playInStage.name}需要 ${playInStage.teamCount} 支队伍，当前为 ${playInTeamIds.length} 支。`,
    };
  }
  const playInMatches = stageMatches(matches, playInStage.name);
  if (playInMatches.length === 0) {
    return { status: "ready", stageIndex: 0, stage: playInStage, entrantIds: playInTeamIds };
  }
  const expected = playInStage.teamCount / 2;
  if (playInMatches.length !== expected) {
    return {
      status: "blocked",
      stageIndex: 0,
      stage: playInStage,
      message: `${playInStage.name}应有 ${expected} 场，当前赛程为 ${playInMatches.length} 场，请先核对赛程。`,
    };
  }
  const winners = completedWinners(playInMatches);
  if (winners.length < expected) {
    // 已决出的先进入围赛，其余留成待定 —— 不因为「还剩一场」把整个赛程卡住。
    const pendingCount = expected - winners.length;
    return {
      status: "partial",
      stageIndex: 0,
      stage: playInStage,
      advancingTeamIds: winners,
      pendingCount,
      completedMatches: winners.length,
      totalMatches: expected,
      message: `${playInStage.name}已决出 ${winners.length} / ${expected} 席。可以先抽入围赛：已决出的先进签位，其余 ${pendingCount} 席留作待定，等资格赛结果出来后补齐。`,
    };
  }
  return {
    status: "complete",
    stageIndex: 0,
    stage: playInStage,
    message: `${playInStage.name}已完成，${winners.length} 支胜者并入入围赛。`,
    advancingTeamIds: winners,
  };
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
 * 从「组内单败」小组赛结果里取出每组前两名（2026-10-14 新增）。
 *
 * 约定与 `extractGslQualifiers` 对齐：**名次从轮次名认**，只是判据不同 ——
 * GSL 靠「胜者组出线战 / 最终出线战」，组内单败靠**组内决赛**：
 * 决赛胜者 = 该组第 1，决赛负者 = 该组第 2。
 *
 * ⚠️ 判据必须先排掉「半决赛」—— 「半决赛」也以「决赛」结尾，只判 `endsWith("决赛")`
 * 会把两场半决赛当成三个组的出线战（变异验证专门盯这一条）。
 */
export function extractGroupSingleElimQualifiers(matches: ScheduleMatch[], phase: string): GroupQualifier[] {
  const qualifiers: GroupQualifier[] = [];
  for (const match of stageMatches(matches, phase)) {
    const round = match.round ?? "";
    if (!round.endsWith("决赛") || round.endsWith("半决赛")) continue;
    if (match.status !== "已完成" || !match.winnerTeamId || match.winnerTeamId === "TBD") continue;
    const group = round.replace(/\s*决赛$/, "").trim();
    const loser = match.winnerTeamId === match.teamAId ? match.teamBId : match.teamAId;
    qualifiers.push({ teamId: match.winnerTeamId, group, placement: 1 });
    if (loser && loser !== "TBD") qualifiers.push({ teamId: loser, group, placement: 2 });
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
  const groupExpected = groupStageExpectedMatches(groupStage);
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

  const qualifiers = extractGroupQualifiers(groupStage, matches);
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
  // 不写死「三个阶段」：这个函数既服务三阶段赛制、也服务四阶段（资格赛 + 这三段），
  // 在四阶段赛事里说「三个阶段均已发布」会和进度条上的四段对不上。
  return { status: "complete", stageIndex: 3, message: "全部阶段均已发布并完成。" };
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
