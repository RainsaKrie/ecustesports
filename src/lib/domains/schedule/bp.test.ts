// =====================
// BP 系统纯函数测试（顺序生成 / 会话流转 / 结果推导）
// 运行：npx tsx src/lib/domains/schedule/bp.test.ts
// =====================

import { buildBPOrder, remainingMaps, isBPComplete } from "./bp.ts";
import { startBP, advanceBP, undoBP, swapFirstBP, resetBP, canStartBP, teamInSession, stepTeam, rollFirstBP, rollDice, DICE_MIN, DICE_MAX, type BPStore } from "./bp-ops.ts";
import type { ScheduleMatch } from "./schedule-data.ts";

const POOL7 = ["Ascent", "Bind", "Haven", "Split", "Icebox", "Breeze", "Lotus"];
const POOL5 = ["Ascent", "Bind", "Haven", "Split", "Icebox"];

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `（${detail}）` : ""}`); }
}

function mkMatch(id: string, boType: ScheduleMatch["boType"], extra: Partial<ScheduleMatch> = {}): ScheduleMatch {
  return {
    id, phase: "小组赛", round: "首轮", teamAId: "T-A", teamBId: "T-B",
    teamAName: "甲队", teamBName: "乙队", boType,
    startTime: "2026-10-06T12:00:00", endTime: "2026-10-06T13:30:00",
    status: "已排期", frozen: false, ...extra,
  };
}

console.log("== 1. 顺序生成 buildBPOrder ==");
{
  const o1 = buildBPOrder("BO1", 7);
  check("BO1(7图)：6 步全 Ban", o1.length === 6 && o1.every((s) => s.action === "ban"));
  const o3 = buildBPOrder("BO3", 7);
  check("BO3(7图)：4 Ban + 2 Pick", o3.length === 6 && o3.filter((s) => s.action === "ban").length === 4 && o3.filter((s) => s.action === "pick").length === 2);
  const o5 = buildBPOrder("BO5", 7);
  check("BO5(7图)：2 Ban + 5 Pick", o5.length === 7 && o5.filter((s) => s.action === "ban").length === 2 && o5.filter((s) => s.action === "pick").length === 5);
  const o5s = buildBPOrder("BO5", 5);
  check("BO5(5图)：无 Ban 直接 5 Pick", o5s.length === 5 && o5s.every((s) => s.action === "pick"));
  check("池不足返回空（BO3 需 3 张）", buildBPOrder("BO3", 2).length === 0);
  check("交替从先手方开始", o1[0].side === "first" && o1[1].side === "second" && o1[2].side === "first");
  const o3b = buildBPOrder("BO3", 7);
  check("Pick 阶段先手方先行", o3b[4].side === "first" && o3b[5].side === "second");
}

console.log("== 2. 会话开始 / 前置校验 ==");
{
  const match = mkMatch("M01", "BO3");
  const store: BPStore = {};
  check("已排期比赛可开始", canStartBP(match, store).ok);
  check("待排期比赛不可开始", !canStartBP(mkMatch("M02", "BO3", { status: "待排期", startTime: "" }), store).ok);
  check("冻结比赛不可开始", !canStartBP(mkMatch("M03", "BO3", { frozen: true }), store).ok);
  check("TBD 对阵不可开始", !canStartBP(mkMatch("M04", "BO3", { teamAId: "TBD" }), store).ok);

  const s = startBP(store, { match, pool: POOL7 });
  check("创建会话成功", s.ok && s.session!.status === "进行中" && s.session!.firstTeamId === "T-A");
  const s2 = startBP({ [match.id]: s.session! }, { match, pool: POOL7 });
  check("重复开始返回同一会话", s2.session!.id === s.session!.id);
  const done = { ...s.session!, status: "已完成" as const };
  check("已完成会话的比赛不能再开始", !canStartBP(match, { [match.id]: done }).ok);
  check("地图池不足不能开始（BO5 需 5 张）", !startBP(store, { match: mkMatch("M05", "BO5"), pool: POOL5.slice(0, 4) }).ok);
}

console.log("== 3. BO1 全流程 ==");
{
  const match = mkMatch("B1", "BO1");
  let r = startBP({}, { match, pool: POOL7 });
  let session = r.session!;
  const banned: string[] = [];
  for (let i = 0; i < 6; i++) {
    const next = remainingMaps(POOL7, session.actions)[0];
    banned.push(next);
    r = advanceBP(session, { mapId: next, operatorRole: "team" }, POOL7);
    check(`BO1 第 ${i + 1} 步推进成功`, r.ok);
    session = r.session!;
  }
  check("BO1 完成后状态为已完成", session.status === "已完成");
  check("BO1 完成推导唯一图", r.finalMaps!.length === 1 && !banned.includes(r.finalMaps![0]));
  check("完成后再推进被拒", !advanceBP(session, { mapId: "Ascent", operatorRole: "team" }, POOL7).ok);
}

console.log("== 4. BO3 全流程 ==");
{
  const match = mkMatch("B3", "BO3");
  let r = startBP({}, { match, pool: POOL7 });
  let session = r.session!;
  // 4 bans
  for (let i = 0; i < 4; i++) {
    r = advanceBP(session, { mapId: remainingMaps(POOL7, session.actions)[0], operatorRole: "team" }, POOL7);
    session = r.session!;
  }
  check("BO3 完成 4 Ban 后剩 3 张", remainingMaps(POOL7, session.actions).length === 3);
  const pick1 = remainingMaps(POOL7, session.actions)[0];
  r = advanceBP(session, { mapId: pick1, operatorRole: "team" }, POOL7);
  session = r.session!;
  const pick2 = remainingMaps(POOL7, session.actions)[0];
  r = advanceBP(session, { mapId: pick2, operatorRole: "team" }, POOL7);
  session = r.session!;
  check("BO3 完成", session.status === "已完成");
  check("BO3 结果 = 两张 Pick + 决胜图", r.finalMaps!.length === 3 && r.finalMaps![0] === pick1 && r.finalMaps![1] === pick2 && !remainingMaps(POOL7, session.actions).includes(r.finalMaps![2]) === false && POOL7.includes(r.finalMaps![2]));
}

console.log("== 5. BO5 全流程（5 张池，无 Ban） ==");
{
  const match = mkMatch("B5", "BO5");
  let r = startBP({}, { match, pool: POOL5 });
  let session = r.session!;
  check("BO5 开始无 Ban 步骤", session.order.every((s) => s.action === "pick"));
  for (let i = 0; i < 5; i++) {
    r = advanceBP(session, { mapId: remainingMaps(POOL5, session.actions)[0], operatorRole: "team" }, POOL5);
    session = r.session!;
  }
  check("BO5 完成且选满 5 张", session.status === "已完成" && r.finalMaps!.length === 5);
}

console.log("== 6. 回退 / 交换 / 重置 / 身份 ==");
{
  const match = mkMatch("B6", "BO3");
  let r = startBP({}, { match, pool: POOL7 });
  let session = r.session!;
  const firstBan = remainingMaps(POOL7, session.actions)[0];
  r = advanceBP(session, { mapId: firstBan, operatorRole: "team" }, POOL7);
  session = r.session!;
  check("推进 1 步后 currentStep 移动", session.actions.length === 1);

  const undo = undoBP(session);
  check("回退成功", undo.ok && undo.session!.actions.length === 0);
  check("回退后仍可再次推进同一张图", advanceBP(undo.session!, { mapId: firstBan, operatorRole: "team" }, POOL7).ok);
  check("空操作回退被拒", !undoBP(undo.session!).ok);

  const swapped = swapFirstBP(undo.session!);
  check("未开始时交换先手成功", swapped.ok && swapped.session!.firstTeamId === "T-B");
  check("已操作后交换被拒", !swapFirstBP(session).ok);
  check("完成态交换被拒", !swapFirstBP({ ...session, status: "已完成" }).ok);

  const reset = resetBP(session);
  check("重置清空操作", reset.ok && reset.session!.actions.length === 0);
  check("完成态重置被拒", !resetBP({ ...session, status: "已完成" }).ok);

  const started = startBP({}, { match, pool: POOL7 }).session!;
  check("队伍侧识别", teamInSession(started, "T-A") === "first" && teamInSession(started, "T-B") === "second");
  check("非参赛队伍返回 null", teamInSession(started, "T-X") === null);
  check("当前步骤操作方 = 先手队伍", stepTeam(started) === "T-A");
}

console.log("== 7. 违规操作 ==");
{
  const match = mkMatch("B7", "BO3");
  let r = startBP({}, { match, pool: POOL7 });
  let session = r.session!;
  check("不在池内的地图被拒", !advanceBP(session, { mapId: "深渊", operatorRole: "team" }, POOL7).ok);
  const m1 = remainingMaps(POOL7, session.actions)[0];
  r = advanceBP(session, { mapId: m1, operatorRole: "team" }, POOL7);
  session = r.session!;
  check("重复 Ban 被拒", !advanceBP(session, { mapId: m1, operatorRole: "team" }, POOL7).ok);
  check("完成前 isBPComplete = false", !isBPComplete(session.order, session.actions));
}

console.log("== 8. 掷骰子比大小决定先手 ==");
{
  /** 用固定序列构造随机的可复现替身：值 0 → 点数 1，接近 1 → 点数 6 */
  const seq = (...values: number[]) => {
    let i = 0;
    return () => values[i++ % values.length];
  };
  const p = (n: number) => (n - DICE_MIN) / (DICE_MAX - DICE_MIN + 1) + 1e-9; // 掷出恰好 n 点
  const SIX = p(6); const ONE = p(1); const FIVE = p(5); const THREE = p(3);

  check("rollDice 输出落在 1–6", Array.from({ length: 200 }, () => rollDice()).every((n) => n >= DICE_MIN && n <= DICE_MAX && Number.isInteger(n)));
  check("rollDice 注入随机可得指定点", rollDice(seq(SIX)) === 6 && rollDice(seq(ONE)) === 1);

  const match = mkMatch("D1", "BO3");
  const base = startBP({}, { match, pool: POOL7 }).session!;
  check("初始先手为 A 侧（甲队）", base.firstTeamSide === "A" && base.firstTeamId === "T-A");

  // A=6 B=1 → A 先手（保持不变）
  const aWins = rollFirstBP(base, seq(SIX, ONE));
  check("A 点大 → A 侧先手", aWins.session!.firstTeamSide === "A" && aWins.session!.firstTeamId === "T-A");
  check("A 点大 → 记录双方点数", aWins.session!.diceRoll!.teamA === 6 && aWins.session!.diceRoll!.teamB === 1);
  check("A 点大 → 一次定胜负", aWins.attempts === 1);

  // A=1 B=5 → B 先手（交换）
  const bWins = rollFirstBP(base, seq(ONE, FIVE));
  check("B 点大 → B 侧先手", bWins.session!.firstTeamSide === "B" && bWins.session!.firstTeamId === "T-B");
  check("B 点大 → 第二队变甲队", bWins.session!.secondTeamId === "T-A" && bWins.session!.secondTeamName === "甲队");

  /*
   * 关键回归：连续掷多次后先手必须与点数严格一致。
   * 只看单次结果测不出"某次掷骰后 firstTeamSide 没更新"这类错误 ——
   * 因为 next 是从上一次 session 派生的，一旦中间漏更新，
   * 后续轮次会持续错位。这里连掷 12 次，每次都校验点数大的那侧在先手。
   */
  let cursor = base;
  let streakOk = true;
  let sawA = false;
  let sawB = false;
  for (let i = 0; i < 12; i++) {
    const a = i % 6 + 1;
    const b = (i * 3) % 6 + 1;
    if (a === b) continue;
    const out = rollFirstBP(cursor, seq(p(a), p(b)));
    const s = out.session!;
    const expectSide = a > b ? "A" : "B";
    if (s.firstTeamSide !== expectSide) streakOk = false;
    // 先手侧名字必须与 side 对应
    if (s.firstTeamName !== (expectSide === "A" ? "甲队" : "乙队")) streakOk = false;
    if (expectSide === "A") sawA = true; else sawB = true;
    cursor = s;
  }
  check("连续 12 轮：先手侧与点数始终一致", streakOk);
  check("连续 12 轮两种结果都出现过（夹具有效）", sawA && sawB);

  // 平局重掷：第一轮 3:3，第二轮 6:1 → 应记 6:1 且 attempts=2
  const tie = rollFirstBP(base, seq(THREE, THREE, SIX, ONE));
  check("平局自动重掷一轮", tie.attempts === 2);
  check("平局重掷后记录的是最终点数", tie.session!.diceRoll!.teamA === 6 && tie.session!.diceRoll!.teamB === 1);
  check("平局重掷后先手正确", tie.session!.firstTeamSide === "A");

  // 已在操作中的会话不能再掷
  const played = advanceBP(base, { mapId: POOL7[0], operatorRole: "team" }, POOL7).session!;
  check("已开始 BP 后不能重新掷骰子", !rollFirstBP(played, seq(SIX, ONE)).ok);
  check("已完成会话不能掷骰子", !rollFirstBP({ ...base, status: "已完成" }, seq(SIX, ONE)).ok);

  /*
   * 回归：重置必须把点数一起清掉。
   * 只断 actions 长度会漏掉"点数还挂在界面上"这个真实 bug。
   */
  const rolled = rollFirstBP(base, seq(SIX, ONE)).session!;
  check("掷完后会话带点数", Boolean(rolled.diceRoll));
  const afterReset = resetBP(rolled).session!;
  check("重置清空操作", afterReset.actions.length === 0);
  check("重置清空骰子点数", afterReset.diceRoll === undefined);
  check("重置后点数不可见（键不存在而非 null）", !("diceRoll" in afterReset));
}

console.log(`\n结果：通过 ${pass} / ${pass + fail}`);
if (fail > 0) process.exit(1);
