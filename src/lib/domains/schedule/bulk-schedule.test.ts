// =====================
// 批量排期规划器守卫（2026-10-16，P2）
// 运行：npm run test:bulk-schedule
//
// 为什么需要它：这个函数会**直接写比赛时间**，排错了就是两队白跑一趟。
// 所以把四条约束钉死：并发上限、时长正确、不越出比赛时段、确定性可复现。
// =====================

import { planBulkSchedule, applyBulkAssignments } from "./bulk-schedule.ts";
import { DEFAULT_CONFIG, type SchedulingConfig } from "./rule-engine.ts";
import { scheduleModeOf, captainNegotiationRefusal, unscheduledAnomalyNotice } from "./schedule-mode.ts";
import { matchdayCandidates, schedulePlanInputFromEvent, partitionSchedulable } from "./schedule-policy.ts";
import type { ScheduleMatch } from "./schedule-data.ts";

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

group("组5 · 多个比赛日（真实赛事跨周末）");

const TWO_DAYS = [
  { start: "2026-10-17T12:00:00", end: "2026-10-17T18:00:00" },
  { start: "2026-10-18T12:00:00", end: "2026-10-18T18:00:00" },
];
const twelveBo3 = planBulkSchedule(Array.from({ length: 12 }, (_, i) => match(`M${i + 1}`, "BO3")), [], CONFIG, TWO_DAYS);
check("★ 12 场 BO3 跨两个比赛日全部排完（单日只能排 8 场）", twelveBo3.assignments.length === 12 && twelveBo3.skipped.length === 0,
  `排上 ${twelveBo3.assignments.length} / 跳过 ${twelveBo3.skipped.length}`);
check(
  "每天的场次数不超过单日容量（4 时段 × 并发 2 = 8）",
  ["2026-10-17", "2026-10-18"].every((d) => twelveBo3.assignments.filter((a) => a.startTime.startsWith(d)).length <= 8),
  JSON.stringify(["2026-10-17", "2026-10-18"].map((d) => twelveBo3.assignments.filter((a) => a.startTime.startsWith(d)).length)),
);
check(
  "★ 每场都落在自己那一天的窗口内（比赛不跨天）",
  twelveBo3.assignments.every((a) => {
    const day = TWO_DAYS.find((w) => a.startTime.startsWith(w.start.slice(0, 10)));
    return Boolean(day) && a.startTime >= day!.start && a.endTime <= day!.end;
  }),
);
check("第一天排满后才用第二天", twelveBo3.assignments.filter((a) => a.startTime.startsWith("2026-10-17")).length === 8);

const overflowTwoDays = planBulkSchedule(Array.from({ length: 20 }, (_, i) => match(`M${i + 1}`, "BO3")), [], CONFIG, TWO_DAYS);
check("整个赛期都排不下时才记 skipped", overflowTwoDays.assignments.length === 16 && overflowTwoDays.skipped.length === 4,
  `排上 ${overflowTwoDays.assignments.length} / 跳过 ${overflowTwoDays.skipped.length}`);
check("skipped 的原因点名比赛时段", overflowTwoDays.skipped.every((s) => s.reason.includes("比赛时段")));
check(
  "跨天排练也是确定性的",
  JSON.stringify(overflowTwoDays) === JSON.stringify(planBulkSchedule(Array.from({ length: 20 }, (_, i) => match(`M${i + 1}`, "BO3")), [], CONFIG, TWO_DAYS)),
);

group("组6 · 排期模式（固定模式下队伍侧没有协商入口）");

check("缺字段的老数据按「自由约赛」处理（行为不变）", scheduleModeOf({}) === "open" && scheduleModeOf(null) === "open");
check("只认 fixed 字面量，其它值一律退回 open", scheduleModeOf({ scheduleMode: "FIXED" }) === "open" && scheduleModeOf({ scheduleMode: "whatever" }) === "open");
check("fixed 被正确识别", scheduleModeOf({ scheduleMode: "fixed" }) === "fixed");
check("★ 自由约赛模式下允许队伍协商", captainNegotiationRefusal("open") === null);
const fixedRefusal = captainNegotiationRefusal("fixed");
check("★ 固定模式下拒绝队伍协商，且给出能照着做的中文", fixedRefusal !== null && fixedRefusal.includes("固定比赛时间") && fixedRefusal.includes("联系赛事负责人"));
check("★ 待排期的语义分流：固定模式下有未排定即为异常", (unscheduledAnomalyNotice("fixed", 3) ?? "").includes("3 场"));
check("自由约赛模式不把待排期当异常", unscheduledAnomalyNotice("open", 11) === null);
check("固定模式且无未排定则一切正常", unscheduledAnomalyNotice("fixed", 0) === null);

group("组7 · 当天上限 / 每队每日上限 / 场间间隔 / 逐日不同时段");

const limited = planBulkSchedule(
  Array.from({ length: 4 }, (_, i) => match(`M${i + 1}`, "BO1")),
  [],
  CONFIG,
  [{ start: "2026-10-20T12:00:00", end: "2026-10-20T18:00:00", limit: 2 }],
);
check("★ 当天上限 2：只排 2 场，其余记为排不下", limited.assignments.length === 2 && limited.skipped.length === 2,
  `排上 ${limited.assignments.length} / 跳过 ${limited.skipped.length}`);

const twoTeams = [
  match("A1", "BO1", { teamAId: "T1", teamBId: "T2" }),
  match("A2", "BO1", { teamAId: "T1", teamBId: "T3" }),
];
const withTeamLimit = planBulkSchedule(twoTeams, [], { ...CONFIG, perTeamDailyLimit: 1 }, TWO_DAYS);
check("★ 每队每日上限 1：同队第二场被挪到另一天（不排背靠背）",
  withTeamLimit.assignments.length === 2
    && withTeamLimit.assignments[0].startTime.slice(0, 10) !== withTeamLimit.assignments[1].startTime.slice(0, 10),
  JSON.stringify(withTeamLimit.assignments.map((a) => a.startTime)));

const withGap = planBulkSchedule(twoTeams, [], { ...CONFIG, gapMinutes: 60 }, TWO_DAYS);
const gapMinutes = Math.abs(
  (new Date(withGap.assignments[1].startTime).getTime() - new Date(withGap.assignments[0].endTime).getTime()) / 60_000,
);
check("场间间隔 60 分钟生效（同队两场之间留够休息）", gapMinutes >= 60, `${gapMinutes} 分钟`);

const unevenDays = [
  { start: "2026-10-20T10:00:00", end: "2026-10-20T12:00:00" },
  { start: "2026-10-21T14:00:00", end: "2026-10-21T16:00:00" },
];
const uneven = planBulkSchedule(Array.from({ length: 3 }, (_, i) => match(`M${i + 1}`, "BO3")), [], CONFIG, unevenDays);
check("★ 逐日不同时段：每场都落在自己那一天的窗口内（10 点场不进 14 点那天的窗口）",
  uneven.assignments.every((a) => {
    const day = unevenDays.find((w) => a.startTime.startsWith(w.start.slice(0, 10)));
    return Boolean(day) && a.startTime >= day!.start && a.endTime <= day!.end;
  }),
  JSON.stringify(uneven.assignments.map((a) => `${a.startTime}~${a.endTime}`)));

group("组8 · 从赛事配置推导排期参数（界面与脚本共用）");

// ★ 注入 now：不注入的话断言会随日期漂移（今天写的 10-17 明天就红了）
const NOW = new Date("2026-10-16T20:00:00");
const EVENT = { eventDateLabel: "比赛时间10.7-11.8", constraints: { maxConcurrent: 2, durations: { BO1: 45, BO3: 90, BO5: 150 }, sessionStart: "12:00", sessionEnd: "18:00" } };
check(
  "★ 比赛日候选 = 赛期内从明天起的周六周日（注入日期后结果稳定）",
  JSON.stringify(matchdayCandidates(EVENT, NOW).slice(0, 4)) === JSON.stringify(["2026-10-17", "2026-10-18", "2026-10-24", "2026-10-25"]),
  JSON.stringify(matchdayCandidates(EVENT, NOW)),
);

const derived = schedulePlanInputFromEvent(EVENT, { now: NOW });
check("推导出的窗口数与比赛日一致", derived.windows.length === matchdayCandidates(EVENT, NOW).length);
check("配置来自赛事约束（并发 2、BO3 90 分钟）", derived.config.maxConcurrentMatches === 2 && derived.config.boDurations.BO3 === 90);
check(
  "每个窗口都在当天 12:00–18:00",
  derived.windows.every((w) => w.start.endsWith("T12:00:00") && w.end.endsWith("T18:00:00")),
  JSON.stringify(derived.windows.slice(0, 2)),
);

const overridden = schedulePlanInputFromEvent(EVENT, { days: ["2026-11-07", "2026-11-08"] });
check(
  "显式指定比赛日时以它为准（覆盖自动生成）",
  JSON.stringify(overridden.windows.map((w) => w.start.slice(0, 10))) === JSON.stringify(["2026-11-07", "2026-11-08"]),
  JSON.stringify(overridden.windows),
);

const split = partitionSchedulable([
  { status: "待排期", teamAId: "A", teamBId: "B" },
  { status: "待排期", teamAId: "TBD", teamBId: "TBD" },
  { status: "已排期", teamAId: "C", teamBId: "D" },
]);
check("★ 参赛队未定的场次被分出去（排了必然改期）", split.schedulable.length === 1 && split.awaitingTeams.length === 1);
check("已排期的场次不参与本次排期", !split.schedulable.some((m) => m.status !== "待排期"));

console.log("");
console.log(`结果：通过 ${pass} / ${pass + fail}`);
if (fail > 0) {
  console.error(`${fail} 项未通过`);
  process.exit(1);
}
