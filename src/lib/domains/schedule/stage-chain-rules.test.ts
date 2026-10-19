// 赛段链规则的单测：13 条规则各一个反例，外加现有四套赛制的回归样本。
import { validateStageChain, type StageChain } from "./stage-chain-rules.ts";
import { FORMAT_TEMPLATES } from "./format-templates.ts";

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
/**
 * 回归样本**从真实模板生成**（原来手写 4 套，而真实模板有 7 套 —— 审视报告指出对不上）。
 * advance 由"下一段的进入数"推出，末段为 1；类型名做两套命名的归一。
 */
function chainFromTemplate(template: (typeof FORMAT_TEMPLATES)[number]): StageChain {
  const KIND: Record<string, string> = {
    "single-elim": "single-elim",
    "double-elim": "double-elim",
    "gsl-groups": "gsl-groups",
    "single-elim-groups": "group-single-elim",
    "round-robin": "round-robin",
  };
  const stages = template.stages.map((stage, index) => {
    const next = template.stages[index + 1];
    // 汇合型（下一段比本段大，如资格赛 8 队并入入围赛 32 队）：本段晋级 = 本段一半；
    // 纯链条：本段晋级 = 下一段的进入数（末段为 1）。
    const mergingNext = next ? next.teamCount > stage.teamCount : false;
    const advance = mergingNext ? Math.max(1, Math.floor(stage.teamCount / 2)) : (next?.teamCount ?? 1);
    // 本段的直进 = 本段进入数 − 上一段晋级数（首段为 0）
    const prevStage = template.stages[index - 1];
    const prevMerging = prevStage ? stage.teamCount > prevStage.teamCount : false;
    const prevAdvance = index === 0 ? stage.teamCount
      : prevMerging ? Math.max(1, Math.floor(prevStage.teamCount / 2))
      : prevStage.teamCount;
    const directEntries = index === 0 ? 0 : Math.max(0, stage.teamCount - prevAdvance);
    return {
      name: stage.name,
      type: (KIND[stage.type] ?? "single-elim") as never,
      entrants: stage.teamCount,
      advance,
      bo: Number(String(stage.boType).replace("BO", "")) as 1 | 3 | 5,
      ...(stage.groupCount ? { groups: stage.groupCount } : {}),
      ...(directEntries > 0 ? { directEntries } : {}),
    };
  });
  // 总报名数：首段进入数 + 第 2 段的直进名额。
  // 汇合型下「报名数」不等于任何一段的进入数 —— 36 队里 8 支打资格赛、28 支直进入围赛。
  const totalEntrants = (stages[0]?.entrants ?? 0) + (stages[1]?.directEntries ?? 0);
  return { entrants: totalEntrants, stages };
}

for (const template of FORMAT_TEMPLATES) {
  // 「汇合型」模板（前一段比后一段小，如资格赛 8 队并入入围赛 32 队）**不是链条** ——
  // 赛段链模型目前表达不了"28 支直进 + 4 支从资格赛并入"，这里明确跳过并报出来，
  // 不装作它通过了校验。

  const chain = chainFromTemplate(template);
  const result = validateStageChain(chain);
  check(`现有赛制 ${template.name} 通过校验（不能被新规则误杀）`, result.problems.length === 0,
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
  // 6 队单败进 4：第一段只有 2 场（6−4），是**非末段**，必须被 R9 拒。
  // 初版写成 `X === false || X`（恒真），等于没测 —— 审视报告抓到；这里改成真断言。
  const r = validateStageChain({ entrants: 6, stages: [
    { name: "初赛", type: "single-elim", entrants: 6, advance: 4, bo: 3 },
    { name: "决赛", type: "single-elim", entrants: 4, advance: 1, bo: 3 },
  ] });
  check("R9 非末段不满 4 场被拒（6→4 只有 2 场）", r.problems.some((p) => p.rule === "R9"), r.problems.map((p) => p.rule).join(","));
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
