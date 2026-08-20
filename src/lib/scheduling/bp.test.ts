// =====================
// BP 系统纯函数测试（顺序生成 / 会话流转 / 结果推导）
// 运行：npx tsx src/lib/scheduling/bp.test.ts
// =====================

import { buildBPOrder, remainingMaps, isBPComplete } from "./bp.ts";
import { startBP, advanceBP, undoBP, swapFirstBP, resetBP, canStartBP, teamInSession, stepTeam, type BPStore } from "./bp-ops.ts";
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

console.log(`\n结果：通过 ${pass} / ${pass + fail}`);
if (fail > 0) process.exit(1);
