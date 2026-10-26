import type { Group, SeedPot } from "@/lib/domains/registration/format";
import type { StageConfig } from "./format-templates.ts";
import type { ScheduleMatch } from "./schedule-data.ts";
import { QUALIFIER_MIN_TEAMS } from "./format-support.ts";

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
    return groups * (perGroup - 1 - (groupStage.groupFinalEnabled === false ? 1 : 0));
  }
  return groups * 5;
}

/** 小组赛晋级名单：两套小组赛制的名次判据不同，按阶段类型分流。 */
function extractGroupQualifiers(
  groupStage: StageConfig,
  matches: ScheduleMatch[],
  rankOf?: (teamId: string) => number,
): GroupQualifier[] {
  return groupStage.type === "single-elim-groups"
    ? extractGroupSingleElimQualifiers(matches, groupStage.name, rankOf)
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
  // 只在"多于"预期时报错；少于预期说明比赛被取消过，属合法运营动作（同 bracketDataIssue）。
  if (playInMatches.length > expected) {
    return {
      status: "blocked",
      stageIndex: 0,
      stage: playInStage,
      message: `${playInStage.name}最多 ${expected} 场，当前赛程为 ${playInMatches.length} 场，请先核对赛程。`,
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
      // 进度口径一律对照赛程里实际存在的场次，不用赛制预期（取消过某轮时两者不等）
      totalMatches: playInMatches.length,
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
export function extractGroupSingleElimQualifiers(
  matches: ScheduleMatch[],
  phase: string,
  /** 队伍平均段位（越高越强）。不传则不启用"无决赛"兜底。 */
  rankOf?: (teamId: string) => number,
): GroupQualifier[] {
  const qualifiers: GroupQualifier[] = [];
  const phaseMatches = stageMatches(matches, phase);
  const groupsWithFinal = new Set<string>();

  // 路径一（主）：有「X 组 决赛」就用它定第一第二
  for (const match of phaseMatches) {
    const round = match.round ?? "";
    // 优先用结构化字段判断；旧数据没有这两个字段时退回字符串匹配。
    // 字符串匹配的天生缺陷：「半决赛」也以「决赛」结尾，必须显式排掉；
    // 再加一个「季军决赛」就会被误认成小组决赛（2026-10-26 审查 P1-4）。
    const isFinal = match.roundStage ? match.roundStage === "final" : round.endsWith("决赛") && !round.endsWith("半决赛");
    if (!isFinal) continue;
    if (match.status !== "已完成" || !match.winnerTeamId || match.winnerTeamId === "TBD") continue;
    const group = match.roundGroup ?? round.replace(/\s*决赛$/, "").trim();
    groupsWithFinal.add(group);
    const loser = match.winnerTeamId === match.teamAId ? match.teamBId : match.teamAId;
    qualifiers.push({ teamId: match.winnerTeamId, group, placement: 1 });
    if (loser && loser !== "TBD") qualifiers.push({ teamId: loser, group, placement: 2 });
  }

  // 路径二（兜底）：取消组内决赛时，两场半决赛的**胜者**都进了"本该打的决赛"，
  // 谁是第一在结果里没有区分 —— 按负责人 2026-10-22 的决定用**平均段位**排序定名次。
  if (rankOf) {
    const semiByGroup = new Map<string, ScheduleMatch[]>();
    for (const match of phaseMatches) {
      const round = match.round ?? "";
      const isSemi = match.roundStage ? match.roundStage === "semi" : round.endsWith("半决赛");
      if (!isSemi) continue;
      const group = match.roundGroup ?? round.replace(/\s*半决赛$/, "").trim();
      if (groupsWithFinal.has(group)) continue; // 有决赛的组走路径一
      if (match.status !== "已完成" || !match.winnerTeamId || match.winnerTeamId === "TBD") continue;
      const list = semiByGroup.get(group) ?? [];
      list.push(match);
      semiByGroup.set(group, list);
    }
    for (const [group, semis] of semiByGroup) {
      const winners = semis.map((m) => m.winnerTeamId as string).filter((id) => id && id !== "TBD");
      if (winners.length === 0) continue;
      // 段位高者列前；同段位按 teamId 稳定排序，保证每次结果一致
      const ordered = [...winners].sort((x, y) => rankOf(y) - rankOf(x) || x.localeCompare(y));
      ordered.forEach((teamId, index) => {
        qualifiers.push({ teamId, group, placement: (index + 1) as 1 | 2 });
      });
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
  rankOf?: (teamId: string) => number,
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
  if (qualifierMatches.length > expectedMatches) {
    return { status: "blocked", stageIndex: 0, stage: qualifierStage, message: `入围赛最多 ${expectedMatches} 场，当前赛程为 ${qualifierMatches.length} 场，请先核对赛程。` };
  }
  const qualifierWinners = completedWinners(qualifierMatches);
  const qualifiedIds = [...qualifierWinners, ...qualifierByes];
  if (qualifiedIds.length < groupStage.teamCount) {
    return {
      status: "waiting",
      stageIndex: 0,
      stage: qualifierStage,
      completedMatches: qualifierWinners.length,
      totalMatches: qualifierMatches.length,
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
  if (groupMatches.length > groupExpected) {
    return { status: "blocked", stageIndex: 1, stage: groupStage, message: `小组赛最多 ${groupExpected} 场，当前赛程为 ${groupMatches.length} 场，请先核对赛程。` };
  }
  const completedGroupMatches = groupMatches.filter((match) => match.status === "已完成").length;
  // 判"是否打完"要对照**赛程里实际存在的场次**，不是赛制预期 ——
  // 取消过某轮时两者不等，拿预期去比会永远停在"还没打完"。
  if (completedGroupMatches < groupMatches.length) {
    return {
      status: "waiting",
      stageIndex: 1,
      stage: groupStage,
      completedMatches: completedGroupMatches,
      totalMatches: groupMatches.length,
      message: `完成全部 ${groupExpected} 场小组赛并提交赛果后，才会开放淘汰赛抽签。`,
    };
  }

  const qualifiers = extractGroupQualifiers(groupStage, matches, rankOf);
  if (qualifiers.length !== knockoutStage.teamCount || new Set(qualifiers.map((item) => item.teamId)).size !== knockoutStage.teamCount) {
    return { status: "blocked", stageIndex: 2, stage: knockoutStage, message: "无法从小组赛结果中确认每组第一和第二，请核对胜者出线战与最终出线战赛果。" };
  }

  const knockoutMatches = stageMatches(matches, knockoutStage.name);
  if (knockoutMatches.length === 0) {
    return { status: "ready", stageIndex: 2, stage: knockoutStage, entrantIds: qualifiers.map((item) => item.teamId), qualifiers };
  }
  const knockoutExpected = knockoutStage.teamCount * 2 - 2;
  // 同小组赛：只在"多于"预期时报错，少于视为取消过某场（弃权/免赛）。
  if (knockoutMatches.length > knockoutExpected) {
    return { status: "blocked", stageIndex: 2, stage: knockoutStage, message: `淘汰赛最多 ${knockoutExpected} 场，当前赛程为 ${knockoutMatches.length} 场，请先核对赛程。` };
  }
  const completedKnockoutMatches = knockoutMatches.filter((match) => match.status === "已完成").length;
  // 判"是否打完"对照**赛程里实际存在的场次**（同小组赛，取消过某轮时两者不等）。
  if (completedKnockoutMatches < knockoutMatches.length) {
    return {
      status: "waiting",
      stageIndex: 2,
      stage: knockoutStage,
      completedMatches: completedKnockoutMatches,
      totalMatches: knockoutMatches.length,
      message: `淘汰赛已发布，当前完成 ${completedKnockoutMatches} / ${knockoutExpected} 场。`,
    };
  }
  // 不写死「三个阶段」：这个函数既服务三阶段赛制、也服务四阶段（资格赛 + 这三段），
  // 在四阶段赛事里说「三个阶段均已发布」会和进度条上的四段对不上。
  return { status: "complete", stageIndex: 3, message: "全部阶段均已发布并完成。" };
}

import { buildKnockoutDrawOrder, buildQualifierSlots, nextMatchStartIndex, permutations, shuffled, withPendingSlots, autoFillPendingSlots } from "@/lib/domains/schedule/staged-format-draw";

// 保持对外的导出面不变：这些函数此前从本模块导出。
export { autoFillPendingSlots, buildKnockoutDrawOrder, buildQualifierSlots, nextMatchStartIndex, permutations, shuffled, withPendingSlots };
