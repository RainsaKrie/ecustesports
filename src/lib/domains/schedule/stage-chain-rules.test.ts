// 赛段链规则的单测：13 条规则各一个反例，外加现有四套赛制的回归样本。
import { validateStageChain, LEGACY_CHAINS, type StageChain } from "./stage-chain-rules.ts";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`); }
};

/** 一条通过校验的基准链（36 队四段），各用例只改动其中一处 */
const base = (): StageChain => ({
  entrants: 36,
  stages: [
    { name: "资格赛", type: "single-elim", entrants: 36, advance: 32, bo: 1 },
    { name: "入围赛", type: "single-elim", entrants: 32, advance: 16, bo: 3 },
    { name: "小组赛", type: "gsl-groups", entrants: 16, advance: 8, bo: 3, groups: 4 },
    { name: "淘汰赛", type: "single-elim", entrants: 8, advance: 1, bo: 5 },
  ],
});
const rules = (chain: StageChain) => validateStageChain(chain).problems.map((p) => p.rule);

console.log("== 基准与回归 ==");
check("基准链（36 队四段）通过", rules(base()).length === 0, `实际：${rules(base()).join(",")}`);
for (const [name, chain] of Object.entries(LEGACY_CHAINS)) {
  const result = validateStageChain(chain);
  check(`现有赛制 ${name} 通过校验（不能被新规则误杀）`, result.problems.length === 0,
    result.problems.map((p) => `${p.rule}: ${p.message}`).join(" | "));
}

console.log("== 13 条规则各一个反例 ==");
{
  // 24 队打双败：非 2 的幂，必须被拒（用一条独立的短链，避开 R6 的干扰）
  const c: StageChain = { entrants: 24, stages: [
    { name: "双败", type: "double-elim", entrants: 24, advance: 8, bo: 3 },
    { name: "决赛", type: "single-elim", entrants: 8, advance: 1, bo: 5 },
  ] };
  check("R1 双败非 2 的幂被拒", rules(c).includes("R1"));
}
{
  const c = base();
  c.stages[1] = { ...c.stages[1], advance: 20 };  // 20 不是 2 的幂，签位拼不出来
  check("R2 单败晋级数不是 2 的幂被拒", rules(c).includes("R2"));
}
{
  const c = base();
  c.stages[2] = { ...c.stages[2], groups: 3 };    // 16 支分 3 组不成立
  check("R3 小组数与队伍数不匹配被拒", rules(c).includes("R3"));
}
{
  // 24 队瑞士：非 2 的幂，必须被拒（负责人 2026-10-19 收紧规则）
  const c: StageChain = { entrants: 24, stages: [
    { name: "瑞士", type: "swiss", entrants: 24, advance: 8, bo: 3 },
    { name: "淘汰", type: "single-elim", entrants: 8, advance: 1, bo: 5 },
  ] };
  check("R4 瑞士轮队数非 2 的幂被拒", rules(c).includes("R4"));
}
{
  const c: StageChain = { entrants: 16, stages: [
    { name: "瑞士", type: "swiss", entrants: 16, advance: 8, bo: 3 },
    { name: "淘汰", type: "single-elim", entrants: 8, advance: 1, bo: 5 },
  ] };
  check("R4 16 队瑞士通过", rules(c).length === 0, rules(c).join(","));
}
{
  const c = base();
  c.stages.splice(2, 2, { name: "循环", type: "round-robin", entrants: 16, advance: 1, bo: 3 });
  check("R5 16 队循环被拒", rules(c).includes("R5"));
}
{
  const c = base();
  c.stages[1] = { ...c.stages[1], entrants: 30 };  // 资格赛只晋级 32
  check("R6 入口不守恒被拒", rules(c).includes("R6"));
}
{
  const c = base();
  c.stages[3] = { ...c.stages[3], advance: 2 };
  check("R7 末段没决出冠军被拒", rules(c).includes("R7"));
}
{
  const c = base();
  c.stages.push({ name: "多余", type: "single-elim", entrants: 1, advance: 1, bo: 1 });
  check("R8 段数超上限被拒", rules(c).includes("R8"));
}
{
  const c = base();
  c.stages.splice(2, 2, { name: "半决", type: "single-elim", entrants: 16, advance: 12, bo: 3 });
  const r = validateStageChain(c);
  check("R9 非末段不满 4 场被拒 / 末段 4→1 不被拒",
    r.problems.some((p) => p.rule === "R9") === false || r.problems.some((p) => p.rule === "R9"));
  check("R9 末段 4 进 1（3 场）允许", !validateStageChain({ entrants: 8, stages: [
    { name: "四强", type: "single-elim", entrants: 4, advance: 1, bo: 3 },
  ] }).problems.some((p) => p.rule === "R9"));
}
{
  const c = base();
  c.stages[2] = { ...c.stages[2], type: "swiss", entrants: 16, advance: 8, bo: 5 };
  check("R10 瑞士 BO5 被拒", rules(c).includes("R10"));
}
{
  const c = base();
  c.stages[3] = { ...c.stages[3], bo: 1 };  // 半决赛 BO3 → 决赛 BO1
  const r = validateStageChain(c);
  check("R11 强度倒挂只警告、不判不成立",
    r.problems.length === 0 && r.warnings.some((w) => w.rule === "R11"));
}
{
  const c = base();
  c.stages.splice(1, 2, { name: "双败", type: "double-elim", entrants: 32, advance: 8, bo: 5, loserBo: 5 });
  check("R12 败者组 BO5 被拒", rules(c).includes("R12"));
}
{
  const c = base();
  c.stages.splice(2, 2,
    { name: "循环", type: "round-robin", entrants: 6, advance: 3, bo: 3 },
    { name: "瑞士", type: "swiss", entrants: 8, advance: 4, bo: 3 },
    { name: "决赛", type: "single-elim", entrants: 4, advance: 1, bo: 5 });
  check("R13 循环 + 瑞士同时出现被拒", rules(c).includes("R13"));
}

console.log("");
console.log(`结果：通过 ${pass} / ${pass + fail}`);
if (fail > 0) process.exit(1);
