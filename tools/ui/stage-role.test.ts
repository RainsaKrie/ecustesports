// 阶段角色识别测试（2026-10-25，审查 P0-2）
import { roleOf, isGroupStage, hasGroupPhase } from "../../src/lib/domains/schedule/stage-role";
import type { StageConfig } from "../../src/lib/domains/schedule/format-templates";

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? "：" + detail : ""}`); }
}
const s = (name: string, type: string, role?: string): StageConfig =>
  ({ name, type, teamCount: 8, boType: "BO3", role } as unknown as StageConfig);

console.log("阶段角色");

// ① 类型优先：改名不影响识别
check("组内单败 → group（名字随便叫）", roleOf(s("随便什么名字", "single-elim-groups")) === "group");
check("GSL → group", roleOf(s("小组赛", "gsl-groups")) === "group");
check("双败 → knockout", roleOf(s("淘汰赛", "double-elim")) === "knockout");

// ② 显式 role 优先于一切
check("显式 role 覆盖类型推断", roleOf(s("小组赛", "gsl-groups", "qualifier")) === "qualifier");

// ③ 单败靠名字兜底（资格赛 vs 淘汰赛同类型）
check("单败 + 名字含淘汰 → knockout", roleOf(s("淘汰赛", "single-elim")) === "knockout");
check("单败 + 名字不含淘汰 → qualifier", roleOf(s("资格赛", "single-elim")) === "qualifier");

// ④ 改名后仍能认出小组（这正是修复目标）
const renamed = s("分组赛", "single-elim-groups");
check("阶段改名为「分组赛」仍识别为小组", isGroupStage(renamed));
check("旧的白名单会认不出「分组赛」（对照）", !["小组赛", "组内", "GSL"].some((h) => "分组赛".includes(h)));

// ⑤ 赛程里有没有小组阶段
check("有配置时按配置判断", hasGroupPhase([{ phase: "随便" }], [s("分组赛", "single-elim-groups")]));
check("无配置时按名字兜底", hasGroupPhase([{ phase: "C 组 半决赛" }], undefined) === false);
check("无配置时按关键词兜底", hasGroupPhase([{ phase: "小组赛" }], undefined));

console.log(`\n结果：通过 ${passed} / ${failed + passed}`);
if (failed > 0) process.exit(1);
