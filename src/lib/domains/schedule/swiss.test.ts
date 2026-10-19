// 瑞士轮单测：轮数 / 全程无重赛 / 每轮人人出场 / 同分优先 / 非 2 的幂被拒。
import { pairSwissRound, swissRoundCount, applySwissRound, pairKey, type SwissState } from "./swiss.ts";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`); }
};
const teams = (n: number) => Array.from({ length: n }, (_, i) => `T${String(i + 1).padStart(2, "0")}`);

console.log("== 轮数 ==");
for (const [n, r] of [[8, 3], [16, 4], [32, 5]] as const) {
  check(`${n} 队 = ${r} 轮`, swissRoundCount(n) === r, `实际 ${swissRoundCount(n)}`);
}

console.log("== 非 2 的幂被拒（R4 的前提）==");
for (const n of [9, 12, 24]) {
  let threw = false;
  try { pairSwissRound(teams(n), { scores: {}, played: [], hadBye: [] }, 1); } catch { threw = true; }
  check(`${n} 队抛错而不是硬配`, threw);
}

/** 跑完整赛程，检查不重赛 / 每轮人人出场 / 轮数正确 */
function runFull(teamCount: number) {
  const ids = teams(teamCount);
  let state: SwissState = { scores: {}, played: [], hadBye: [] };
  const rounds = swissRoundCount(teamCount);
  const problems: string[] = [];
  for (let round = 0; round < rounds; round += 1) {
    const pairing = pairSwissRound(ids, state, round);
    const seen = new Set<string>();
    for (const [a, b] of pairing.pairs) {
      const key = pairKey(a, b);
      if (state.played.includes(key)) problems.push(`第 ${round + 1} 轮重赛 ${key}`);
      if (seen.has(a) || seen.has(b)) problems.push(`第 ${round + 1} 轮有人出场两次`);
      seen.add(a); seen.add(b);
    }
    if (seen.size !== teamCount) problems.push(`第 ${round + 1} 轮只覆盖 ${seen.size}/${teamCount} 队`);
    // 按 id 小的赢（确定性），保证每轮的战绩分布可复现
    state = applySwissRound(state, pairing, pairing.pairs.map(([a, b]) => (a < b ? a : b)));
  }
  return problems;
}

console.log("== 跑完整赛程 ==");
for (const n of [8, 16, 32]) {
  const problems = runFull(n);
  check(`${n} 队全程无重赛、每轮人人出场`, problems.length === 0, problems.slice(0, 3).join("；"));
}

console.log("== 同分优先 ==");
{
  const ids = teams(8);
  const state: SwissState = {
    scores: { T01: 1, T02: 1, T03: 1, T04: 1, T05: 0, T06: 0, T07: 0, T08: 0 },
    played: [],
    hadBye: [],
  };
  const pairing = pairSwissRound(ids, state, 1);
  check("1 胜组与 0 胜组各自互配", pairing.pairs.every(([a, b]) => state.scores[a] === state.scores[b]),
    pairing.pairs.map(([a, b]) => `${a}(${state.scores[a]})v${b}(${state.scores[b]})`).join(" "));
}

console.log("== 确定性 ==");
{
  const ids = teams(16);
  let state: SwissState = { scores: {}, played: [], hadBye: [] };
  state = applySwissRound(state, pairSwissRound(ids, state, 0), ids.filter((_, i) => i % 2 === 0));
  const a = JSON.stringify(pairSwissRound(ids, state, 1));
  const b = JSON.stringify(pairSwissRound(ids, state, 1));
  check("同一份战绩两次配对结果相同", a === b);
}

console.log("== 随机战绩路径（20 组）==");
{
  // 不只测"id 小的赢"这一条路径：随机决定胜负，检查任意战绩分布下都能配出无重赛对阵
  let seed = 42;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let worst = 0;
  for (let trial = 0; trial < 20; trial += 1) {
    const ids = teams(16);
    let state: SwissState = { scores: {}, played: [], hadBye: [] };
    for (let round = 0; round < 4; round += 1) {
      const pairing = pairSwissRound(ids, state, round);
      const seen = new Set<string>();
      for (const [x, y] of pairing.pairs) {
        if (state.played.includes(pairKey(x, y))) worst += 1;
        seen.add(x); seen.add(y);
      }
      if (seen.size !== 16) worst += 1;
      state = applySwissRound(state, pairing, pairing.pairs.map(([x, y]) => (rand() < 0.5 ? x : y)));
    }
  }
  check("20 组随机战绩全部无重赛、每轮人人出场", worst === 0, `问题数 ${worst}`);
}

console.log("");
console.log(`结果：通过 ${pass} / ${pass + fail}`);
if (fail > 0) process.exit(1);
