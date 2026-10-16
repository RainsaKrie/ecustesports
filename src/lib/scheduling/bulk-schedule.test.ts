// =====================
// 批量排期规划器守卫（2026-10-16，P2）
// 运行：npm run test:bulk-schedule
//
// 为什么需要它：这个函数会**直接写比赛时间**，排错了就是两队白跑一趟。
// 所以把四条约束钉死：并发上限、时长正确、不越出比赛时段、确定性可复现。
// =====================

import { planBulkSchedule, applyBulkAssignments } from "./bulk-schedule";
import { DEFAULT_CONFIG, type SchedulingConfig } from "./rule-engine";
import type { ScheduleMatch } from "./schedule-data";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.log(`  ✗ ${name}${detail ? `（${detail}）` : ""}`); }
}
function group(title: string) {
  console.log("");
  console.log(`== ${title} ==`);
}

/** 固定配置：窗口 12:00–18:00（6 小时），并发 2，BO1=45 / BO3=90 */
const CONFIG: SchedulingConfig = {
  maxConcurrentMatches: 2,
  boDurations: { BO1: 45, BO3: 90, BO5: 150 },
  stageStart: "2026-10-20T12:00:00",
  stageEnd: "2026-10-20T18:00:00",
};

function match(id: string, boType: ScheduleMatch["boType"] = "BO1", over: Partial<ScheduleMatch> = {}): ScheduleMatch {
  return {
    id,
    phase: "小组赛",
    round: "A 组 半决赛",
    boType,
    teamAId: "A",
    teamBId: "B",
    teamAName: "甲",
    teamBName: "乙",
    startTime: "",
    endTime: "",
    status: "待排期",
    frozen: false,
    ...over,
  };
}

const minutesBetween = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 60_000;

group("组1 · 并发上限与时长");

const twoBo1 = planBulkSchedule([match("M1"), match("M2")], [], CONFIG);
check("2 场 BO1 都排上", twoBo1.assignments.length === 2 && twoBo1.skipped.length === 0);
check("2 场可以同时开始（不超并发 2）", twoBo1.assignments[0].startTime === twoBo1.assignments[1].startTime);
check(
  "BO1 时长 45 分钟",
  twoBo1.assignments.every((a) => minutesBetween(a.startTime, a.endTime) === 45),
  JSON.stringify(twoBo1.assignments.map((a) => minutesBetween(a.startTime, a.endTime))),
);

const threeBo1 = planBulkSchedule([match("M1"), match("M2"), match("M3")], [], CONFIG);
check("3 场时必须错开（并发上限 2）", threeBo1.assignments.length === 3);
check(
  "第 3 场被推到第 1 场结束之后",
  threeBo1.assignments[2].startTime === threeBo1.assignments[0].endTime,
  `${threeBo1.assignments[2].startTime} vs ${threeBo1.assignments[0].endTime}`,
);

const bo3Pair = planBulkSchedule([match("M1", "BO3"), match("M2", "BO3")], [], CONFIG);
check(
  "BO3 时长 90 分钟",
  bo3Pair.assignments.every((a) => minutesBetween(a.startTime, a.endTime) === 90),
  JSON.stringify(bo3Pair.assignments.map((a) => minutesBetween(a.startTime, a.endTime))),
);

group("组2 · 尊重已有排期");

const occupied = [match("E1", "BO3", { startTime: "2026-10-20T12:00:00", endTime: "2026-10-20T13:30:00", status: "已排期" })];
const withOccupied = planBulkSchedule([match("M1", "BO1")], occupied, CONFIG);
check(
  "已占 1 场时还可再排 1 场（并发仍为 2）",
  withOccupied.assignments.length === 1 && withOccupied.assignments[0].startTime === "2026-10-20T12:00:00",
  JSON.stringify(withOccupied.assignments),
);

const withTwoOccupied = planBulkSchedule(
  [match("M1", "BO1")],
  [...occupied, match("E2", "BO1", { startTime: "2026-10-20T12:00:00", endTime: "2026-10-20T12:45:00", status: "已排期" })],
  CONFIG,
);
check(
  "已有 2 场占用时，新场次等**最早**空出的时刻起（12:45，此时 E1 仍在打但并发仍为 2）",
  withTwoOccupied.assignments[0]?.startTime === "2026-10-20T12:45:00",
  String(withTwoOccupied.assignments[0]?.startTime),
);

group("组3 · 越界与确定性");

const overflow = planBulkSchedule(Array.from({ length: 20 }, (_, i) => match(`M${i + 1}`, "BO3")), [], CONFIG);
check("时段排不下的场次记为 skipped（不静默丢弃）", overflow.skipped.length > 0, `skipped=${overflow.skipped.length}`);
check("skipped 写明原因（点名比赛时段）", overflow.skipped.every((s) => s.reason.includes("比赛时段")));
check("排上的 + 跳过的 = 全部", overflow.assignments.length + overflow.skipped.length === 20);
check(
  "所有排上的场次都在窗口内",
  overflow.assignments.every(
    (a) => a.startTime >= CONFIG.stageStart && a.endTime <= CONFIG.stageEnd,
  ),
);

const again = planBulkSchedule(Array.from({ length: 20 }, (_, i) => match(`M${i + 1}`, "BO3")), [], CONFIG);
check("同一输入两次结果完全一致（确定性、可复现）", JSON.stringify(overflow) === JSON.stringify(again));

group("组4 · 套用到赛程");

const base = [match("M1"), match("M2"), match("M3", "BO1", { startTime: "2026-10-20T17:00:00", endTime: "2026-10-20T17:45:00", status: "已排期" })];
const applied = applyBulkAssignments(base, planBulkSchedule([match("M1")], base.filter((m) => m.startTime), CONFIG).assignments);
check("被排上的场次状态变为「已排期」", applied[0].status === "已排期" && applied[0].startTime !== "");
check("没被排的场次原样不动", applied[1].startTime === "" && applied[1].status === "待排期");
check("已有排期的场次不被改动", applied[2].startTime === "2026-10-20T17:00:00");

check(
  "默认配置也能跑（并发 2 / BO1 45 分钟）",
  planBulkSchedule([match("M1")], [], DEFAULT_CONFIG).assignments[0] !== undefined,
);

console.log("");
console.log(`结果：通过 ${pass} / ${pass + fail}`);
if (fail > 0) {
  console.error(`${fail} 项未通过`);
  process.exit(1);
}
