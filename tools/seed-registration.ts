import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  type RegistrationPlayer,
  type RegistrationState,
  type RegistrationTeam,
} from "../src/lib/domains/registration/data";
import { getGameConfig } from "../src/lib/games";

/** 擅长位置取自游戏配置层（原来从 registration-data 导入，那份已并入 config）。 */
const GAME = getGameConfig();

const TEAM_NAMES = [
  "星火战队", "破晓战队", "赤霄战队", "凌云战队", "极光战队", "深渊战队", "疾风战队", "霜刃战队",
  "雷鸣战队", "烽火战队", "苍穹战队", "曙光战队", "逐浪战队", "玄武战队", "白泽战队", "龙渊战队",
  "燎原战队", "天际战队", "暗潮战队", "远征战队", "辉光战队", "星轨战队", "黑曜战队", "银翼战队",
  "烈焰战队", "寒锋战队", "追光战队", "云帆战队", "狂澜战队", "北辰战队", "南风战队", "长虹战队",
] as const;

/** 演示用段位：取段位阶梯最高的 4 档（高 → 低），同样取自游戏配置层。 */
const RANKS = [...GAME.ranks].reverse().slice(0, 4);

async function main() {
const eventId = process.argv[2]?.trim() ?? "";
const confirmed = process.argv.includes("--replace-one-player");

if (!/^event-[a-z0-9-]+$/i.test(eventId)) {
  throw new Error("请提供有效赛事 ID。");
}
if (!confirmed) {
  throw new Error("该操作会替换报名数据，必须显式传入 --replace-one-player。");
}

const eventDirectory = path.resolve(process.cwd(), "data", "events", eventId);
const target = path.join(eventDirectory, "registration.json");
const existing = JSON.parse(await readFile(target, "utf8")) as Partial<RegistrationState>;
if ((existing.players?.length ?? 0) !== 1 || (existing.teams?.length ?? 0) !== 0) {
  throw new Error(`安全检查失败：预期当前为 1 名选手、0 支队伍，实际为 ${existing.players?.length ?? 0} 名、${existing.teams?.length ?? 0} 支。`);
}

const createdAt = new Date().toISOString();
const players: RegistrationPlayer[] = [];
const teams: RegistrationTeam[] = [];

TEAM_NAMES.forEach((teamName, teamIndex) => {
  const teamNumber = String(teamIndex + 1).padStart(2, "0");
  const teamId = `T-SEED-${teamNumber}`;
  const memberIds: string[] = [];

  for (let memberIndex = 0; memberIndex < 5; memberIndex += 1) {
    const playerNumber = teamIndex * 5 + memberIndex + 1;
    const playerId = `P-SEED-${String(playerNumber).padStart(3, "0")}`;
    memberIds.push(playerId);
    players.push({
      id: playerId,
      name: `测试选手${String(playerNumber).padStart(3, "0")}`,
      studentId: `TEST2026${String(playerNumber).padStart(3, "0")}`,
      gameId: `ECUST${String(playerNumber).padStart(3, "0")}#${String(1000 + playerNumber).slice(-4)}`,
      rank: RANKS[Math.floor(teamIndex / 8)],
      qq: String(900000000 + playerNumber),
      phone: String(13800000000 + playerNumber),
      positions: [GAME.positions[memberIndex % GAME.positions.length]],
      submittedAt: createdAt,
      status: "已入队",
      reviewStatus: "已通过",
      teamId,
      role: "首发",
    });
  }

  teams.push({
    id: teamId,
    name: teamName,
    captainId: memberIds[0],
    memberIds,
    status: "已冻结",
    createdAt,
  });
});

const state: RegistrationState = {
  players,
  teams,
  teamRequests: [],
  operationLogs: [],
  playerRegistrationClosed: false,
  teamRegistrationClosed: false,
};

if (players.length !== 160 || teams.length !== 32) {
  throw new Error("测试数据数量校验失败。");
}
if (teams.some((team) => team.memberIds.length !== 5)) {
  throw new Error("队伍首发数量校验失败。");
}

await mkdir(eventDirectory, { recursive: true });
const temporary = `${target}.tmp`;
await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
await rename(temporary, target);

console.log(`已写入 ${eventId}：${players.length} 名选手、${teams.length} 支正式队伍；每队 5 名首发，替补与教练位置为空。`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "测试数据写入失败。");
  process.exitCode = 1;
});
