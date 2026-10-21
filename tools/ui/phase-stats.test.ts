// 当前阶段计算的行为测试（2026-10-21，审计 P3）
import { currentPhaseStats } from "../../src/lib/domains/schedule/phase-stats";
import type { ScheduleMatch } from "../../src/lib/domains/schedule/schedule-data";

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? "：" + detail : ""}`); }
}

function m(id: string, phase: string, status: string, a = "T1", b = "T2"): ScheduleMatch {
  return {
    id, phase, round: phase, boType: "BO1", frozen: false, status,
    startTime: "2026-10-20T20:00:00", endTime: "2026-10-20T21:00:00",
    teamAId: a, teamBId: b, teamAName: a, teamBName: b,
  } as unknown as ScheduleMatch;
}

console.log("当前阶段计算");

// ① 有未完赛的阶段时，取最后一个未完赛的
const s1 = currentPhaseStats([
  m("1", "资格赛", "已完成"),
  m("2", "入围赛", "已完成"),
  m("3", "小组赛", "未开始"),
  m("4", "淘汰赛", "未开始"),
]);
// 规则是「从后往前找第一个还有未完赛的阶段」—— 所以两条都未完赛时，当前阶段是更靠后的「淘汰赛」
check("取最后一个还有未完赛的阶段", s1.currentPhase === "淘汰赛", s1.currentPhase);
check("已完成数正确", s1.currentDone === 0, String(s1.currentDone));
check("最后一个阶段没有下一阶段", s1.nextPhase === undefined, String(s1.nextPhase));

// ② 全部完成时取最后一个阶段（不能返回空字符串）
const s2 = currentPhaseStats([
  m("1", "资格赛", "已完成"),
  m("2", "淘汰赛", "已完成"),
]);
check("全完成时取最后一个阶段", s2.currentPhase === "淘汰赛", s2.currentPhase);
check("全完成时没有下一阶段", s2.nextPhase === undefined, String(s2.nextPhase));

// ③ 中间阶段未打完时，当前阶段是它（不是最后一个）
const s3 = currentPhaseStats([
  m("1", "资格赛", "已完成"),
  m("2", "入围赛", "已完成"),
  m("3", "入围赛", "未开始"),
  m("4", "小组赛", "未开始"),
]);
check("更靠后的未完成阶段优先", s3.currentPhase === "小组赛", s3.currentPhase);
check("该阶段完成数按已完成的算", s3.currentDone === 0, String(s3.currentDone));

// ④ 空输入不应抛异常
const s4 = currentPhaseStats([]);
check("空输入返回空阶段", s4.currentPhase === "", JSON.stringify(s4.currentPhase));
check("空输入下一阶段为 undefined", s4.nextPhase === undefined);

console.log(`\n结果：通过 ${passed} / ${failed + passed}`);
if (failed > 0) process.exit(1);
