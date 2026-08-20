// =====================
// 完整闭环测试：选手报名 → 组队 → 冻结 → 种子分档 → 抽签 → 对阵
// → 发布赛程 → 排期 → 报分 → 晋级（胜者/败者）→ 冠军
// 运行：npx tsx src/lib/scheduling/full-loop.test.ts
// =====================

import { normalizeRegistrationState, type RegistrationState, type RegistrationPlayer, type RegistrationTeam } from "./registration-data.ts";
import { createTeamOp, addMemberOp } from "./registration-ops.ts";
import { buildSeedPots, drawGroups, generateMatchups } from "./format-data.ts";
import { buildTournamentMatches, TBD } from "./bracket.ts";
import type { ScheduleState, GameResult } from "./schedule-data.ts";
import { initialSchedule } from "./schedule-data.ts";
import {
  importMatchesOp,
  submitRequestOp,
  approveRequestOp,
  reportGameResultsOp,
  setMatchTimeOp,
  validateGames,
  maxGames,
} from "./schedule-ops.ts";
import type { SchedulingConfig } from "./rule-engine.ts";

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

// ---- 构造 16 支冻结队伍（每队 5 名首发，段位按池递减） ----
const RANKS = [["无畏战魂", "神话"], ["钻石", "超凡", "铂金"], ["黄金", "白银"], ["青铜", "铁"]];
function makeRegistration(): RegistrationState {
  const players: RegistrationPlayer[] = [];
  const teams: RegistrationTeam[] = [];
  let seq = 0;
  for (let i = 0; i < 16; i++) {
    const potRanks = RANKS[Math.floor(i / 4)];
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
const matches = buildTournamentMatches(groups, matchups, nameOf);
check("总场次 26（首轮 8 + 次轮 4 + 双败淘汰 14）", matches.length === 26);
check("首轮 8 场全部有真实队伍", matches.slice(0, 8).every((m) => m.teamAId !== TBD && m.teamBId !== TBD));
check("次轮与淘汰赛以 TBD 占位", matches.slice(8).every((m) => m.teamAId === TBD && m.teamBId === TBD));
check("败者组决赛与总决赛为 BO5", matches.find((m) => m.round === "败者组决赛")?.boType === "BO5" && matches.find((m) => m.round === "总决赛")?.boType === "BO5");
check("其余比赛均为 BO3", matches.filter((m) => m.round !== "败者组决赛" && m.round !== "总决赛").every((m) => m.boType === "BO3"));
const m09 = matches.find((m) => m.id === "M09")!;
const m13 = matches.find((m) => m.id === "M13")!;
const m15 = matches.find((m) => m.id === "M15")!;
const m26 = matches.find((m) => m.id === "M26")!;
check("小组次轮胜者晋级胜者组、败者交叉进入八强", m09.nextMatchId === "M13" && m09.nextSide === "A" && m09.nextLoserMatchId === "M15" && m09.nextLoserSide === "B");
check("总决赛无后续晋级", m26.nextMatchId === undefined && m26.nextLoserMatchId === undefined);
check("八强前置比赛为小组次轮", m13.prerequisiteId === "M09" && m15.prerequisiteId === "M11");

console.log("== 4. 完整赛程闭环：排期 → 报分 → 晋级 → 冠军 ==");
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
  check("全部 26 场比赛完成", completedCount === 26);
  check("所有比赛都有真实队伍（无 TBD 残留）", state.matches.every((m) => m.teamAId !== TBD && m.teamBId !== TBD));
  const finalM26 = state.matches.find((m) => m.id === "M26")!;
  check("总决赛有胜者", finalM26.winnerTeamId !== undefined && finalM26.winnerTeamId !== TBD);
  const champion = finalM26.winnerTeamId === finalM26.teamAId ? finalM26.teamAName : finalM26.teamBName;
  check(`冠军产生：${champion}`, finalM26.winnerTeamId !== undefined);
  check("赛程版本随排期递增", state.version > 1 && state.versions.length > 1);
  check("淘汰赛全部场次有比分记录", state.matches.slice(8).every((m) => m.gameResults && m.gameResults.length > 0));
}

console.log("== 5. 改期闭环（提交 → 校验 → 批准 → 版本 → 通知） ==");
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
  check("批准后生成通知草稿", approved.state.notifications.length === 1 && approved.state.notifications[0].status === "草稿");
  s = approved.state;

  // 旧版本申请不能直接批准（AC-03）
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
  check("基于旧版本的申请 A 批准被拦截（HC-01）", staleApprove.value !== null && !staleApprove.value!.approved && staleApprove.value!.primaryConflict === "HC-01");
  check("被拦截后申请冲突说明已刷新", staleApprove.state.requests.some((r) => r.id === staleId && r.conflicts.some((c) => c.code === "HC-01")));
}

console.log("== 6. 排期校验（validateMatchTime 经 setMatchTimeOp） ==");
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

console.log(`\n结果：通过 ${pass} / ${pass + fail}`);
if (fail > 0) process.exit(1);
