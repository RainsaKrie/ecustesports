// 结构化轮次（2026-10-26，审查 P1-4）
//
// 核心要证明的事：**加了「季军决赛」这种新轮次后，名次提取不会把它当成小组决赛。**
// 旧逻辑靠 `endsWith("决赛")`，一定会误判；新逻辑看 roundStage，不会。
import { extractGroupSingleElimQualifiers } from "../../src/lib/domains/schedule/staged-format";
import type { ScheduleMatch } from "../../src/lib/domains/schedule/schedule-data";

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? "：" + detail : ""}`); }
}

function m(round: string, winner: string, extra: Partial<ScheduleMatch> = {}): ScheduleMatch {
  return {
    id: round, phase: "小组赛", round, roundGroup: "A 组", status: "已完成",
    winnerTeamId: winner, teamAId: winner, teamBId: "X", boType: "BO3",
    ...extra,
  } as unknown as ScheduleMatch;
}

console.log("结构化轮次");

// ① 带 roundStage 的决赛：正常提取第一第二
const structured = [
  m("A 组 决赛", "T1", { roundStage: "final" }),
];
const q1 = extractGroupSingleElimQualifiers(structured, "小组赛");
check("结构化决赛能提取名次", q1.length === 2, `提取到 ${q1.length}`);

// ② 带 roundStage 的「季军决赛」：不应被当成小组决赛
const thirdPlace = [
  m("A 组 决赛", "T1", { roundStage: "final" }),
  m("季军决赛", "T9", { roundStage: "other", roundGroup: undefined }),
];
const q2 = extractGroupSingleElimQualifiers(thirdPlace, "小组赛");
check("季军决赛不被当成小组决赛", q2.length === 2, `提取到 ${q2.length}（应为 2）`);
check("季军决赛没有污染组名", q2.every((x) => x.group === "A 组"), q2.map((x) => x.group).join(","));

// ③ 旧数据（无 roundStage）：退回字符串匹配，行为与之前一致
const legacy = [
  m("A 组 决赛", "T1", { roundStage: undefined }),
];
const q3 = extractGroupSingleElimQualifiers(legacy, "小组赛");
check("旧数据仍能提取（兼容）", q3.length === 2, `提取到 ${q3.length}`);

// ④ 旧数据里「半决赛」不能被当成决赛
const legacySemiOnly = [
  m("A 组 半决赛", "T1", { roundStage: undefined }),
];
const q4 = extractGroupSingleElimQualifiers(legacySemiOnly, "小组赛");
check("旧数据的半决赛不产生名次（没有决赛）", q4.length === 0, `提取到 ${q4.length}`);

console.log(`\n结果：通过 ${passed} / ${failed + passed}`);
if (failed > 0) process.exit(1);
