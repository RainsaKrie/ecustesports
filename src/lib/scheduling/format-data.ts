// =====================
// 赛制与抽签核心逻辑（种子分档 → 分组抽签 → 对阵生成）
// =====================

import type { RegistrationPlayer, RegistrationTeam } from "./registration-data";

/** 段位数值映射（用于计算队伍平均段位） */
export const RANK_VALUE: Record<string, number> = {
  铁: 1,
  青铜: 2,
  白银: 3,
  黄金: 4,
  铂金: 5,
  钻石: 6,
  超凡: 7,
  神话: 8,
  无畏战魂: 9,
};

export interface SeedPot {
  name: string; // "一号种子池"
  teamIds: string[];
}

export interface Group {
  name: string; // "A 组"
  teamIds: string[];
}

export interface Matchup {
  teamAId: string;
  teamBId: string;
  group?: string;
}

/** 计算队伍平均段位（首发成员段位均值，未填段位按 0 处理） */
export function teamAvgRank(team: RegistrationTeam, players: RegistrationPlayer[]): number {
  const starters = team.memberIds
    .map((id) => players.find((p) => p.id === id))
    .filter((p): p is RegistrationPlayer => p !== undefined && p.role === "首发");
  const values = starters.map((p) => RANK_VALUE[p.rank] ?? 0).filter((v) => v > 0);
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** 按平均段位降序分 4 个种子池（每池 4 队）；队伍数不为 16 时返回空池 */
export function buildSeedPots(teams: RegistrationTeam[], players: RegistrationPlayer[]): SeedPot[] {
  if (teams.length !== 16) return [];

  const ranked = teams
    .map((t) => ({ id: t.id, avg: teamAvgRank(t, players) }))
    .sort((a, b) => b.avg - a.avg);

  const pots: SeedPot[] = ["一号种子池", "二号种子池", "三号种子池", "四号种子池"].map((name) => ({
    name,
    teamIds: [] as string[],
  }));

  ranked.forEach((item, index) => {
    const potIndex = Math.min(Math.floor(index / 4), 3);
    pots[potIndex].teamIds.push(item.id);
  });

  return pots;
}

/** 抽签：4 个组，每组从每个种子池各抽 1 队 */
export function drawGroups(seedPots: SeedPot[]): Group[] {
  const shuffledPots = seedPots.map((pot) => shuffle([...pot.teamIds]));
  const groupNames = ["A 组", "B 组", "C 组", "D 组"];
  return groupNames.map((name, groupIndex) => ({
    name,
    teamIds: shuffledPots.map((pot) => pot[groupIndex]).filter((id): id is string => id !== undefined),
  }));
}

/** 小组赛首轮对阵：每组内 1 号池对 4 号池、2 号池对 3 号池 */
export function generateMatchups(groups: Group[], seedPots: SeedPot[]): Matchup[] {
  const matchups: Matchup[] = [];
  groups.forEach((group) => {
    const teamPot = (teamId: string) => seedPots.findIndex((pot) => pot.teamIds.includes(teamId));
    const members = [...group.teamIds].sort((a, b) => teamPot(a) - teamPot(b));
    // members[0]=1号池, members[1]=2号池, members[2]=3号池, members[3]=4号池
    if (members.length >= 4) {
      matchups.push({ teamAId: members[0], teamBId: members[3], group: group.name });
      matchups.push({ teamAId: members[1], teamBId: members[2], group: group.name });
    }
  });
  return matchups;
}

/** 按平均段位降序排列（强 → 弱）。用于资格赛挑出最弱的队伍。 */
export function rankTeamsByAvgRank(
  teams: RegistrationTeam[],
  players: RegistrationPlayer[],
): Array<{ id: string; avg: number }> {
  return teams
    .map((team) => ({ id: team.id, avg: teamAvgRank(team, players) }))
    .sort((a, b) => b.avg - a.avg);
}

/**
 * 资格赛配对：**同档互打**。
 *
 * 传入已按段位降序排列的资格赛队伍（强 → 弱），每 4 支为一档，
 * 档内按「第 1 对第 4、第 2 对第 3」配对（与小组赛首轮同一条规则）。
 *
 * 目的：让资格赛内部是相近水平互打，且**最弱那一档里必然有队伍能赢**——
 * 若改用「保护靠前」（第 1 对第 8、第 2 对第 7），最弱的几支会全数出局，
 * 与「让低段位队伍不被打爆、能打上比赛」的目标相反。
 */
export function buildPlayInPairs(orderedTeamIds: string[]): Matchup[] {
  const pairs: Matchup[] = [];
  for (let blockStart = 0; blockStart + 3 < orderedTeamIds.length; blockStart += 4) {
    const block = orderedTeamIds.slice(blockStart, blockStart + 4);
    pairs.push({ teamAId: block[0], teamBId: block[3] });
    pairs.push({ teamAId: block[1], teamBId: block[2] });
  }
  return pairs;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
