// 入围赛轮空（Bye）测试：报名不足 32 队时，用轮空位补齐，仍能跑通 32 队赛制。

import assert from "node:assert/strict";

import { buildQualificationMatches, BYE } from "./bracket-engine";
import { buildQualifierSlots, resolveStagedDrawGate } from "./staged-format";
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
function check(name: string, condition: boolean) {
  assert.ok(condition, name);
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

console.log(`\n${passed} qualifier-bye tests passed`);
