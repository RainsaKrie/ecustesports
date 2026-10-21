// =====================
// 分组积分逻辑测试（2026-10-21）
//
// 为什么加：分组曾经用"从对阵反推"（并查集）实现，未开赛的轮次没有对局 →
// 一个 4 人组被拆成两个 2 人组，线上显示成「C 组 1 队：待定」。
// 逻辑埋在客户端组件里，Node 测不了，只能靠人眼看页面。
// 现已抽到 src/lib/domains/schedule/group-standings.ts，这里做回归。
// =====================

import { buildGroups } from "../../src/lib/domains/schedule/group-standings";
import type { ScheduleMatch } from "../../src/lib/domains/schedule/schedule-data";

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? "：" + detail : ""}`); }
}

/** 造一场小组赛：round 写成「A 组 半决赛」这种真实格式 */
function match(id: string, a: string, b: string, round: string, phase = "小组赛"): ScheduleMatch {
  return {
    id, phase, round, boType: "BO1", frozen: false, status: "未开始",
    startTime: "2026-10-20T20:00:00", endTime: "2026-10-20T21:00:00",
    teamAId: a, teamBId: b, teamAName: a, teamBName: b,
  } as unknown as ScheduleMatch;
}

console.log("分组积分 · 分组识别");

// ① 正常情况：4 组 × 4 队（每组两场半决赛）
const normal: ScheduleMatch[] = [];
for (const g of ["A", "B", "C", "D"]) {
  normal.push(match(`${g}1`, `${g}T1`, `${g}T2`, `${g} 组 半决赛`));
  normal.push(match(`${g}2`, `${g}T3`, `${g}T4`, `${g} 组 半决赛`));
}
const g1 = buildGroups(normal);
check("识别出 4 个组", g1.size === 4, `实际 ${g1.size}`);
check("每组 4 队", [...g1.values()].every((s) => s.size === 4),
  [...g1.values()].map((s) => s.size).join("/"));

// ② 占位队伍不能算进组（这是线上出过的问题）
const withTbd: ScheduleMatch[] = [
  match("A1", "A1", "A2", "A 组 半决赛"),
  match("A2", "A3", "A4", "A 组 半决赛"),
  match("A3", "TBD", "A1", "A 组 决赛"),   // 决赛对手未定
];
const g2 = buildGroups(withTbd);
check("占位 TBD 不算队伍", g2.get("A 组")?.size === 4, `实际 ${g2.get("A 组")?.size}`);

// ③ 只有占位的组不该出现（抽签前）
const onlyTbd: ScheduleMatch[] = [match("X1", "TBD", "TBD", "A 组 半决赛")];
const g3 = buildGroups(onlyTbd);
check("全占位的组不出现", g3.size === 0, `实际 ${g3.size}`);

// ④ 没有 round 组名时退回并查集（兜底路径仍可用）
const noRound: ScheduleMatch[] = [
  match("M1", "T1", "T2", "第 1 轮"),
  match("M2", "T3", "T4", "第 1 轮"),
];
const g4 = buildGroups(noRound);
check("无组名时退回并查集，仍在同一阶段内", g4.size >= 1, `实际 ${g4.size}`);

console.log(`\n结果：通过 ${passed} / ${failed + passed}`);
if (failed > 0) process.exit(1);
