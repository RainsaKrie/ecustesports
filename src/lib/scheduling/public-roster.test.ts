// 公开名单可见性测试。
//
// 场景来自 2026-10-03：报名截止后线上是「36 支满编 + 6 支缺人」，
// 负责人要求公开页面「看起来只剩正式名单」，但数据一条都不能删。
//
// 关键不变式：
//   ① 未满编队伍在正式名单公布后不公开，但**仍留在原始数据里**（可撤销、可申诉）；
//   ② 报名/组队进行中必须照常公开非退赛队伍（否则玩家没法找队伍加入）；
//   ③ 组队刚截止、还没确认任何队伍时不能返回空名单。

import assert from "node:assert/strict";

import { isOfficialRosterPublished, selectPublicRoster } from "./public-roster";
import type { RegistrationPlayer, RegistrationTeam } from "./registration-data";

let passed = 0;
function check(name: string, condition: boolean, detail?: string) {
  assert.ok(condition, `${name}${detail ? ` —— ${detail}` : ""}`);
  passed += 1;
  console.log(`✓ ${name}`);
}

function player(id: string, teamId: string | undefined, role: RegistrationPlayer["role"] = "首发"): RegistrationPlayer {
  return {
    id,
    name: `选手${id}`,
    studentId: `2026${id}`,
    gameId: `Player-${id}`,
    rank: "钻石",
    submittedAt: "2026-09-03T00:00:00.000Z",
    status: teamId ? "已入队" : "已报名",
    reviewStatus: "已通过",
    teamId,
    role: teamId ? role : undefined,
  };
}

function team(id: string, name: string, status: RegistrationTeam["status"], memberIds: string[]): RegistrationTeam {
  return { id, name, captainId: memberIds[0] ?? "", memberIds, status, createdAt: "2026-09-03T00:00:00.000Z" };
}

// 两支满编正式队（各 5 首发 + 1 替补）、一支只有 3 人的未满编队、
// 两名还没组队的报名选手、一支已退赛队伍，以及一名已退赛选手。
const frozenA = [1, 2, 3, 4, 5].map((index) => player(`A${index}`, "T-1"));
const frozenB = [1, 2, 3, 4, 5].map((index) => player(`B${index}`, "T-2"));
const substitute = player("SUB", "T-2", "替补");
const partial = [1, 2, 3].map((index) => player(`C${index}`, "T-3"));
const waiting = [player("W1", undefined), player("W2", undefined)];
const withdrawnPlayer: RegistrationPlayer = { ...player("X1", undefined), status: "已退赛" };

const teams: RegistrationTeam[] = [
  team("T-1", "满编一队", "已冻结", frozenA.map((item) => item.id)),
  team("T-2", "满编二队", "已冻结", [...frozenB.map((item) => item.id), substitute.id]),
  team("T-3", "缺人队", "报名中", partial.map((item) => item.id)),
  team("T-4", "退赛队", "已退赛", []),
];
const players: RegistrationPlayer[] = [...frozenA, ...frozenB, substitute, ...partial, ...waiting, withdrawnPlayer];

// ── ① 组队申报进行中：非退赛队伍全部公开 ──
{
  const roster = selectPublicRoster({ teams, players, teamRegistrationClosed: false });
  check("组队申报进行中不进入正式名单模式", isOfficialRosterPublished({ teams, teamRegistrationClosed: false }) === false);
  check(
    "组队申报进行中，未满编队伍照常公开（玩家要靠它找队伍）",
    roster.teams.length === 3 && roster.teams.some((item) => item.id === "T-3"),
    roster.teams.map((item) => item.id).join(","),
  );
  check("组队申报进行中，未组队选手也公开", roster.players.some((item) => item.id === "W1"));
}

// ── ② 已退赛的队伍与选手，任何阶段都不公开 ──
{
  const roster = selectPublicRoster({ teams, players, teamRegistrationClosed: false });
  check(
    "已退赛队伍不公开",
    !roster.teams.some((item) => item.id === "T-4"),
    roster.teams.map((item) => item.id).join(","),
  );
  check("已退赛选手不公开", !roster.players.some((item) => item.id === "X1"));
}

// ── ③ 组队刚截止、还没有任何已冻结队伍：不能变成空名单 ──
{
  const openOnly = teams.map((item) => item.status === "已冻结" ? { ...item, status: "报名中" as const } : item);
  const roster = selectPublicRoster({ teams: openOnly, players, teamRegistrationClosed: true });
  check(
    "组队截止但尚未确认任何队伍时，退回显示全部（避免「暂无参赛队伍」）",
    roster.teams.length === 3,
    String(roster.teams.length),
  );
}

// ── ④ 正式名单公布后：只公开已冻结队伍及其成员 ──
{
  const roster = selectPublicRoster({ teams, players, teamRegistrationClosed: true });
  check("组队截止且已有正式队伍 → 进入正式名单模式", isOfficialRosterPublished({ teams, teamRegistrationClosed: true }) === true);
  check(
    "只公开已冻结队伍",
    roster.teams.length === 2 && roster.teams.every((item) => item.status === "已冻结"),
    roster.teams.map((item) => item.id).join(","),
  );
  check(
    "未满编队伍整队不再公开（含队名与队内成员）",
    !roster.teams.some((item) => item.id === "T-3") && !roster.players.some((item) => item.id.startsWith("C")),
  );
  check("未组队选手不再公开", !roster.players.some((item) => item.id === "W1" || item.id === "W2"));
  check(
    "正式队伍的替补也一并公开（不是只公开 5 名首发）",
    roster.players.some((item) => item.id === "SUB"),
  );
  check(
    "公开人数与队伍成员数一致（11 人 / 2 队）",
    roster.players.length === 11 && roster.teams.length === 2,
    `${roster.players.length} 人 / ${roster.teams.length} 队`,
  );
}

// ── ⑤ 数据一条未删：原始数组没被改动 ──
{
  const beforeTeams = JSON.stringify(teams);
  const beforePlayers = JSON.stringify(players);
  selectPublicRoster({ teams, players, teamRegistrationClosed: true });
  check("筛选不改动原始队伍数据（可撤销、可申诉）", JSON.stringify(teams) === beforeTeams);
  check("筛选不改动原始选手数据", JSON.stringify(players) === beforePlayers);
  check(
    "未满编队伍仍留在原始数据里",
    teams.some((item) => item.id === "T-3") && players.some((item) => item.id === "C1"),
  );
}

console.log(`\n${passed} 条断言全部通过`);
