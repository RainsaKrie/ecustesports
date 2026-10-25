// 阶段门控：取消部分场次后不应被判错（2026-10-25，审查 4.2）
//
// 2026-10-22 那批连环报错的共同前提是「赛制说 N 场 ⇒ 必须正好 N 场」。
// 现在改成"多于才报错"，这个行为必须有测试锁住，否则下次重构很容易改回去。
import { bracketDataIssue } from "../../src/lib/domains/schedule/bracket-blueprint";
import type { ScheduleMatch } from "../../src/lib/domains/schedule/schedule-data";
import type { StageConfig } from "../../src/lib/domains/schedule/format-templates";

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? "：" + detail : ""}`); }
}

const stage = (type: string, teamCount: number, groupCount?: number): StageConfig =>
  ({ name: "小组赛", type, teamCount, groupCount, boType: "BO3" } as unknown as StageConfig);

function m(id: string, round: string, bo = "BO3"): ScheduleMatch {
  return { id, phase: "小组赛", round, boType: bo, status: "已完成" } as unknown as ScheduleMatch;
}

console.log("阶段门控 · 取消场次");

// 赛制：4 组 4 队单败 = 完整 12 场
const stages = [stage("single-elim-groups", 16, 4)];

// ① 完整 12 场：无问题
const full = ["A", "B", "C", "D"].flatMap((g) => [m(`${g}1`, `${g} 组 半决赛`), m(`${g}2`, `${g} 组 半决赛`), m(`${g}3`, `${g} 组 决赛`)]);
check("完整 12 场不报错", bracketDataIssue(full, stages) === null, String(bracketDataIssue(full, stages)));

// ② 取消 4 场决赛 = 8 场：**不应报错**（这正是 10-22 卡住的地方）
const cancelled = full.filter((x) => !(x.round ?? "").includes("决赛"));
check("取消部分场次（8 场 < 12）不报错", bracketDataIssue(cancelled, stages) === null, String(bracketDataIssue(cancelled, stages)));

// ③ 多出来：应报错，并指出多了几场
const extra = [...full, m("X1", "X 组 半决赛")];
const issue = bracketDataIssue(extra, stages);
check("多于预期要报错", issue !== null);
check("报错说明多了几场", Boolean(issue?.includes("多 1 场")), String(issue));
check("报错附轮次分布", Boolean(issue?.includes("半决赛")), String(issue));

// ④ 缺轮次：报旧版数据问题
const noRound = [...full, { id: "Z", phase: "小组赛", boType: "BO3", status: "待排期" } as unknown as ScheduleMatch];
check("缺轮次判为旧版数据", Boolean(bracketDataIssue(noRound, stages)?.includes("旧版")));

console.log(`\n结果：通过 ${passed} / ${failed + passed}`);
if (failed > 0) process.exit(1);
