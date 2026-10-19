// 循环赛引擎单测：轮数 / 场次 / 每对恰好相遇一次 / 双循环主客互换。
import { buildRoundRobinRounds, roundRobinMatchCount } from "./round-robin.ts";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`); }
};
const teams = (n: number) => Array.from({ length: n }, (_, i) => `T${i + 1}`);
/** 所有配对的无序键，用于检查"每对恰好一次" */
const pairKey = (a: string, b: string) => [a, b].sort().join("|");

console.log("== 基本形状 ==");
for (const n of [4, 5, 6, 8]) {
  const rounds = buildRoundRobinRounds(teams(n));
  const all = rounds.flat();
  const expected = roundRobinMatchCount(n);
  check(`${n} 队单循环 = ${expected} 场`, all.length === expected, `实际 ${all.length}`);
  check(`${n} 队轮数 = ${n % 2 === 0 ? n - 1 : n}`, rounds.length === (n % 2 === 0 ? n - 1 : n), `实际 ${rounds.length}`);
  const keys = all.map((m) => pairKey(m.teamAId, m.teamBId));
  check(`${n} 队每对恰好相遇一次`, new Set(keys).size === keys.length && keys.length === expected);
  const involved = new Set(all.flatMap((m) => [m.teamAId, m.teamBId]));
  check(`${n} 队每队都参赛`, involved.size === n, `实际 ${involved.size}`);
}

console.log("== 奇数队：轮空不产生场次 ==");
{
  const rounds = buildRoundRobinRounds(teams(5));
  check("5 队每轮 2 场（第三个是轮空）", rounds.every((r) => r.length === 2), rounds.map((r) => r.length).join(","));
  check("5 队没有任何配对含轮空占位", rounds.flat().every((m) => m.teamAId.startsWith("T") && m.teamBId.startsWith("T")));
}

console.log("== 双循环 ==");
{
  const rounds = buildRoundRobinRounds(teams(4), { doubleRound: true });
  const all = rounds.flat();
  check("4 队双循环 = 12 场", all.length === 12, `实际 ${all.length}`);
  const first = all.slice(0, 6).map((m) => `${m.teamAId}>${m.teamBId}`);
  const second = all.slice(6).map((m) => `${m.teamAId}>${m.teamBId}`);
  check("双循环第二轮是主客互换", first.every((k) => {
    const [a, b] = k.split(">");
    return second.includes(`${b}>${a}`);
  }), `${first.join(",")} vs ${second.join(",")}`);
}

console.log("== 边界 ==");
check("1 队返回空", buildRoundRobinRounds(teams(1)).length === 0);
check("重复 ID 自动去重", buildRoundRobinRounds(["T1", "T1", "T2"]).flat().length === 1);
check("group 会写到每个配对", buildRoundRobinRounds(teams(3), { group: "A组" }).flat().every((m) => m.group === "A组"));

console.log("");
console.log(`结果：通过 ${pass} / ${pass + fail}`);
if (fail > 0) process.exit(1);
