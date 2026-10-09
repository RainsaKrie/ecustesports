// =====================
// 完整闭环测试：选手报名 → 组队 → 冻结 → 种子分档 → 抽签 → 对阵
// → 发布赛程 → 排期 → 报分 → 晋级（胜者/败者）→ 冠军
// 运行：npx tsx src/lib/scheduling/full-loop.test.ts
// =====================

import { normalizeRegistrationState, type RegistrationState, type RegistrationPlayer, type RegistrationTeam } from "./registration-data.ts";
import { createTeamOp, addMemberOp } from "./registration-ops.ts";
import { buildSeedPots, drawGroups, generateMatchups } from "./format-data.ts";
import {
  buildDoubleEliminationMatches,
  buildGslGroupMatches,
  buildQualificationMatches,
  buildSingleEliminationMatches,
  buildTournamentMatches,
  TBD,
} from "./bracket-engine.ts";
import type { ScheduleState, ScheduleMatch, GameResult } from "./schedule-data.ts";
import { emptySchedule, initialSchedule } from "./schedule-data.ts";
import {
  appendMatchesOp,
  archiveAndClearScheduleOp,
  importMatchesOp,
  submitRequestOp,
  submitCaptainRequestOp,
  resolveCaptainRequestOp,
  approveRequestOp,
  reportGameResultsOp,
  setMatchTimeOp,
  validateGames,
  maxGames,
  recentNotifications,
  RECENT_NOTIFICATION_LIMIT,
} from "./schedule-ops.ts";
import type { SchedulingConfig } from "./rule-engine.ts";
import { buildKnockoutDrawOrder, resolveStagedDrawGate } from "./staged-format.ts";
import { buildDefaultEventRules, resolveTemplateIdFromStages, type StageConfig } from "./format-templates.ts";
import { bracketDataIssue, buildBracketBlueprint } from "./bracket-blueprint.ts";

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? `（${detail}）` : ""}`);
  }
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function fmt(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

console.log("== 0. 新赛事模板与规程预填 ==");
{
  const eightTeamDouble: StageConfig[] = [
    { name: "淘汰赛", type: "double-elim", teamCount: 8, boType: "BO3" },
  ];
  check("8 队双败匹配正确模板", resolveTemplateIdFromStages(eightTeamDouble) === "val-8de");
  const rules = buildDefaultEventRules(eightTeamDouble, 5);
  check("规程同时包含赛制生成与通用继承", rules.some((rule) => rule.source === "format") && rules.some((rule) => rule.source === "common"));
  check("8 队双败不会错误出现小组赛条款", !rules.some((rule) => rule.title === "小组赛" || rule.detail.includes("GSL")));
  check("高风险处罚条款默认等待负责人确认", rules.filter((rule) => rule.emphasis === "warning").every((rule) => rule.confirmed === false));
  check("赛程改期规则使用办赛语言并归入通用规则", rules.some((rule) => rule.title === "赛程与改期生效" && rule.source === "common" && rule.detail.includes("赛事负责人确认")));
  const customPresetRules = buildDefaultEventRules(eightTeamDouble, 5, [
    { title: "校内通用纪律", detail: "适用于后续全部校内赛事。", category: "conduct", emphasis: "important" },
  ]);
  check("负责人维护的通用预设会被新赛事继承", customPresetRules.some((rule) => rule.title === "校内通用纪律" && rule.source === "common"));
}

// ---- 构造 16 支冻结队伍（每队 5 名首发，段位按池递减） ----
const RANKS = [["无畏战魂", "神话"], ["钻石", "超凡", "铂金"], ["黄金", "白银"], ["青铜", "铁"]];
function makeRegistration(teamCount = 16): RegistrationState {
  const players: RegistrationPlayer[] = [];
  const teams: RegistrationTeam[] = [];
  let seq = 0;
  for (let i = 0; i < teamCount; i++) {
    const potRanks = RANKS[Math.floor((i % 16) / 4)];
    const memberIds: string[] = [];
    for (let k = 0; k < 5; k++) {
      const id = `P-${seq++}`;
      players.push({
        id,
        name: `选手${seq}`,
        studentId: `2026${String(seq).padStart(4, "0")}`,
        gameId: `队${i + 1}-${k + 1}`,
        rank: potRanks[k % potRanks.length],
        submittedAt: new Date().toISOString(),
        status: "已入队",
        teamId: `T-${i}`,
        role: "首发",
      });
      memberIds.push(id);
    }
    teams.push({
      id: `T-${i}`,
      name: `测试队${i + 1}`,
      captainId: memberIds[0],
      memberIds,
      status: "已冻结",
      createdAt: new Date().toISOString(),
    });
  }
  return { players, teams, playerRegistrationClosed: true, teamRegistrationClosed: true, frozen: true };
}

console.log("== 1. 报名与组队（registration-ops） ==");
{
  const legacyClosed = normalizeRegistrationState({ players: [], teams: [], frozen: true });
  check("旧版 frozen 数据迁移为两个入口均截止", legacyClosed.playerRegistrationClosed && legacyClosed.teamRegistrationClosed);
  const splitClosed = normalizeRegistrationState({ players: [], teams: [], playerRegistrationClosed: false, teamRegistrationClosed: true, frozen: true });
  check("新版双截止状态不被旧 frozen 字段覆盖", !splitClosed.playerRegistrationClosed && splitClosed.teamRegistrationClosed);
  const empty: RegistrationState = { players: [], teams: [], playerRegistrationClosed: false, teamRegistrationClosed: false, frozen: false };
  const p1: RegistrationPlayer = { id: "p1", name: "甲", studentId: "1", gameId: "g1", rank: "黄金", submittedAt: "", status: "已报名" };
  const p2: RegistrationPlayer = { ...p1, id: "p2", name: "乙" };
  const p3: RegistrationPlayer = { ...p1, id: "p3", name: "丙" };
  const p4: RegistrationPlayer = { ...p1, id: "p4", name: "丁" };
  const p5: RegistrationPlayer = { ...p1, id: "p5", name: "戊" };
  const p6: RegistrationPlayer = { ...p1, id: "p6", name: "己" };
  let s: RegistrationState = { ...empty, players: [p1, p2, p3, p4, p5, p6] };

  const c1 = createTeamOp(s, { name: "  冠军队  ", captainId: "p1" });
  check("建队成功且队长自动成为首发", c1.ok && c1.team?.memberIds.length === 1 && c1.state?.players[0].role === "首发");
  s = c1.state!;
  check("队长状态变为已入队", s.players[0].status === "已入队");
  check("重名队伍被拒绝", !createTeamOp(s, { name: "冠军队", captainId: "p2" }).ok);
  check("空名被拒绝", !createTeamOp(s, { name: "  ", captainId: "p2" }).ok);
  check("已入队选手不能再建队", !createTeamOp(s, { name: "乙队", captainId: "p1" }).ok);

  const teamId = c1.team!.id;
  for (const pid of ["p2", "p3", "p4"]) {
    const r = addMemberOp(s, { teamId, playerId: pid, role: "首发" });
    check(`加入第 ${s.players.filter((p) => p.teamId === teamId).length + 1} 名首发`, r.ok);
    s = r.state!;
  }
  const r5 = addMemberOp(s, { teamId, playerId: "p5", role: "首发" });
  check("第 5 名首发入队成功", r5.ok);
  s = r5.state!;
  check("第 6 名首发被拒绝（首发满员）", !addMemberOp(s, { teamId, playerId: "p6", role: "首发" }).ok);
  const sub = addMemberOp(s, { teamId, playerId: "p6", role: "替补" });
  check("替补入队成功", sub.ok);
  s = sub.state!;
  const sub2 = addMemberOp({ ...s, players: [...s.players, { ...p1, id: "p7", name: "庚", status: "已报名" }] }, { teamId, playerId: "p7", role: "替补" });
  check("第 2 名替补被拒绝（最多 1 名）", !sub2.ok);
  check("非法角色被拒绝", !addMemberOp(s, { teamId, playerId: "p6", role: "裁判" as never }).ok);
  check("已入队选手不能被加入其他队伍", !addMemberOp(s, { teamId, playerId: "p6", role: "首发" }).ok);
  check("队伍冻结后不能加人", !addMemberOp({ ...s, teams: s.teams.map((t) => ({ ...t, status: "已冻结" as const })) }, { teamId, playerId: "p6", role: "首发" }).ok);
}

console.log("== 2. 报分校验（validateGames / maxGames） ==");
{
  check("BO1 最大局数 = 1", maxGames("BO1") === 1);
  check("BO3 最大局数 = 3", maxGames("BO3") === 3);
  check("BO5 最大局数 = 5", maxGames("BO5") === 5);
  const g = (a: number, b: number): GameResult => ({ teamAScore: a, teamBScore: b });
  check("BO3 2:0 合法", validateGames([g(13, 5), g(13, 7)], "BO3").ok);
  check("BO3 2:1 合法", validateGames([g(13, 5), g(7, 13), g(13, 7)], "BO3").ok);
  check("BO3 平局非法", !validateGames([g(13, 5), g(7, 7)], "BO3").ok);
  check("BO3 3:0 非法（超过目标）", !validateGames([g(13, 5), g(13, 7), g(13, 6)], "BO3").ok);
  check("BO3 4:1 非法（超过目标）", !validateGames([g(13, 5), g(13, 7), g(7, 13), g(13, 6), g(13, 9)], "BO3").ok);
  check("BO3 6 局非法（超过最大局数）", !validateGames([g(13, 5), g(13, 7), g(7, 13), g(13, 6), g(7, 13), g(13, 4)], "BO3").ok);
  check("BO5 3:2 合法", validateGames([g(13, 5), g(13, 7), g(7, 13), g(6, 13), g(13, 6)], "BO5").ok);
  check("BO1 1:0 合法", validateGames([g(13, 5)], "BO1").ok);
  check("BO1 平局非法", !validateGames([g(5, 5)], "BO1").ok);
  check("空局数非法", !validateGames([], "BO3").ok);
}

console.log("== 3. 种子分档 / 抽签 / 对阵生成 ==");
const reg = makeRegistration();
const frozenTeams = reg.teams.filter((t) => t.status === "已冻结");
check("冻结队伍恰好 16 支", frozenTeams.length === 16);
const pots = buildSeedPots(frozenTeams, reg.players);
check("生成 4 个种子池且每池 4 队", pots.length === 4 && pots.every((p) => p.teamIds.length === 4));
check("队伍数不为 16 时返回空池", buildSeedPots(frozenTeams.slice(0, 15), reg.players).length === 0);

const groups = drawGroups(pots);
check("生成 4 个小组且每组 4 队", groups.length === 4 && groups.every((g) => g.teamIds.length === 4));
const potOf = (teamId: string) => pots.findIndex((p) => p.teamIds.includes(teamId));
check(
  "每组包含 4 个不同种子池的队伍",
  groups.every((g) => new Set(g.teamIds.map(potOf)).size === 4),
);

const matchups = generateMatchups(groups, pots);
check("生成 8 场小组赛首轮对阵", matchups.length === 8);
check(
  "首轮为 1 号池对 4 号池、2 号池对 3 号池",
  matchups.every((m) => {
    const a = potOf(m.teamAId);
    const b = potOf(m.teamBId);
    return (a === 0 && b === 3) || (a === 3 && b === 0) || (a === 1 && b === 2) || (a === 2 && b === 1);
  }),
);

const nameOf = (id: string) => reg.teams.find((t) => t.id === id)?.name ?? id;

const singleMatches = buildSingleEliminationMatches(
  frozenTeams.slice(0, 4).map((team) => team.id),
  nameOf,
  { phase: "测试单败", boType: "BO1" },
);
check("4 队单败生成 3 场", singleMatches.length === 3);
check("单败首轮 2 场有真实队伍，决赛为待定", singleMatches.slice(0, 2).every((match) => match.teamAId !== TBD && match.teamBId !== TBD) && singleMatches[2].teamAId === TBD && singleMatches[2].teamBId === TBD);
check("单败 3 场全部沿用 BO1", singleMatches.every((match) => match.boType === "BO1"));
let singleState = importMatchesOp(initialSchedule(), singleMatches);
singleState = reportGameResultsOp(singleState, "M01", [{ teamAScore: 13, teamBScore: 5 }]).state;
singleState = reportGameResultsOp(singleState, "M02", [{ teamAScore: 13, teamBScore: 7 }]).state;
check("两场半决赛结束后自动填充决赛双方", singleState.matches[2].teamAId !== TBD && singleState.matches[2].teamBId !== TBD);
singleState = reportGameResultsOp(singleState, "M03", [{ teamAScore: 13, teamBScore: 9 }]).state;
check("4 队单败决出冠军", Boolean(singleState.matches[2].winnerTeamId));

const matches = buildTournamentMatches(groups, matchups, nameOf);
check("总场次 34（GSL 小组赛 20 + 双败淘汰 14）", matches.length === 34);
check("首轮 8 场全部有真实队伍", matches.slice(0, 8).every((m) => m.teamAId !== TBD && m.teamBId !== TBD));
check("小组后续轮次与淘汰赛以 TBD 占位", matches.slice(8).every((m) => m.teamAId === TBD && m.teamBId === TBD));
check("每组都有揭幕战、胜者出线战、败者淘汰战和最终出线战", ["A 组", "B 组", "C 组", "D 组"].every((group) => matches.filter((m) => m.phase === "小组赛" && m.round?.startsWith(group)).length === 5));
check("败者组决赛与总决赛为 BO5", matches.find((m) => m.round === "败者组决赛")?.boType === "BO5" && matches.find((m) => m.round === "总决赛")?.boType === "BO5");
check("其余比赛均为 BO3", matches.filter((m) => m.round !== "败者组决赛" && m.round !== "总决赛").every((m) => m.boType === "BO3"));
const m09 = matches.find((m) => m.id === "M09")!;
const m17 = matches.find((m) => m.id === "M17")!;
const m21 = matches.find((m) => m.id === "M21")!;
const m23 = matches.find((m) => m.id === "M23")!;
const m34 = matches.find((m) => m.id === "M34")!;
check("胜者出线战胜者成为小组第一，败者进入最终出线战", m09.nextMatchId === "M21" && m09.nextSide === "A" && m09.nextLoserMatchId === "M17" && m09.nextLoserSide === "A");
check("最终出线战胜者作为小组第二交叉进入八强", m17.nextMatchId === "M23" && m17.nextSide === "B");
check("总决赛无后续晋级", m34.nextMatchId === undefined && m34.nextLoserMatchId === undefined);
check("八强前置比赛来自不同小组出线链路", m21.prerequisiteId === "M09" && m23.prerequisiteId === "M11");

const stagedBlueprintConfig: StageConfig[] = [
  { name: "入围赛", type: "single-elim", teamCount: 32, boType: "BO1" },
  { name: "小组赛", type: "gsl-groups", teamCount: 16, groupCount: 4, boType: "BO3" },
  { name: "淘汰赛", type: "double-elim", teamCount: 8, boType: "BO3" },
];
const stagedBlueprint = buildBracketBlueprint(stagedBlueprintConfig);
check("抽签前骨架展示 16 场入围赛签位", stagedBlueprint.length === 16);
check("抽签前骨架使用 BO1 且带轮次", stagedBlueprint.every((match) => match.boType === "BO1" && match.round === "入围赛"));
check("正式骨架可识别为有效对阵数据", bracketDataIssue(stagedBlueprint, stagedBlueprintConfig) === null);
check("旧演示列表被识别并阻止伪装为对阵图", Boolean(bracketDataIssue(initialSchedule().matches, stagedBlueprintConfig)));
const archivedLegacy = archiveAndClearScheduleOp(initialSchedule());
check("归档旧赛程后当前比赛清空", archivedLegacy.matches.length === 0);
check("归档旧赛程后保留 6 场历史快照", archivedLegacy.versions.some((version) => version.matches.length === 6));

console.log("== 4. 三阶段分批抽签：32 → 16 → 8 ==");
{
  const stagedRegistration = makeRegistration(32);
  const stagedTeams = stagedRegistration.teams.filter((team) => team.status === "已冻结");
  const stagedName = (id: string) => stagedTeams.find((team) => team.id === id)?.name ?? id;
  const stages: [StageConfig, StageConfig, StageConfig] = [
    { name: "入围赛", type: "single-elim", teamCount: 32, boType: "BO1" },
    { name: "小组赛", type: "gsl-groups", teamCount: 16, groupCount: 4, boType: "BO3" },
    { name: "淘汰赛", type: "double-elim", teamCount: 8, boType: "BO3" },
  ];

  const initialGate = resolveStagedDrawGate(stages, stagedTeams.map((team) => team.id), []);
  check("32 支正式队伍只开放入围赛抽签", initialGate.status === "ready" && initialGate.stageIndex === 0 && initialGate.entrantIds.length === 32);

  const qualification = buildQualificationMatches(
    stagedTeams.map((team) => team.id),
    stagedName,
    { phase: "入围赛", boType: "BO1", advancingTeams: 16 },
  ).matches;
  let stagedState = appendMatchesOp(emptySchedule(), qualification, "入围赛抽签发布");
  check("入围赛只生成 16 场，不提前生成小组赛", stagedState.matches.length === 16 && stagedState.matches.every((match) => match.phase === "入围赛"));
  const waitingForGroups = resolveStagedDrawGate(stages, stagedTeams.map((team) => team.id), stagedState.matches);
  check("入围赛未完成时锁定小组赛抽签", waitingForGroups.status === "waiting" && waitingForGroups.stageIndex === 0);

  for (const match of qualification) {
    stagedState = reportGameResultsOp(stagedState, match.id, [{ teamAScore: 13, teamBScore: 5 }]).state;
  }
  const groupGate = resolveStagedDrawGate(stages, stagedTeams.map((team) => team.id), stagedState.matches);
  check("16 场入围赛完成后只读取 16 个真实胜者", groupGate.status === "ready" && groupGate.stageIndex === 1 && groupGate.entrantIds.length === 16 && !groupGate.entrantIds.includes(TBD));
  if (groupGate.status !== "ready") throw new Error("小组赛阶段未按预期解锁");

  const groupTeams = stagedTeams.filter((team) => groupGate.entrantIds.includes(team.id));
  const stagedPots = buildSeedPots(groupTeams, stagedRegistration.players);
  const stagedGroups = drawGroups(stagedPots);
  const stagedMatchups = generateMatchups(stagedGroups, stagedPots);
  const groupStageMatches = buildGslGroupMatches(stagedGroups, stagedMatchups, stagedName, {
    startIndex: 17,
    phase: "小组赛",
    boType: "BO3",
  });
  stagedState = appendMatchesOp(stagedState, groupStageMatches, "小组赛抽签发布");
  check("小组赛追加 20 场并保留 16 场入围赛结果", stagedState.matches.length === 36 && stagedState.matches.slice(0, 16).every((match) => match.status === "已完成"));

  let guard = 0;
  while (guard++ < 30) {
    const ready = stagedState.matches.find((match) =>
      match.phase === "小组赛" && match.status !== "已完成" && match.teamAId !== TBD && match.teamBId !== TBD,
    );
    if (!ready) break;
    stagedState = reportGameResultsOp(stagedState, ready.id, [
      { teamAScore: 13, teamBScore: 5 },
      { teamAScore: 13, teamBScore: 7 },
    ]).state;
  }
  const knockoutGate = resolveStagedDrawGate(stages, stagedTeams.map((team) => team.id), stagedState.matches);
  check("20 场小组赛完成后识别四个小组的第一和第二", knockoutGate.status === "ready" && knockoutGate.stageIndex === 2 && knockoutGate.qualifiers?.length === 8);
  if (knockoutGate.status !== "ready" || !knockoutGate.qualifiers) throw new Error("淘汰赛阶段未按预期解锁");

  const knockoutOrder = buildKnockoutDrawOrder(knockoutGate.qualifiers, () => 0.42);
  const qualifierByTeam = new Map(knockoutGate.qualifiers.map((item) => [item.teamId, item]));
  check("淘汰赛首轮每场均为小组第一对小组第二", [0, 2, 4, 6].every((index) => qualifierByTeam.get(knockoutOrder[index])?.placement === 1 && qualifierByTeam.get(knockoutOrder[index + 1])?.placement === 2));
  check("同组第一和第二被安排在不同半区", knockoutGate.qualifiers.filter((item) => item.placement === 1).every((winner) => {
    const runner = knockoutGate.qualifiers!.find((item) => item.group === winner.group && item.placement === 2)!;
    return Math.floor(Math.floor(knockoutOrder.indexOf(winner.teamId) / 2) / 2) !== Math.floor(Math.floor(knockoutOrder.indexOf(runner.teamId) / 2) / 2);
  }));

  const knockoutMatches = buildDoubleEliminationMatches(knockoutOrder, stagedName, { startIndex: 37, phase: "淘汰赛", boType: "BO3" });
  stagedState = appendMatchesOp(stagedState, knockoutMatches, "淘汰赛抽签发布");
  check("三个阶段合计 50 场且比赛编号不重复", stagedState.matches.length === 50 && new Set(stagedState.matches.map((match) => match.id)).size === 50);
  check("三次阶段发布保留连续版本记录", stagedState.version === 3 && stagedState.versions.length === 3);
}

console.log("== 5. 完整赛程闭环：排期 → 报分 → 晋级 → 冠军 ==");
const config: SchedulingConfig = {
  maxConcurrentMatches: 2,
  boDurations: { BO1: 45, BO3: 90, BO5: 150 },
  stageStart: "2026-10-10T12:00:00",
  stageEnd: "2026-11-15T18:00:00",
};
{
  let state: ScheduleState = importMatchesOp(initialSchedule(), matches);
  const stepMs = 90 * 60 * 1000;
  const stageStart = new Date(config.stageStart).getTime();
  const stageEnd = new Date(config.stageEnd).getTime();

  function scheduleAll(s: ScheduleState): ScheduleState {
    for (const m of s.matches) {
      if (m.status !== "待排期" || m.teamAId === TBD || m.teamBId === TBD) continue;
      let t = stageStart;
      let placed = false;
      while (t + 150 * 60 * 1000 <= stageEnd) {
        const out = setMatchTimeOp(s, m.id, fmt(new Date(t)), config);
        if (out.result?.approved) {
          s = out.state;
          placed = true;
          break;
        }
        t += stepMs;
      }
      if (!placed) throw new Error(`无法为 ${m.id} 找到合法时段`);
    }
    return s;
  }

  function playAll(s: ScheduleState): ScheduleState {
    let guard = 0;
    let playedAny = true;
    while (playedAny && guard++ < 200) {
      playedAny = false;
      const ready = s.matches.filter(
        (m) => m.status === "已排期" && m.teamAId !== TBD && m.teamBId !== TBD,
      );
      for (const m of ready) {
        const games: GameResult[] =
          m.boType === "BO1"
            ? [{ teamAScore: 13, teamBScore: 5 }]
            : m.boType === "BO3"
              ? [{ teamAScore: 13, teamBScore: 5 }, { teamAScore: 13, teamBScore: 7 }]
              : [{ teamAScore: 13, teamBScore: 5 }, { teamAScore: 13, teamBScore: 7 }, { teamAScore: 13, teamBScore: 6 }];
        const out = reportGameResultsOp(s, m.id, games);
        if (!out.value?.ok) throw new Error(`报分失败 ${m.id}: ${out.value?.message}`);
        s = out.state;
        playedAny = true;
      }
      s = scheduleAll(s);
    }
    return s;
  }

  state = scheduleAll(state);
  const firstScheduled = state.matches.filter((m) => m.status === "已排期").length;
  check("首轮排期：8 场全部排期成功", firstScheduled === 8);

  state = playAll(state);

  const completedCount = state.matches.filter((m) => m.status === "已完成").length;
  check("全部 34 场比赛完成", completedCount === 34);
  check("所有比赛都有真实队伍（无 TBD 残留）", state.matches.every((m) => m.teamAId !== TBD && m.teamBId !== TBD));
  const finalM34 = state.matches.find((m) => m.id === "M34")!;
  check("总决赛有胜者", finalM34.winnerTeamId !== undefined && finalM34.winnerTeamId !== TBD);
  const champion = finalM34.winnerTeamId === finalM34.teamAId ? finalM34.teamAName : finalM34.teamBName;
  check(`冠军产生：${champion}`, finalM34.winnerTeamId !== undefined);
  check("赛程版本随排期递增", state.version > 1 && state.versions.length > 1);
  check("小组后续与淘汰赛全部有比分记录", state.matches.slice(8).every((m) => m.gameResults && m.gameResults.length > 0));
}

console.log("== 6. 改期闭环（提交 → 校验 → 批准 → 版本 → 通知） ==");
{
  let s = initialSchedule();
  const okReq = submitRequestOp(s, {
    matchId: "M04",
    newStartTime: "2026-10-07T12:00:00",
    reason: "两队协商改期",
    teamAConfirmed: true,
    teamBConfirmed: true,
  });
  check("合法改期申请无冲突", okReq.value!.approved && okReq.state.requests.length === 1);
  s = okReq.state;

  const badReq = submitRequestOp(s, {
    matchId: "M02",
    newStartTime: "2026-10-06T16:00:00",
    reason: "冲突演示",
    teamAConfirmed: true,
    teamBConfirmed: true,
  });
  check("冲突改期申请被标记冲突", !badReq.value!.approved && badReq.value!.primaryConflict !== "");
  s = badReq.state;

  const blocked = approveRequestOp(s, badReq.state.requests[0].id);
  check("有冲突的申请批准被拦截", blocked.value !== null && !blocked.value!.approved);

  const okReqId = s.requests.find((r) => r.matchId === "M04")!.id;
  const approved = approveRequestOp(s, okReqId);
  check("合法申请批准成功并生成新版本", approved.value?.approved === true && approved.state.version === 2);
  check("批准后生成通知", approved.state.notifications.length === 1 && approved.state.notifications[0].content.includes("赛程变更"));
  s = approved.state;

  // 申请提交之后赛程又变过（版本从 v2 走到 v3）。
  // 这条原先按 AC-03「旧版本申请不能直接批准」拦截，**2026-10-09 改掉**：
  // 版本号是全局的（任何一场报分、任何一次改期都 +1），按它拦截会**必然误报**。
  // 现在改为按**当前赛程**判这个申请自己的时间有没有冲突 —— A 提的 10-07 14:00 本身没问题，
  // 所以应当通过；真正的冲突（时间重叠 HC-05、越界 HC-07）另有断言覆盖。
  const reqA = submitRequestOp(s, {
    matchId: "M05",
    newStartTime: "2026-10-07T14:00:00",
    reason: "申请 A",
    teamAConfirmed: true,
    teamBConfirmed: true,
  });
  s = reqA.state;
  const reqB = submitRequestOp(s, {
    matchId: "M06",
    newStartTime: "2026-10-07T16:00:00",
    reason: "申请 B",
    teamAConfirmed: true,
    teamBConfirmed: true,
  });
  s = reqB.state;
  const approveB = approveRequestOp(s, reqB.state.requests[0].id);
  check("申请 B 批准（版本变为 v3）", approveB.value?.approved === true && approveB.state.version === 3);
  const staleId = reqA.state.requests[0].id;
  const staleApprove = approveRequestOp(approveB.state, staleId);
  check("提交后赛程变过的申请不再按版本号拦截（按当前赛程判定）",
    staleApprove.value !== null && staleApprove.value!.approved === true);
}

console.log("== 7. 排期校验（validateMatchTime 经 setMatchTimeOp） ==");
{
  const s = initialSchedule();
  const ok = setMatchTimeOp(s, "M04", "2026-10-07T12:00:00");
  check("排期/改期成功", ok.value!.approved && ok.state.version === 2);
  const conflict = setMatchTimeOp(s, "M04", "2026-10-06T12:00:00");
  check("并发冲突被拦截（HC-06）", !conflict.value!.approved && conflict.value!.primaryConflict === "HC-06");
  const frozen = setMatchTimeOp({ ...s, matches: s.matches.map((m) => (m.id === "M04" ? { ...m, frozen: true } : m)) }, "M04", "2026-10-07T12:00:00");
  check("冻结比赛排期被拦截（HC-08）", !frozen.value!.approved && frozen.value!.primaryConflict === "HC-08");
  // 已完成比赛不可再改时间
  const played = reportGameResultsOp(s, "M01", [{ teamAScore: 13, teamBScore: 5 }, { teamAScore: 13, teamBScore: 7 }]);
  const done = setMatchTimeOp(played.state, "M01", "2026-10-07T12:00:00");
  check("已完成比赛不能改时间", !done.value!.approved);
}

console.log("== 8. 双队长约赛（发起 → 对手确认 → 负责人审批） ==");
{
  let s = initialSchedule();
  const proposed = submitCaptainRequestOp(s, {
    matchId: "M04",
    newStartTime: "2026-10-07T12:00:00",
    reason: "双方晚一日参赛",
    proposedByTeamId: "G",
  });
  check("队长可提交无冲突候选时间", proposed.value?.ok === true && proposed.value.request?.status === "待对手确认");
  s = proposed.state;
  const duplicate = submitCaptainRequestOp(s, {
    matchId: "M04",
    newStartTime: "2026-10-07T14:00:00",
    reason: "重复申请",
    proposedByTeamId: "G",
  });
  check("同场待处理申请不会重复创建", duplicate.value?.ok === false && duplicate.state.requests.length === 1);
  const requestId = s.requests[0].id;
  const unauthorized = resolveCaptainRequestOp(s, { requestId, actorTeamId: "G", decision: "accept" });
  check("发起方不能代替对手确认", unauthorized.value?.ok === false && unauthorized.state.requests[0].status === "待对手确认");
  const confirmed = resolveCaptainRequestOp(s, { requestId, actorTeamId: "H", decision: "accept" });
  check("对手确认后进入负责人审批", confirmed.value?.ok === true && confirmed.state.requests[0].status === "待审批");
  const approved = approveRequestOp(confirmed.state, requestId, confirmed.state.config);
  check("负责人批准后时间生效并生成通知", approved.value?.approved === true && approved.state.requests[0].status === "已批准" && approved.state.notifications.length === 1);
  check("约赛批准后比赛进入已排期", approved.state.matches.find((match) => match.id === "M04")?.status === "已排期");

  const rejectedProposal = submitCaptainRequestOp(approved.state, {
    matchId: "M05",
    newStartTime: "2026-10-07T14:00:00",
    reason: "测试拒绝",
    proposedByTeamId: "I",
  });
  const rejectedId = rejectedProposal.value?.request?.id ?? "";
  const rejected = resolveCaptainRequestOp(rejectedProposal.state, { requestId: rejectedId, actorTeamId: "J", decision: "reject" });
  check("对手拒绝后申请不会进入审批", rejected.value?.ok === true && rejected.state.requests.find((item) => item.id === rejectedId)?.status === "已驳回");
}

// =====================
// 负责人代为核对双方商定的时间
//
// 背景：实际约赛是两个队长在 QQ/微信里商定，一方到平台填时间，
// 对手不会回来点「确认」，申请于是永远停在「待对手确认」。
// 这段验证负责人能直接落库，并且**记录是诚实的**——不伪造对手的确认。
// =====================
{
  console.log("\n== 负责人代为核对（队长私下商定）==");
  const cfg = { maxConcurrentMatches: 3, boDurations: { BO1: 45, BO3: 90, BO5: 150 }, stageStart: "2026-10-06T12:00:00", stageEnd: "2026-10-15T14:30:00" };

  function stateWithPendingCaptainRequest() {
    let s = emptySchedule();
    s = { ...s, config: cfg, configConfirmed: true };
    const matches: ScheduleMatch[] = [
      { id: "M04", phase: "淘汰赛", teamAId: "G", teamBId: "H", teamAName: "G 队", teamBName: "H 队", boType: "BO3", startTime: "2026-10-07T12:00:00", endTime: "2026-10-07T13:30:00", status: "已排期", frozen: false },
    ];
    s = importMatchesOp(s, matches);
    const proposed = submitCaptainRequestOp(s, {
      matchId: "M04", newStartTime: "2026-10-07T18:00:00", reason: "双方商定晚上", proposedByTeamId: "G",
    });
    return { state: proposed.state, requestId: proposed.value?.request?.id ?? "" };
  }

  const base = stateWithPendingCaptainRequest();
  check("申请停在待对手确认", base.state.requests[0]?.status === "待对手确认");
  check("未核对的申请不进审批", base.state.requests[0]?.teamBConfirmed === false);

  // 不开启 ownerAttests 时，与原来一致：不能批准
  const refused = approveRequestOp(base.state, base.requestId, cfg);
  check("默认不允许批准待对手确认的申请", refused.value === null);

  // 开启后可以直接落库
  const forced = approveRequestOp(base.state, base.requestId, cfg, { ownerAttestsBothTeams: true });
  check("负责人可直接按此时间排期", forced.value?.approved === true);
  check("赛程时间已更新", forced.state.matches.find((m) => m.id === "M04")?.startTime === "2026-10-07T18:00:00");
  check("版本号递增", forced.state.version === base.state.version + 1);

  const resolved = forced.state.requests.find((r) => r.id === base.requestId)!;
  check("申请标记为已批准", resolved.status === "已批准");
  check("记录了负责人核对时间", typeof resolved.ownerAttestedAt === "string" && resolved.ownerAttestedAt.length > 0);
  // ★ 关键：不伪造对手的确认
  check("不篡改对手确认字段", resolved.teamBConfirmed === false && resolved.teamAConfirmed === true);
  check("版本记录标明由负责人核对", forced.state.versions.at(-1)!.note.includes("由负责人核对"));
  check("生成了变更通知", forced.state.notifications.length === 1);
  // 通知要复制到赛事群里，时间到分钟即可，不要带秒
  check("通知时间到分钟、不带秒", /2026-10-07 18:00。/.test(forced.state.notifications[0].content), forced.state.notifications[0].content);

  // 已批准的申请不能重复批准
  const again = approveRequestOp(forced.state, base.requestId, cfg, { ownerAttestsBothTeams: true });
  check("已批准的申请不能重复批准", again.value === null);

  // 有冲突时即便负责人核对也要拦下
  const conflictState = stateWithPendingCaptainRequest();
  const blockedForced = approveRequestOp(
    { ...conflictState.state, requests: conflictState.state.requests.map((r) => ({ ...r, conflicts: [{ code: "HC-07", message: "超出阶段范围" }] })) },
    conflictState.requestId, cfg, { ownerAttestsBothTeams: true },
  );
  check("有冲突时负责人核对也不能强行批准", blockedForced.value !== null && !blockedForced.value!.approved);

  // 负责人核对不影响「已排期」的正常路径
  const normal = stateWithPendingCaptainRequest();
  const confirmed = resolveCaptainRequestOp(normal.state, { requestId: normal.requestId, actorTeamId: "H", decision: "accept" });
  const normalApprove = approveRequestOp(confirmed.state, normal.requestId, cfg);
  check("双确认路径仍然可用", normalApprove.value?.approved === true);
  check("双确认路径不记录负责人核对", normalApprove.state.requests.find((r) => r.id === normal.requestId)?.ownerAttestedAt === undefined);
}

// =====================
// 最近变更通知（取代原「草稿 / 已发送」状态）
// =====================
{
  console.log("\n== 最近通知按条数截断 ==");
  const many: ScheduleState = {
    ...emptySchedule(),
    notifications: Array.from({ length: 8 }, (_, i) => ({
      id: `NT-${i}`,
      version: i + 1,
      content: `第 ${i + 1} 条`,
      createdAt: `2026-10-0${(i % 9) + 1}T0${i % 9}:00:00.000Z`,
    })),
  };
  const recent = recentNotifications(many);
  check("默认只取 5 条", recent.length === RECENT_NOTIFICATION_LIMIT);
  check("按时间倒序", recent[0].createdAt >= recent[recent.length - 1].createdAt);
  check("可以指定条数", recentNotifications(many, 3).length === 3);
  check("空通知不报错", recentNotifications(emptySchedule()).length === 0);
  // 通知不再有状态字段——列表因此不会因为「没人点已发送」而无限堆积
  check("通知已无 status 字段", !("status" in many.notifications[0]));
}

console.log(`\n结果：通过 ${pass} / ${pass + fail}`);
if (fail > 0) process.exit(1);
