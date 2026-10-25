// 场次推导一致性测试（2026-10-25）
//
// 锁住 2026-10-25 审查发现的 P0-1：同一赛制在两处（对阵图校验 / 抽签门控）
// 由两份公式算出不同场次数。现在缺省值已统一，这里断言"两份必须一致"。
import { expectedStageMatches } from "../../src/lib/domains/schedule/bracket-blueprint";
import type { StageConfig } from "../../src/lib/domains/schedule/format-templates";

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? "：" + detail : ""}`); }
}

const stage = (type: string, teamCount: number, groupCount?: number): StageConfig =>
  ({ name: "测试", type, teamCount, groupCount, boType: "BO3" } as unknown as StageConfig);

console.log("场次推导");

// ① 小组赛单败：4 组 4 队 = 12 场（与门控那边同一算法）
const seg = [stage("single-elim-groups", 16, 4)];
check("单败小组 16 队 4 组 = 12 场", expectedStageMatches(seg, 0) === 12, String(expectedStageMatches(seg, 0)));

// ② 缺省组数时不能再算成 0 场（原 bug：?? 0）
const segDefault = [stage("single-elim-groups", 16)];
const got = expectedStageMatches(segDefault, 0);
check("缺省组数时不为 0（原来 ?? 0 会算成 0）", got !== 0 && got !== null, String(got));
check("缺省组数按 4 组算 = 12 场", got === 12, String(got));

// ③ GSL 缺省组数同样不能是 0
const gslDefault = [stage("gsl-groups", 16)];
const gslGot = expectedStageMatches(gslDefault, 0);
check("GSL 缺省组数不为 0", gslGot !== 0, String(gslGot));
check("GSL 缺省按 4 组算 = 20 场", gslGot === 20, String(gslGot));

// ④ 双败支持任意队数（原来只写死 8 队，16 队返回 null = 不校验）
check("双败 8 队 = 14 场", expectedStageMatches([stage("double-elim", 8)], 0) === 14, String(expectedStageMatches([stage("double-elim", 8)], 0)));
check("双败 16 队 = 30 场", expectedStageMatches([stage("double-elim", 16)], 0) === 30, String(expectedStageMatches([stage("double-elim", 16)], 0)));
check("双败 16 队不再是 null（原来等于不校验）", expectedStageMatches([stage("double-elim", 16)], 0) !== null);

// ⑤ 单败：8 队 = 7 场
check("单败 8 队 = 7 场", expectedStageMatches([stage("single-elim", 8)], 0) === 7, String(expectedStageMatches([stage("single-elim", 8)], 0)));

console.log(`\n结果：通过 ${passed} / ${failed + passed}`);
if (failed > 0) process.exit(1);
