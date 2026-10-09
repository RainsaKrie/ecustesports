// =====================
// 排程校验规则引擎测试（20 案例：10 可行 + 10 冲突）
// 运行：node src/lib/scheduling/rule-engine.test.ts
// =====================

import {
  validateReschedule,
  DEFAULT_CONFIG,
} from "./rule-engine.ts";
import type {
  ScheduledMatch,
  RescheduleRequest,
  SchedulingConfig,
} from "./rule-engine.ts";

function B(
  id: string,
  a: string,
  b: string,
  start: string,
  end: string,
  extra: Partial<ScheduledMatch> = {},
): ScheduledMatch {
  return { id, teamAId: a, teamBId: b, boType: "BO3", startTime: start, endTime: end, frozen: false, ...extra };
}

const M1 = B("M1", "A", "B", "2026-10-06T12:00:00", "2026-10-06T13:30:00");
const M2 = B("M2", "C", "D", "2026-10-06T14:00:00", "2026-10-06T15:30:00");
const M3 = B("M3", "E", "F", "2026-10-06T12:00:00", "2026-10-06T13:30:00");
const M4 = B("M4", "G", "H", "2026-10-06T16:00:00", "2026-10-06T17:30:00");
const N1 = B("N1", "winner-M1", "X", "2026-10-09T00:00:00", "2026-10-09T01:30:00", { prerequisiteMatchId: "M1" });

// 冲突案例额外比赛
const G_at_14 = B("M5", "G", "I", "2026-10-06T14:00:00", "2026-10-06T15:30:00");
const H_at_14 = B("M6", "H", "J", "2026-10-06T14:00:00", "2026-10-06T15:30:00");
const K_at_16 = B("M7", "K", "L", "2026-10-06T16:00:00", "2026-10-06T17:30:00");
const G_at_12 = B("M8", "G", "K", "2026-10-06T12:00:00", "2026-10-06T13:30:00");

const currentVersion = 2;
const config: SchedulingConfig = DEFAULT_CONFIG;

interface TestCase {
  id: string;
  matches: ScheduledMatch[];
  request: RescheduleRequest;
  expectedApproved: boolean;
  expectedPrimary?: string;
}

const M4_OK: RescheduleRequest = {
  matchId: "M4",
  newStartTime: "2026-10-07T12:00:00",
  teamAConfirmed: true,
  teamBConfirmed: true,
  basedOnVersion: 2,
};

const cases: TestCase[] = [
  // ---- 可行案例（10） ----
  { id: "F-1", matches: [M1, M2, M3, M4], request: M4_OK, expectedApproved: true },
  { id: "F-2", matches: [M1, M2, M3, M4], request: { ...M4_OK, newStartTime: "2026-10-06T14:00:00" }, expectedApproved: true },
  { id: "F-3", matches: [M1, M2, M3, M4], request: { ...M4_OK, newStartTime: "2026-10-08T16:30:00" }, expectedApproved: true },
  { id: "F-4", matches: [M1, M2, M3, M4, N1], request: { matchId: "N1", newStartTime: "2026-10-06T14:00:00", teamAConfirmed: true, teamBConfirmed: true, basedOnVersion: 2 }, expectedApproved: true },
  { id: "F-5", matches: [M1, M2, M3, M4], request: { ...M4_OK, newStartTime: "2026-10-07T15:00:00" }, expectedApproved: true },
  { id: "F-6", matches: [M1, M2, M3, M4], request: M4_OK, expectedApproved: true },
  { id: "F-7", matches: [M1, M2, M3, M4], request: M4_OK, expectedApproved: true },
  { id: "F-8", matches: [M1, M2, M3, M4], request: { ...M4_OK, newStartTime: "2026-10-07T16:00:00" }, expectedApproved: true },
  { id: "F-9", matches: [M1, M2, M3, M4], request: M4_OK, expectedApproved: true },
  { id: "F-10", matches: [M1, M2, M3, M4], request: { ...M4_OK, newStartTime: "2026-10-08T14:00:00" }, expectedApproved: true },

  // ---- 冲突案例（10） ----
  { id: "C-1", matches: [M1, M3, M4, G_at_14], request: { ...M4_OK, newStartTime: "2026-10-06T14:00:00" }, expectedApproved: false, expectedPrimary: "HC-04" },
  { id: "C-2", matches: [M1, M4, N1], request: { matchId: "N1", newStartTime: "2026-10-06T12:30:00", teamAConfirmed: true, teamBConfirmed: true, basedOnVersion: 2 }, expectedApproved: false, expectedPrimary: "HC-05" },
  { id: "C-3", matches: [M1, M2, M3, M4], request: { ...M4_OK, newStartTime: "2026-10-06T12:00:00" }, expectedApproved: false, expectedPrimary: "HC-06" },
  { id: "C-4", matches: [M1, M2, M3, M4], request: { ...M4_OK, newStartTime: "2026-10-09T14:00:00" }, expectedApproved: false, expectedPrimary: "HC-07" },
  { id: "C-5", matches: [M1, M2, M3, { ...M4, frozen: true }], request: M4_OK, expectedApproved: false, expectedPrimary: "HC-08" },
  // C-6 原为「申请基于旧版本 → 不能批准（HC-01）」。
  // 2026-10-09 起不再按版本号拦截：版本号是全局的，申请从提交到负责人批复之间
  // 赛程几乎一定变过，按它拦截会**必然误报**，还会把真正的冲突盖掉。
  // 现在这个申请应当通过（它提的时间本身不与现有排程冲突）；
  // 真实冲突仍由 HC-05（时间重叠）/ HC-07（越界）负责，见 C-2、C-9。
  { id: "C-6", matches: [M1, M2, M3, M4], request: { ...M4_OK, basedOnVersion: 1 }, expectedApproved: true },
  { id: "C-7", matches: [M1, M2, M3, M4], request: { ...M4_OK, teamBConfirmed: false }, expectedApproved: false, expectedPrimary: "HC-02" },
  { id: "C-8", matches: [M1, M3, M2, M4, K_at_16], request: { matchId: "M2", newStartTime: "2026-10-06T16:00:00", teamAConfirmed: true, teamBConfirmed: true, basedOnVersion: 2 }, expectedApproved: false, expectedPrimary: "HC-06" },
  { id: "C-9", matches: [M1, M3, M4, H_at_14], request: { ...M4_OK, newStartTime: "2026-10-06T14:00:00" }, expectedApproved: false, expectedPrimary: "HC-04" },
  { id: "C-10", matches: [M1, M2, M3, M4, G_at_12], request: { ...M4_OK, newStartTime: "2026-10-06T12:00:00" }, expectedApproved: false, expectedPrimary: "HC-06" },
];

let pass = 0;
let fail = 0;
for (const c of cases) {
  const result = validateReschedule(c.request, c.matches, currentVersion, config);
  const ok = result.approved === c.expectedApproved &&
    (!c.expectedPrimary || result.primaryConflict === c.expectedPrimary);
  if (ok) {
    pass++;
    console.log(`  ✓ ${c.id}`);
  } else {
    fail++;
    console.log(`  ✗ ${c.id}`);
    console.log(`    期望 approved=${c.expectedApproved} primary=${c.expectedPrimary ?? "-"}`);
    console.log(`    实际 approved=${result.approved} primary=${result.primaryConflict || "-"}`);
    if (result.conflicts.length) {
      console.log(`    conflicts=${result.conflicts.map((x) => x.code).join(",")}`);
    }
  }
}

console.log(`\n结果：通过 ${pass} / ${pass + fail}`);
if (fail > 0) {
  process.exit(1);
}
