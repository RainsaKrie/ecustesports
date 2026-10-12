// =====================
// 整份保存赛程时的「成果丢失」护栏
//
// 背景（2026-10-12 复现确认）：管理端赛程页只在挂载时读一次，之后整份快照留着；
// 而裁判报分 / BP 完成 / 队长约赛三条路径都写 `schedule` 却不递增 `schedule.version`
// （报分路径不递增是刻意的：submitResultOp 用严格相等比对版本）。
// 结果：负责人随后做任意一次赛程操作保存，就会把裁判已报的赛果静默覆盖，两边都不报错。
//
// 本文件锁住三件事：
//   1. 判据正确（报丢失 / 不误报）。
//   2. 存储层真的会拦住那次覆盖。
//   3. 夹具**有区分度** —— 去掉护栏这条断言必须变红（否则测试恒真）。
// =====================

import { updateEventData, readEventData, deleteEventData } from "../data-store";
import {
  emptySchedule,
  normalizeScheduleState,
  type ScheduleState,
  type ScheduleMatch,
} from "./schedule-data";
import { applyScheduleSave, detectScheduleLosses } from "./schedule-ops";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    passed += 1;
    console.log(`✓ ${label}`);
  } else {
    failed += 1;
    console.error(`✗ ${label}`);
  }
}

/** 已完成、带 2 局比分与 BP 选图 —— 用来代表「别条路径写进去的成果」 */
function completedMatch(id: string): ScheduleMatch {
  return {
    id,
    phase: "资格赛",
    round: "资格赛",
    teamAId: "team-a",
    teamBId: "team-b",
    teamAName: "甲队",
    teamBName: "乙队",
    boType: "BO3",
    startTime: "2026-10-10T19:00:00",
    endTime: "2026-10-10T21:00:00",
    status: "已完成",
    frozen: false,
    gameResults: [
      { map: "Ascent", teamAScore: 13, teamBScore: 5 },
      { map: "Haven", teamAScore: 13, teamBScore: 9 },
    ],
    bpMaps: ["Ascent", "Haven"],
  };
}

/** 同一场比赛的「管理端旧快照」版本：还没报分 */
function staleMatch(id: string): ScheduleMatch {
  const base = completedMatch(id);
  const stale: ScheduleMatch = { ...base, status: "已排期" };
  delete stale.gameResults;
  delete stale.bpMaps;
  return stale;
}

function withMatches(version: number, matches: ScheduleMatch[]): ScheduleState {
  return { ...emptySchedule(), version, matches };
}

async function run(): Promise<void> {
  // ---------------------------------------------------------------
  console.log("== 组1 · 判据：什么算丢失 ==");

  {
    const losses = detectScheduleLosses([completedMatch("M1")], [staleMatch("M1")]);
    check("已完成 → 已排期：报丢失", losses.length === 1);
    check(
      "丢失项同时覆盖赛果、逐局比分与 BP 选图（三项都要点出来）",
      losses[0]?.lost.join("|") === "已完成赛果|逐局比分|BP 选图",
    );
  }

  {
    // 区分度对照：只有比分被抹掉，状态仍是已完成、BP 选图仍在
    const partial: ScheduleMatch = { ...completedMatch("M1"), gameResults: [] };
    const losses = detectScheduleLosses([completedMatch("M1")], [partial]);
    check("状态仍是已完成、但逐局比分被抹掉：仍报丢失", losses.length === 1);
    check(
      "且只报「逐局比分」（BP 选图没变，不得连带误报）",
      losses[0]?.lost.join("|") === "逐局比分",
    );
  }

  {
    // 区分度对照：完全相同的两份，必须不报
    const losses = detectScheduleLosses([completedMatch("M1")], [completedMatch("M1")]);
    check("两份完全相同：不报丢失（否则护栏会把正常保存全拦下）", losses.length === 0);
  }

  {
    // 区分度对照：正常补写（从无到有）必须不报
    const fresh: ScheduleMatch = { ...staleMatch("M1"), gameResults: [{ map: "Ascent", teamAScore: 13, teamBScore: 5 }] };
    const losses = detectScheduleLosses([staleMatch("M1")], [fresh]);
    check("正常补写比分（0 → 1 局）：不报丢失", losses.length === 0);
  }

  {
    // 口径边界：整场比赛消失不在本护栏范围（抽签导入 / 归档清空会走到这里）
    const losses = detectScheduleLosses([completedMatch("M1")], []);
    check("整场比赛消失：本护栏不管（交给归档与重置各自的版本记录）", losses.length === 0);
  }

  // ---------------------------------------------------------------
  console.log("\n== 组2 · 裁决：版本优先，其次内容 ==");

  {
    // 客户端手里是 v4，库里已是 v5 —— 这是原有的版本护栏场景
    const outcome = applyScheduleSave(withMatches(5, [completedMatch("M1")]), withMatches(4, [staleMatch("M1")]), 4);
    check("版本不一致：先按版本冲突处理", outcome.kind === "version-conflict");
  }

  {
    const outcome = applyScheduleSave(
      withMatches(5, [completedMatch("M1")]),
      withMatches(5, [staleMatch("M1")]),
      5,
    );
    check("版本一致但内容会丢成果：裁决为 loss", outcome.kind === "loss");
    check(
      "loss 里点名了是哪一场",
      outcome.kind === "loss" && outcome.losses[0]?.matchId === "M1",
    );
  }

  {
    const outcome = applyScheduleSave(
      withMatches(5, [completedMatch("M1")]),
      withMatches(5, [completedMatch("M1")]),
      5,
    );
    check("版本一致、内容无丢失：正常保存", outcome.kind === "saved");
    check("保存后版本号递增", outcome.kind === "saved" && outcome.state.version === 6);
  }

  // ---------------------------------------------------------------
  console.log("\n== 组3 · 存储层回归：复现原来那次静默覆盖 ==");

  const eventId = `test-schedule-loss-${process.pid}`;
  try {
    await updateEventData<ScheduleState>(eventId, "schedule", emptySchedule(), () =>
      withMatches(5, [{ ...staleMatch("M1"), endTime: "2026-10-10T21:00:00" }]),
    );

    // 管理端此刻加载页面，把这份快照与版本号留在内存里
    const adminSnapshot = normalizeScheduleState(
      await readEventData<ScheduleState>(eventId, "schedule", emptySchedule()),
    );
    const adminVersion = adminSnapshot.version;

    // 写入者 B：裁判报分落盘（不递增 version，与 reporting-data.ts 一致）
    await updateEventData<ScheduleState>(eventId, "schedule", emptySchedule(), (raw) => {
      const schedule = normalizeScheduleState(raw);
      return {
        ...schedule,
        matches: schedule.matches.map((match) => (match.id === "M1" ? completedMatch("M1") : match)),
      };
    });

    // 写入者 A：管理端保存旧快照 —— 走的就是路由现在用的那个裁决函数
    let verdict: string = "saved";
    await updateEventData<ScheduleState>(eventId, "schedule", emptySchedule(), (raw) => {
      const outcome = applyScheduleSave(normalizeScheduleState(raw), adminSnapshot, adminVersion);
      verdict = outcome.kind;
      if (outcome.kind !== "saved") throw new Error(`REJECTED:${outcome.kind}`);
      return outcome.state;
    }).catch(() => undefined);

    const final = normalizeScheduleState(await readEventData<ScheduleState>(eventId, "schedule", emptySchedule()));
    check("旧快照保存被拦下（修复前这里是 saved）", verdict === "loss");
    check(
      "裁判已报的赛果仍在库里",
      final.matches[0].status === "已完成" && (final.matches[0].gameResults?.length ?? 0) === 2,
    );
  } finally {
    await deleteEventData(eventId).catch(() => undefined);
  }

  // ---------------------------------------------------------------
  console.log("\n== 组4 · 变异验证：拿掉护栏后，同一步骤必须真的丢数据 ==");

  /**
   * 用**同一份夹具**再跑一遍存储层流程，但这次把 incoming 直接写下去（模拟「护栏被删掉」）。
   * 结论必须与组3 相反 —— 否则说明组3 不是被护栏救下的，而是夹具本身就没有区分度（测试恒真）。
   */
  const bypassEventId = `test-schedule-bypass-${process.pid}`;
  try {
    await updateEventData<ScheduleState>(bypassEventId, "schedule", emptySchedule(), () =>
      withMatches(5, [staleMatch("M1")]),
    );
    // 与组3 完全相同的两步：裁判先报分 → 管理端拿旧快照整份覆盖
    await updateEventData<ScheduleState>(bypassEventId, "schedule", emptySchedule(), (raw) => {
      const schedule = normalizeScheduleState(raw);
      return {
        ...schedule,
        matches: schedule.matches.map((match) => (match.id === "M1" ? completedMatch("M1") : match)),
      };
    });
    const staleSnapshot = withMatches(5, [staleMatch("M1")]);
    await updateEventData<ScheduleState>(bypassEventId, "schedule", emptySchedule(), () => staleSnapshot);

    const after = normalizeScheduleState(
      await readEventData<ScheduleState>(bypassEventId, "schedule", emptySchedule()),
    );
    check(
      "无护栏时，同一份夹具确实把赛果覆盖没了（证明夹具具备区分度）",
      after.matches[0].status === "已排期" && (after.matches[0].gameResults?.length ?? 0) === 0,
    );
    check(
      "有护栏时对同一份夹具的裁决是 loss（两者结论相反）",
      applyScheduleSave(withMatches(5, [completedMatch("M1")]), staleSnapshot, 5).kind === "loss",
    );
  } finally {
    await deleteEventData(bypassEventId).catch(() => undefined);
  }

  console.log(`\n${passed} 通过 / ${failed} 未通过`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
