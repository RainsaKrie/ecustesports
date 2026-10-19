// 瑞士轮 / 循环赛接进抽签端后的判定与生成（2026-10-19）
import { resolveSupportedFormat } from "./format-support.ts";
import { buildRoundRobinMatches, buildSwissMatches } from "./bracket-engine.ts";
import { buildBracketBlueprint } from "./bracket-blueprint.ts";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`); }
};
const stage = (type: "swiss" | "round-robin", teamCount: number) =>
  ({ name: type === "swiss" ? "瑞士轮" : "循环赛", type, teamCount, boType: "BO3" as const });
const name = (id: string) => `队${id}`;

console.log("== 判定 ==");
{
  const r = resolveSupportedFormat([stage("swiss", 16)]);
  check("16 队瑞士轮 → kind swiss", r.kind === "swiss", r.kind);
  check("24 队瑞士轮 → 不支持", resolveSupportedFormat([stage("swiss", 24)]).kind === "unsupported");
  check("4 队瑞士轮 → 不支持", resolveSupportedFormat([stage("swiss", 4)]).kind === "unsupported");
  const rr = resolveSupportedFormat([stage("round-robin", 5)]);
  check("5 队循环 → kind round-robin", rr.kind === "round-robin", rr.kind);
  check("10 队循环 → 不支持", resolveSupportedFormat([stage("round-robin", 10)]).kind === "unsupported");
}

console.log("== 生成 ==");
{
  const ids = Array.from({ length: 16 }, (_, i) => `T${String(i + 1).padStart(2, "0")}`);
  const swiss = buildSwissMatches(ids, name, { phase: "瑞士轮", boType: "BO3" });
  check("16 队瑞士轮第 1 轮 = 8 场", swiss.length === 8, `实际 ${swiss.length}`);
  check("瑞士轮每队出场一次", new Set(swiss.flatMap((m) => [m.teamAId, m.teamBId])).size === 16);
  check("瑞士轮场次都在第 1 轮", swiss.every((m) => m.round === "第 1 轮"));

  const four = ["A", "B", "C", "D"];
  const rr = buildRoundRobinMatches(four, name, { phase: "循环赛", boType: "BO1" });
  check("4 队循环 = 6 场", rr.length === 6, `实际 ${rr.length}`);
  check("循环每对恰好一次", new Set(rr.map((m) => [m.teamAId, m.teamBId].sort().join("|"))).size === 6);
}
{
  const blueprint = buildBracketBlueprint([stage("swiss", 16)]);
  check("blueprint 对瑞士轮能出对阵（不再掉进分组分支）", blueprint.length === 8, `实际 ${blueprint.length}`);
}

console.log("");
console.log(`结果：通过 ${pass} / ${pass + fail}`);
if (fail > 0) process.exit(1);
