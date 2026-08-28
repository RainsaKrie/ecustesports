// =====================
// 可执行赛制拓扑（纯函数，可测试）
// 当前落地三种结构：单败、8 队双败、16 队 GSL + 8 队双败。
// =====================

import type { Group, Matchup } from "./format-data";
import type { ScheduleMatch } from "./schedule-data";

/** 待定占位（晋级推进后由真实队伍填充） */
export const TBD = "TBD";

interface Slot {
  id: string;
  side: "A" | "B";
}

interface MatchFactoryOptions {
  startIndex?: number;
  phase: string;
  boType: ScheduleMatch["boType"];
}

function slot(id: string, side: "A" | "B"): Slot {
  return { id, side };
}

function matchId(index: number): string {
  return `M${String(index).padStart(2, "0")}`;
}

function createMatch(
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

function isPowerOfTwo(value: number): boolean {
  return value >= 2 && (value & (value - 1)) === 0;
}

function singleEliminationRoundName(entrants: number, roundIndex: number): string {
  if (entrants === 2) return "决赛";
  if (entrants === 4) return "半决赛";
  if (entrants === 8) return "四分之一决赛";
  return `第 ${roundIndex + 1} 轮`;
}

/** 生成完整单败结构；例如 4 队 = 2 场半决赛 + 1 场决赛。 */
export function buildSingleEliminationMatches(
  teamIds: string[],
  teamName: (id: string) => string,
  options: MatchFactoryOptions,
): ScheduleMatch[] {
  if (!isPowerOfTwo(teamIds.length)) {
    throw new Error("单败淘汰目前要求队伍数为 2 的幂（如 4、8、16、32）。");
  }

  const matches: ScheduleMatch[] = [];
  let nextIndex = options.startIndex ?? 1;
  let entrants = teamIds.length;
  let roundIndex = 0;
  let previousRound: ScheduleMatch[] = [];

  while (entrants >= 2) {
    const currentRound: ScheduleMatch[] = [];
    const roundName = singleEliminationRoundName(entrants, roundIndex);
    for (let index = 0; index < entrants / 2; index++) {
      const extra: Partial<ScheduleMatch> = {};
      if (roundIndex === 0) {
        const teamAId = teamIds[index * 2];
        const teamBId = teamIds[index * 2 + 1];
        Object.assign(extra, {
          teamAId,
          teamBId,
          teamAName: teamName(teamAId),
          teamBName: teamName(teamBId),
        });
      } else {
        extra.prerequisiteId = previousRound[index * 2]?.id;
      }
      currentRound.push(createMatch(matchId(nextIndex++), options.phase, roundName, options.boType, extra));
    }

    previousRound.forEach((previous, index) => {
      previous.nextMatchId = currentRound[Math.floor(index / 2)].id;
      previous.nextSide = index % 2 === 0 ? "A" : "B";
    });

    matches.push(...currentRound);
    previousRound = currentRound;
    entrants /= 2;
    roundIndex++;
  }

  return matches;
}

/** 只生成一轮淘汰赛；用于 32 队入围赛淘汰至 16 队，不提前生成后续阶段。 */
export function buildQualificationMatches(
  teamIds: string[],
  teamName: (id: string) => string,
  options: MatchFactoryOptions & { advancingTeams: number },
): ScheduleMatch[] {
  if (teamIds.length !== options.advancingTeams * 2) {
    throw new Error(`入围赛要求参赛队伍数正好是晋级名额的两倍，当前为 ${teamIds.length} → ${options.advancingTeams}。`);
  }
  const start = options.startIndex ?? 1;
  return Array.from({ length: options.advancingTeams }, (_, index) => {
    const teamAId = teamIds[index * 2];
    const teamBId = teamIds[index * 2 + 1];
    return createMatch(matchId(start + index), options.phase, "入围赛", options.boType, {
      teamAId,
      teamBId,
      teamAName: teamName(teamAId),
      teamBName: teamName(teamBId),
    });
  });
}

/** 生成 8 队双败（14 场、总决赛不重置）。 */
export function buildDoubleEliminationMatches(
  teamIds: string[],
  teamName: (id: string) => string,
  options: MatchFactoryOptions,
): ScheduleMatch[] {
  if (teamIds.length !== 8) {
    throw new Error("双败淘汰当前先支持 8 支队伍。");
  }

  const start = options.startIndex ?? 1;
  const ids = Array.from({ length: 14 }, (_, index) => matchId(start + index));
  const [W1A, W1B, W1C, W1D, W2A, W2B, L1A, L1B, L2A, L2B, WF, L3, LF, GF] = ids;
  const definitions: Array<[string, string, ScheduleMatch["boType"]]> = [
    [W1A, "胜者组第一轮", options.boType],
    [W1B, "胜者组第一轮", options.boType],
    [W1C, "胜者组第一轮", options.boType],
    [W1D, "胜者组第一轮", options.boType],
    [W2A, "胜者组半决赛", options.boType],
    [W2B, "胜者组半决赛", options.boType],
    [L1A, "败者组第一轮", options.boType],
    [L1B, "败者组第一轮", options.boType],
    [L2A, "败者组第二轮", options.boType],
    [L2B, "败者组第二轮", options.boType],
    [WF, "胜者组决赛", options.boType],
    [L3, "败者组第三轮", options.boType],
    [LF, "败者组决赛", "BO5"],
    [GF, "总决赛", "BO5"],
  ];
  const matches = definitions.map(([id, round, boType]) =>
    createMatch(id, options.phase, round, boType),
  );
  const byId = new Map(matches.map((match) => [match.id, match]));

  [W1A, W1B, W1C, W1D].forEach((id, index) => {
    const match = byId.get(id)!;
    const teamAId = teamIds[index * 2];
    const teamBId = teamIds[index * 2 + 1];
    match.teamAId = teamAId;
    match.teamBId = teamBId;
    match.teamAName = teamName(teamAId);
    match.teamBName = teamName(teamBId);
  });

  const connect = (fromId: string, winner: Slot, loser?: Slot) => {
    const match = byId.get(fromId)!;
    match.nextMatchId = winner.id;
    match.nextSide = winner.side;
    if (loser) {
      match.nextLoserMatchId = loser.id;
      match.nextLoserSide = loser.side;
    }
  };

  connect(W1A, slot(W2A, "A"), slot(L1A, "A"));
  connect(W1B, slot(W2A, "B"), slot(L1A, "B"));
  connect(W1C, slot(W2B, "A"), slot(L1B, "A"));
  connect(W1D, slot(W2B, "B"), slot(L1B, "B"));
  connect(W2A, slot(WF, "A"), slot(L2A, "A"));
  connect(W2B, slot(WF, "B"), slot(L2B, "A"));
  connect(L1A, slot(L2A, "B"));
  connect(L1B, slot(L2B, "B"));
  connect(L2A, slot(L3, "A"));
  connect(L2B, slot(L3, "B"));
  connect(WF, slot(GF, "A"), slot(LF, "B"));
  connect(L3, slot(LF, "A"));
  connect(LF, slot(GF, "B"));

  byId.get(W2A)!.prerequisiteId = W1A;
  byId.get(W2B)!.prerequisiteId = W1C;
  byId.get(L1A)!.prerequisiteId = W1A;
  byId.get(L1B)!.prerequisiteId = W1C;
  byId.get(L2A)!.prerequisiteId = W2A;
  byId.get(L2B)!.prerequisiteId = W2B;
  byId.get(WF)!.prerequisiteId = W2A;
  byId.get(L3)!.prerequisiteId = L2A;
  byId.get(LF)!.prerequisiteId = L3;
  byId.get(GF)!.prerequisiteId = WF;

  return matches;
}

/** 生成独立 16 队 GSL 小组赛（20 场），不提前连接尚未抽签的淘汰赛。 */
export function buildGslGroupMatches(
  groups: Group[],
  matchups: Matchup[],
  teamName: (id: string) => string,
  options: { startIndex?: number; phase?: string; boType?: ScheduleMatch["boType"] } = {},
): ScheduleMatch[] {
  if (groups.length !== 4 || groups.some((group) => group.teamIds.length !== 4) || matchups.length !== 8) {
    throw new Error("GSL 抽签需要 4 个小组、每组 4 队和 8 场揭幕战对阵。");
  }

  const start = options.startIndex ?? 1;
  const idAt = (offset: number) => matchId(start + offset);
  const phase = options.phase ?? "小组赛";
  const boType = options.boType ?? "BO3";
  const matches: ScheduleMatch[] = [];
  const add = (match: ScheduleMatch) => {
    matches.push(match);
  };

  matchups.forEach((matchup, index) => {
    const groupIndex = Math.floor(index / 2);
    add(createMatch(idAt(index), phase, `${matchup.group} 揭幕战`, boType, {
      teamAId: matchup.teamAId,
      teamBId: matchup.teamBId,
      teamAName: teamName(matchup.teamAId),
      teamBName: teamName(matchup.teamBId),
      nextMatchId: idAt(8 + groupIndex),
      nextSide: index % 2 === 0 ? "A" : "B",
      nextLoserMatchId: idAt(12 + groupIndex),
      nextLoserSide: index % 2 === 0 ? "A" : "B",
    }));
  });

  groups.forEach((group, groupIndex) => {
    const openerA = idAt(groupIndex * 2);
    const winners = idAt(8 + groupIndex);
    const elimination = idAt(12 + groupIndex);
    const decider = idAt(16 + groupIndex);
    add(createMatch(winners, phase, `${group.name} 胜者组出线战`, boType, {
      prerequisiteId: openerA,
      nextLoserMatchId: decider,
      nextLoserSide: "A",
    }));
    add(createMatch(elimination, phase, `${group.name} 败者组淘汰战`, boType, {
      prerequisiteId: openerA,
      nextMatchId: decider,
      nextSide: "B",
    }));
    add(createMatch(decider, phase, `${group.name} 最终出线战`, boType, {
      prerequisiteId: winners,
    }));
  });

  return matches;
}

/** 兼容 16 队赛事：一次生成 GSL（20 场）+ 8 队双败（14 场）= 34 场。 */
export function buildTournamentMatches(
  groups: Group[],
  matchups: Matchup[],
  teamName: (id: string) => string,
  options: { groupBoType?: ScheduleMatch["boType"]; knockoutBoType?: ScheduleMatch["boType"] } = {},
): ScheduleMatch[] {
  const matches = buildGslGroupMatches(groups, matchups, teamName, { boType: options.groupBoType });
  const byId = new Map(matches.map((match) => [match.id, match]));
  const add = (match: ScheduleMatch) => {
    matches.push(match);
    byId.set(match.id, match);
  };

  buildDoubleEliminationMatches(
    Array.from({ length: 8 }, () => TBD),
    () => "待定",
    { startIndex: 21, phase: "淘汰赛", boType: options.knockoutBoType ?? "BO3" },
  ).forEach(add);

  const W1A = "M21", W1B = "M22", W1C = "M23", W1D = "M24";
  const groupExit: Array<{ winnerMatchId: string; deciderMatchId: string; winner: Slot; runnerUp: Slot }> = [
    { winnerMatchId: "M09", deciderMatchId: "M17", winner: slot(W1A, "A"), runnerUp: slot(W1C, "B") },
    { winnerMatchId: "M10", deciderMatchId: "M18", winner: slot(W1B, "A"), runnerUp: slot(W1D, "B") },
    { winnerMatchId: "M11", deciderMatchId: "M19", winner: slot(W1C, "A"), runnerUp: slot(W1A, "B") },
    { winnerMatchId: "M12", deciderMatchId: "M20", winner: slot(W1D, "A"), runnerUp: slot(W1B, "B") },
  ];
  groupExit.forEach(({ winnerMatchId, deciderMatchId, winner, runnerUp }) => {
    const winnerMatch = byId.get(winnerMatchId)!;
    winnerMatch.nextMatchId = winner.id;
    winnerMatch.nextSide = winner.side;
    const deciderMatch = byId.get(deciderMatchId)!;
    deciderMatch.nextMatchId = runnerUp.id;
    deciderMatch.nextSide = runnerUp.side;
  });

  byId.get(W1A)!.prerequisiteId = "M09";
  byId.get(W1B)!.prerequisiteId = "M10";
  byId.get(W1C)!.prerequisiteId = "M11";
  byId.get(W1D)!.prerequisiteId = "M12";

  return matches;
}

/** 无后续晋级的决赛，胜者即冠军。 */
export function isChampionMatch(match: ScheduleMatch): boolean {
  return match.round === "总决赛" || match.round === "决赛";
}
