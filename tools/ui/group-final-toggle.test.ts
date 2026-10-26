// 组内决赛开关（2026-10-26，技术债 B1）
//
// 要证明的事：关掉 groupFinalEnabled 之后，
//   ① 场次推导从 12 变成 8（4 组 × 2）；
//   ② 生成的对阵里没有决赛；
//   ③ 半决赛不再指向一个不存在的决赛（无悬空引用）。
import { expectedStageMatches } from "../../src/lib/domains/schedule/bracket-blueprint";
import { buildGroupSingleElimMatches } from "../../src/lib/domains/schedule/bracket-engine";
import type { FormatStageConfig } from "../../src/lib/domains/schedule/format-templates";

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? "：" + detail : ""}`); }
}

const stage = (extra: Record<string, unknown> = {}): FormatStageConfig =>
  ({ name: "小组赛", type: "single-elim-groups", teamCount: 16, groupCount: 4, boType: "BO3", ...extra } as unknown as FormatStageConfig);

console.log("组内决赛开关");

// ① 推导
check("默认（有决赛）= 12 场", expectedStageMatches([stage()], 0) === 12, String(expectedStageMatches([stage()], 0)));
check("关掉决赛 = 8 场", expectedStageMatches([stage({ groupFinalEnabled: false })], 0) === 8, String(expectedStageMatches([stage({ groupFinalEnabled: false })], 0)));
check("显式 true 仍为 12 场", expectedStageMatches([stage({ groupFinalEnabled: true })], 0) === 12);

// ② 生成
const groups = ["A", "B", "C", "D"].map((g, i) => ({
  name: `${g} 组`,
  teamIds: [`${g}1`, `${g}2`, `${g}3`, `${g}4`],
})) as unknown as Parameters<typeof buildGroupSingleElimMatches>[0];
const name = (id: string) => id;

const full = buildGroupSingleElimMatches(groups, name, { phase: "小组赛", boType: "BO3" });
check("默认生成 12 场", full.length === 12, String(full.length));

const noFinal = buildGroupSingleElimMatches(groups, name, { phase: "小组赛", boType: "BO3", groupFinalEnabled: false });
check("关掉决赛生成 8 场", noFinal.length === 8, String(noFinal.length));
// 用结构化字段判断，不要用 endsWith("决赛")——「半决赛」也以「决赛」结尾（这正是 B1 要解决的问题）
check("生成结果里没有决赛", noFinal.every((m) => m.roundStage !== "final"), noFinal.map((m) => `${m.round}[${m.roundStage}]`).join(","));
check("留下的都是半决赛", noFinal.every((m) => m.roundStage === "semi"));

// ③ 无悬空引用
const ids = new Set(noFinal.map((m) => m.id));
const dangling = noFinal.filter((m) => m.nextMatchId && !ids.has(m.nextMatchId));
check("没有指向不存在比赛的引用", dangling.length === 0, dangling.map((m) => `${m.id}→${m.nextMatchId}`).join(","));

console.log(`\n结果：通过 ${passed} / ${failed + passed}`);
if (failed > 0) process.exit(1);
