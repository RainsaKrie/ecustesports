import { EsportEvent, Team, Match, Player, BPSession } from "@/types";
import { VALORANT_MAPS, DEFAULT_BP_ORDER } from "./maps";

// =====================
// 选手 Mock 数据
// =====================
const PLAYER_NAMES = [
  "Shadow", "Riot", "Phoenix", "Sage", "Jett", "Reyna", "Omen", "Cypher",
  "Sova", "Killjoy", "Breach", "Brimstone", "Viper", "Astra", "KAYO", "Chamber",
  "Neon", "Fade", "Harbor", "Gekko", "Deadlock", "Iso", "Clove", "Vyse",
  "Tejo", "Waylay", "Kamikaze", "Sniper", "Blaze", "Frost", "Storm", "Thunder",
  "Lightning", "Tornado", "Earthquake", "Volcano", "Tsunami", "Avalanche",
  "Mirage", "Specter", "Phantom", "Ghost", "Wraith", "Ninja", "Samurai",
  "Ronin", "Shogun", "Dragon", "Tiger", "Crane", "Mantis", "Scorpion",
  "Viper2", "Falcon", "Eagle", "Hawk", "Wolf", "Bear", "Lion", "Panther",
];

const TEAM_NAMES = [
  "星辰电竞", "暗影战队", "烈焰先锋", "寒冰之刃", "雷霆万钧", "风暴联盟", "极光战队", "深渊之怒",
  "幻影骑士", "铁血战狼", "破晓之光", "暗夜行者", "炽热灵魂", "冰封王座", "苍穹之翼", "虚空使者",
  "烈日骄阳", "月光骑士", "星辰大海", "暗影迷宫", "火焰山", "冰晶宫殿", "风暴中心", "深渊裂谷",
  "幻影走廊", "铁壁防线", "破军星", "暗月宫殿", "炽天使", "冰霜巨龙", "苍狼传说", "虚空之眼",
];

const LOGO_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16", "#22c55e", "#10b981",
  "#14b8a6", "#06b6d4", "#0ea5e9", "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7",
  "#d946ef", "#ec4899", "#f43f5e", "#64748b", "#94a3b8", "#cbd5e1",
];

// 生成 32 支队伍
function generateTeams(): Team[] {
  const teams: Team[] = [];
  let playerIndex = 0;

  for (let i = 0; i < 32; i++) {
    const teamId = `team-${i + 1}`;
    const playerIds: string[] = [];

    for (let j = 0; j < 5; j++) {
      playerIds.push(`player-${playerIndex + 1}`);
      playerIndex++;
    }

    teams.push({
      id: teamId,
      name: TEAM_NAMES[i],
      seed: i + 1,
      captainId: playerIds[0],
      playerIds,
      status: "approved",
      registeredAt: `2026-07-0${(i % 9) + 1}T10:00:00Z`,
      logoColor: LOGO_COLORS[i % LOGO_COLORS.length],
    });
  }
  return teams;
}

// 生成选手
function generatePlayers(): Player[] {
  const players: Player[] = [];
  for (let i = 0; i < 160; i++) {
    const teamIndex = Math.floor(i / 5);
    players.push({
      id: `player-${i + 1}`,
      nickname: PLAYER_NAMES[i % PLAYER_NAMES.length] + (i >= PLAYER_NAMES.length ? Math.floor(i / PLAYER_NAMES.length) : ""),
      gameId: `gameId_${i + 1}`,
      qq: `10000${i + 1}`,
      teamId: `team-${teamIndex + 1}`,
      registeredAt: `2026-07-0${(teamIndex % 9) + 1}T10:00:00Z`,
    });
  }
  return players;
}

// 生成单败淘汰赛对阵
function generateBracket(teamCount: number): Match[] {
  const matches: Match[] = [];
  const totalRounds = Math.log2(teamCount);

  for (let round = 1; round <= totalRounds; round++) {
    const matchCount = teamCount / Math.pow(2, round);

    for (let i = 0; i < matchCount; i++) {
      const matchId = `match-r${round}-m${i + 1}`;
      let teamAId: string | undefined;
      let teamBId: string | undefined;
      let scoreA: number | null = null;
      let scoreB: number | null = null;
      let winnerId: string | undefined;
      let status: Match["status"] = "pending";

      // Round 1: 分配队伍
      if (round === 1) {
        teamAId = `team-${i * 2 + 1}`;
        teamBId = `team-${i * 2 + 2}`;
        status = "completed";

        // 模拟比分（BO1）
        const scoreAMock = Math.floor(Math.random() * 13) + 4;
        const scoreBMock = Math.floor(Math.random() * 13) + 4;
        scoreA = Math.max(scoreAMock, scoreBMock);
        scoreB = Math.min(scoreAMock, scoreBMock);
        // 确保有一方达到 13
        if (scoreA < 13) scoreA = 13;
        winnerId = scoreA > scoreB ? teamAId : teamBId;
      }

      // Round 2: 部分完成
      if (round === 2 && i < 4) {
        teamAId = `team-${i * 4 + 1}`;
        teamBId = `team-${i * 4 + 3}`;
        status = "completed";
        scoreA = 13;
        scoreB = Math.floor(Math.random() * 11) + 2;
        winnerId = scoreA > scoreB ? teamAId : teamBId;
      } else if (round === 2 && i >= 4) {
        teamAId = `team-${i * 4 + 1}`;
        teamBId = `team-${i * 4 + 3}`;
        status = "ready";
      }

      // Round 3+: 等待
      if (round >= 3) {
        status = "pending";
      }

      matches.push({
        id: matchId,
        round,
        matchIndex: i + 1,
        teamAId,
        teamBId,
        scoreA,
        scoreB,
        winnerId,
        status,
        scheduledTime: round === 1 ? `2026-08-0${(i % 5) + 1}T14:00:00Z` : undefined,
      });
    }
  }

  return matches;
}

// =====================
// 导出 Mock 数据
// =====================

export const mockTeams = generateTeams();
export const mockPlayers = generatePlayers();
export const mockMatches = generateBracket(32);

export const mockEvent: EsportEvent = {
  id: "event-1",
  name: "第三届华理瓦理杯",
  game: "无畏契约",
  format: "multi-stage",
  status: "draft",
  teamCount: 32,
  teamSize: 5,
  description:
    "面向华东理工大学校内玩家的《无畏契约》赛事。叫上队友组成五人小队，从入围赛一路打进总决赛。报名时间、比赛日期和奖项将在确认后统一公布。",
  registrationStart: "2026-07-01T00:00:00Z",
  registrationEnd: "2026-07-20T23:59:59Z",
  eventStart: "2026-08-01T00:00:00Z",
  eventEnd: "2026-08-31T23:59:59Z",
  rules: `## 赛事规则

1. **参赛规模**：计划招募 32 支队伍，每队 5 名首发选手
2. **入围赛**：32 支队伍随机配对，进行单败淘汰 BO1，16 支队伍晋级
3. **小组赛**：16 支队伍分为 4 组，进行 GSL 双败赛，全部比赛为 BO3；每组两支队伍晋级
4. **淘汰赛**：8 支队伍进行双败淘汰；败者组决赛和总决赛为 BO5，其余比赛为 BO3
5. **地图与 BP**：地图池和具体 BP 顺序以报名开启前发布的参赛手册为准
6. **赛程与改期生效**：比赛时间以赛事平台最新公布的赛程为准；队伍协商改期后，须由赛事负责人确认并更新赛程
7. **比赛报到**：参赛队伍应按通知提前进入赛事群和指定房间，配合裁判完成地图 BP
8. **争议处理**：如遇迟到、掉线或比赛争议，请第一时间联系当值裁判，不要自行判定赛果`,
  prizePool: "奖项与奖品将在报名开启前公布",
  organizer: "华东理工大学电竞社",
  coverColor: "#ff4655",
  matches: mockMatches,
  teams: mockTeams,
};

// BP Mock 会话
export const mockBPSession: BPSession = {
  id: "bp-session-1",
  matchId: "match-r2-m5",
  eventId: "event-1",
  teamAId: "team-17",
  teamBId: "team-19",
  banPickOrder: DEFAULT_BP_ORDER,
  actions: [
    { id: "bp-1", action: "ban", teamId: "team-17", mapId: "bind", timestamp: "2026-08-06T14:00:00Z" },
    { id: "bp-2", action: "ban", teamId: "team-19", mapId: "haven", timestamp: "2026-08-06T14:00:30Z" },
    { id: "bp-3", action: "ban", teamId: "team-17", mapId: "split", timestamp: "2026-08-06T14:01:00Z" },
  ],
  currentStep: 3,
  status: "in-progress",
  mapPool: VALORANT_MAPS,
};

// 根据 ID 查找队伍
export function getTeamById(teamId: string | undefined, teams: Team[] = mockTeams): Team | undefined {
  if (!teamId) return undefined;
  return teams.find((t) => t.id === teamId);
}

// 根据轮次获取比赛
export function getMatchesByRound(matches: Match[], round: number): Match[] {
  return matches.filter((m) => m.round === round).sort((a, b) => a.matchIndex - b.matchIndex);
}
