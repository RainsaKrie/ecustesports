// 入围赛轮空（Bye）测试：报名不足 32 队时，用轮空位补齐，仍能跑通 32 队赛制。

import assert from "node:assert/strict";

import { buildQualificationMatches, BYE, PENDING } from "./bracket-engine";
import { buildQualifierSlots, resolveStagedDrawGate, withPendingSlots } from "./staged-format";
import type { StageConfig } from "./format-templates";
import { appendMatchesOp, reportGameResultsOp } from "./schedule-ops";
import { emptySchedule } from "./schedule-data";

const stages: [StageConfig, StageConfig, StageConfig] = [
  { name: "入围赛", type: "single-elim", teamCount: 32, boType: "BO1" },
  { name: "小组赛", type: "gsl-groups", teamCount: 16, groupCount: 4, boType: "BO3" },
  { name: "淘汰赛", type: "double-elim", teamCount: 8, boType: "BO3" },
];

function makeIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `T-${index + 1}`);
}

let passed = 0;
function check(name: string, condition: boolean, detail?: string) {
  assert.ok(condition, detail ? `${name}（实际：${detail}）` : name);
  passed += 1;
  console.log(`✓ ${name}`);
}

// 1. 28 队构造 32 强签位：前 12 场真实对阵 + 后 4 场「真实 vs BYE」。
const slots = buildQualifierSlots(makeIds(28), 32, 16);
check("28 队产生 32 个签位", slots.length === 32);
check("签位含 4 个轮空", slots.filter((slot) => slot === BYE).length === 4);
check("轮空都落在客队位（奇数位）", slots.every((slot, index) => slot !== BYE || index % 2 === 1));

// 2. 生成对阵：跳过轮空，产出 12 场 + 4 个轮空晋级。
const built = buildQualificationMatches(slots, (id) => id, { phase: "入围赛", boType: "BO1", advancingTeams: 16 });
check("28 队入围赛生成 12 场", built.matches.length === 12);
check("4 支轮空队伍直接晋级", built.byes.length === 4);

// 3. 阶段门控：28 队可开入围赛；12 场赛果 + 4 轮空 = 16 队进小组赛。
const frozenIds = makeIds(28);
const initial = resolveStagedDrawGate(stages, frozenIds, []);
check("28 队开放入围赛抽签", initial.status === "ready" && initial.stageIndex === 0 && initial.entrantIds.length === 28);

let schedule = appendMatchesOp(emptySchedule(), built.matches, "入围赛抽签发布");
for (const match of built.matches) {
  schedule = reportGameResultsOp(schedule, match.id, [{ teamAScore: 13, teamBScore: 5 }]).state;
}
const groupGate = resolveStagedDrawGate(stages, frozenIds, schedule.matches, built.byes);
check("12 胜者 + 4 轮空 = 16 队进入小组赛", groupGate.status === "ready" && groupGate.stageIndex === 1 && groupGate.entrantIds.length === 16);

// 4. 不足 17 队应拒绝用 32 队赛制。
const underflow = resolveStagedDrawGate(stages, makeIds(16), []);
check("16 队拒绝 32 队赛制（提示降级）", underflow.status === "blocked" && underflow.message.includes("调整赛制"));

// ---------- 预留席位：资格赛还剩一场没打完时，先把其余席位抽掉 ----------
//
// 与上面「轮空」那一节的区别是这一组要钉死的：
//   缺的席位是**待定**（比赛照打，只是对手没定），不是**轮空**（直接晋级、不打）。
// 判据就是「16 场 + 0 轮空」，一旦退化成轮空，场次会掉到 15。
console.log("\n== 预留席位（资格赛未打完也能先抽）==");

const partialOrder = makeIds(31);
const lineupZero = withPendingSlots(partialOrder, 1, () => 0);
const lineupLast = withPendingSlots(partialOrder, 1, () => 0.999);
check("插入待定后长度正好等于总签位数", lineupZero.length === 32, String(lineupZero.length));
check("含且仅含 1 个待定占位", lineupZero.filter((id) => id === PENDING).length === 1);
check("待定位置随随机源变化（不是固定末尾）", lineupZero.indexOf(PENDING) !== lineupLast.indexOf(PENDING),
  `${lineupZero.indexOf(PENDING)} vs ${lineupLast.indexOf(PENDING)}`);

const partialSlots = buildQualifierSlots(lineupZero, 32, 16);
check("签位仍是 32 个", partialSlots.length === 32, String(partialSlots.length));
check("没有轮空（待定 ≠ 轮空）", partialSlots.filter((slot) => slot === BYE).length === 0);

const partialBuilt = buildQualificationMatches(partialSlots, (id) => (id === PENDING ? "待定（资格赛胜者）" : id), {
  phase: "入围赛",
  boType: "BO1",
  advancingTeams: 16,
});
check("生成 16 场（不是 15 场）", partialBuilt.matches.length === 16, String(partialBuilt.matches.length));
check("没有队伍被判轮空晋级", partialBuilt.byes.length === 0, String(partialBuilt.byes.length));
check("待定那场照常出现在赛程里", partialBuilt.matches.some((match) => match.teamAId === PENDING || match.teamBId === PENDING));

console.log(`\n${passed} qualifier-bye tests passed`);
