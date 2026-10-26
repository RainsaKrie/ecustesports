// =====================
// 赛事进度：判断「赛程是不是真的打完了」（2026-10-13）
// 运行：npm run test:event-progress
//
// 为什么需要它：管理端「赛事阶段」面板原先的判据是
//   `已完成的场次数 === 赛程里的总场次数`
// —— 它只数**赛程里当前已经存在的比赛**，完全没有「赛制后面还有阶段、对阵还没生成」这个概念。
//
// 后果（2026-10-13 负责人报的那个问题）：
//   本届是四阶段赛制（资格赛 → 入围赛 → 小组赛 → 淘汰赛），赛程在入围赛阶段只有 20 场
//   （资格赛 4 + 入围赛 16）。**只要 16 场入围赛全部录完就是 20/20**，
//   面板立刻改口说「全部比赛已完成」并把按钮换成「结束赛事」，
//   而小组赛与淘汰赛**一场都还没打**。服务端当时用的是同一条判据，所以点下去会真的结束赛事。
//
// 所以这里钉住：**「全部比赛完成」后面还要加一条 —— 赛制里每个阶段都已经有比赛。**
// 单阶段赛制（如 16 队单败）没有后续阶段，那种情况旧判据本来就对，第 3 组专门守住它不被改坏。
// =====================

import { resolveEventProgress, formatStageNames, completeEventRefusal } from "./event-progress.ts";
import { resolveSupportedFormat } from "./format-support.ts";
import type { FormatStageConfig } from "./format-templates.ts";
import type { MatchStatus, ScheduleMatch } from "./schedule-data.ts";

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

/** 只填判断用得上的字段，其余补成合法值（本模块不读队伍与时间） */
function match(phase: string, status: MatchStatus, index: number): ScheduleMatch {
  return {
    id: `M-${phase}-${index}`,
    phase,
    teamAId: "T-A",
    teamBId: "T-B",
    teamAName: "甲队",
    teamBName: "乙队",
    boType: "BO1",
    startTime: "",
    endTime: "",
    status,
    frozen: false,
  };
}

/** 真实线上用的那份模板：资格赛(8) → 入围赛(32) → 小组赛(16,GSL) → 淘汰赛(8,双败) */
const FOUR_STAGE: FormatStageConfig[] = [
  { name: "资格赛", type: "single-elim", teamCount: 8, boType: "BO1" },
  { name: "入围赛", type: "single-elim", teamCount: 32, boType: "BO1" },
  { name: "小组赛", type: "gsl-groups", teamCount: 16, groupCount: 4, boType: "BO3" },
  { name: "淘汰赛", type: "double-elim", teamCount: 8, boType: "BO3" },
];

const SINGLE_STAGE: FormatStageConfig[] = [
  { name: "淘汰赛", type: "single-elim", teamCount: 16, boType: "BO1" },
];

const GSL_THEN_KNOCKOUT: FormatStageConfig[] = [
  { name: "小组赛", type: "gsl-groups", teamCount: 16, groupCount: 4, boType: "BO3" },
  { name: "淘汰赛", type: "double-elim", teamCount: 8, boType: "BO3" },
];

/** 造一批同阶段的比赛 */
function stage(phase: string, count: number, status: MatchStatus): ScheduleMatch[] {
  return Array.from({ length: count }, (_, i) => match(phase, status, i));
}

/** 线上录完最后一场入围赛那一刻：资格赛 4 + 入围赛 16 全部完成，小组赛与淘汰赛一场都还没有 */
function afterPlayInMatches(): ScheduleMatch[] {
  return [...stage("资格赛", 4, "已完成"), ...stage("入围赛", 16, "已完成")];
}

// ── 组1 · 「现有比赛全完成」≠「赛事打完」（本次修复的核心）───────

group("组1 · 现有比赛全完成，但赛制还有阶段没开始 —— 不能算打完");

// 资格赛 4 场 + 入围赛 16 场，全部完成；小组赛与淘汰赛一场都还没有。
// 这正是线上录完最后一场入围赛那一刻的状态。
const afterPlayIn = resolveEventProgress(FOUR_STAGE, [
  ...stage("资格赛", 4, "已完成"),
  ...stage("入围赛", 16, "已完成"),
]);
check("20 场比赛全部完成 → allMatchesCompleted 为真", afterPlayIn.allMatchesCompleted);
check("但赛事**没有**打完（小组赛、淘汰赛还没开始）", afterPlayIn.finished === false);
check(
  "报出还没开始的阶段，按赛制顺序",
  JSON.stringify(afterPlayIn.stagesNotStarted) === JSON.stringify(["小组赛", "淘汰赛"]),
  JSON.stringify(afterPlayIn.stagesNotStarted),
);
check("下一个阶段是小组赛", afterPlayIn.nextStageName === "小组赛", String(afterPlayIn.nextStageName));

// 入围赛还没打完（线上 2026-10-13 的真实状态：资格赛 4/4、入围赛 6/16）
const midPlayIn = resolveEventProgress(FOUR_STAGE, [
  ...stage("资格赛", 4, "已完成"),
  ...stage("入围赛", 6, "已完成"),
  ...stage("入围赛", 9, "已排期"),
  match("入围赛", "待排期", 99),
]);
check("入围赛还没打完 → 不算全部完成", midPlayIn.allMatchesCompleted === false);
check("也不该说「赛事打完」", midPlayIn.finished === false);
check("此时下一个阶段仍是小组赛（供面板提前提示用）", midPlayIn.nextStageName === "小组赛");

// 四个阶段都出现过，且全部完成 —— 这才是真的打完了
const reallyDone = resolveEventProgress(FOUR_STAGE, [
  ...stage("资格赛", 4, "已完成"),
  ...stage("入围赛", 16, "已完成"),
  ...stage("小组赛", 20, "已完成"),
  ...stage("淘汰赛", 14, "已完成"),
]);
check("四个阶段都有比赛且全部完成 → finished 为真", reallyDone.finished === true);
check("没有未开始的阶段", reallyDone.stagesNotStarted.length === 0);

// 某个后续阶段已生成、但还没打完
const groupRunning = resolveEventProgress(FOUR_STAGE, [
  ...stage("资格赛", 4, "已完成"),
  ...stage("入围赛", 16, "已完成"),
  ...stage("小组赛", 12, "已完成"),
  ...stage("小组赛", 8, "已排期"),
]);
check("小组赛打了一半 → 不算打完，且未开始的只剩淘汰赛", groupRunning.finished === false
  && JSON.stringify(groupRunning.stagesNotStarted) === JSON.stringify(["淘汰赛"]),
  JSON.stringify(groupRunning.stagesNotStarted));

// ── 组2 · 阶段顺序：并入型的资格赛也要算进去 ───────────────

group("组2 · 赛制形态 → 阶段顺序");

check(
  "四阶段赛制：资格赛排在入围赛之前（并入型阶段不能漏）",
  JSON.stringify(formatStageNames(resolveSupportedFormat(FOUR_STAGE)))
    === JSON.stringify(["资格赛", "入围赛", "小组赛", "淘汰赛"]),
  JSON.stringify(formatStageNames(resolveSupportedFormat(FOUR_STAGE))),
);
check(
  "三阶段赛制（32 入围 + GSL + 双败）：三段都报出来",
  JSON.stringify(formatStageNames(resolveSupportedFormat(FOUR_STAGE.slice(1))))
    === JSON.stringify(["入围赛", "小组赛", "淘汰赛"]),
  JSON.stringify(formatStageNames(resolveSupportedFormat(FOUR_STAGE.slice(1)))),
);
check(
  "两阶段赛制（GSL 接双败）",
  JSON.stringify(formatStageNames(resolveSupportedFormat(GSL_THEN_KNOCKOUT)))
    === JSON.stringify(["小组赛", "淘汰赛"]),
);
check(
  "单阶段赛制只有一段",
  JSON.stringify(formatStageNames(resolveSupportedFormat(SINGLE_STAGE)))
    === JSON.stringify(["淘汰赛"]),
);

// ★ 四阶段里只打了资格赛就必须把资格赛算作「已开始」，否则 4 场打完会被误判成「赛事打完」
const onlyPlayInDone = resolveEventProgress(FOUR_STAGE, [...stage("资格赛", 4, "已完成")]);
check(
  "只打完资格赛 → 未开始的是入围赛/小组赛/淘汰赛（资格赛算已开始）",
  JSON.stringify(onlyPlayInDone.stagesNotStarted) === JSON.stringify(["入围赛", "小组赛", "淘汰赛"]),
  JSON.stringify(onlyPlayInDone.stagesNotStarted),
);

// ── 组3 · 单阶段赛制不能被改坏（旧判据在这些形态下本来就是对的）──

group("组3 · 单阶段与降级：旧判据仍然适用的情形");

const singleDone = resolveEventProgress(SINGLE_STAGE, [...stage("淘汰赛", 15, "已完成")]);
check("单阶段赛制、15 场全完成 → 算打完（没有后续阶段）", singleDone.finished === true);
check("单阶段赛制也不报「未开始的阶段」", singleDone.stagesNotStarted.length === 0);

const singlePartial = resolveEventProgress(SINGLE_STAGE, [
  ...stage("淘汰赛", 8, "已完成"),
  ...stage("淘汰赛", 7, "已排期"),
]);
check("单阶段赛制没打完 → 不算", singlePartial.finished === false);
check("单阶段赛制 none 未开始阶段（因为唯一阶段已开始）", singlePartial.stagesNotStarted.length === 0);

const noMatches = resolveEventProgress(FOUR_STAGE, []);
check("赛程为空 → 不算打完（一场都没打）", noMatches.finished === false);
check("赛程为空 → 按赛制顺序报出全部阶段未开始", noMatches.stagesNotStarted.length === 4);

const unsupported = resolveEventProgress([{ name: "怪赛制", type: "round-robin", teamCount: 5, boType: "BO1" }], [
  ...stage("怪赛制", 5, "已完成"),
]);
check(
  "识别不了的赛制 → 退回旧判据（只看比赛是否全完成），不把赛事卡死",
  unsupported.finished === true && unsupported.stagesNotStarted.length === 0,
  `finished=${unsupported.finished} stagesNotStarted=${JSON.stringify(unsupported.stagesNotStarted)}`,
);

// ── 组4 · 服务端「能不能结束赛事」的拒绝理由 ─────────────────

group("组4 · 结束赛事的服务端校验（面板不骗人与服务端拦得住是两件事）");

const noRequests: Array<{ status: string }> = [];

check(
  "赛程为空 → 拒绝",
  completeEventRefusal(FOUR_STAGE, { matches: [], requests: noRequests }) === "仍有比赛未完成，不能结束赛事",
);
check(
  "还有比赛没完成 → 拒绝",
  completeEventRefusal(FOUR_STAGE, {
    matches: [...stage("资格赛", 4, "已完成"), ...stage("入围赛", 6, "已完成"), ...stage("入围赛", 10, "已排期")],
    requests: noRequests,
  }) === "仍有比赛未完成，不能结束赛事",
);
check(
  "还有改期申请待处理 → 拒绝",
  completeEventRefusal(FOUR_STAGE, {
    matches: afterPlayInMatches(),
    requests: [{ status: "待审批" }],
  }) === "仍有改期申请待处理，不能结束赛事",
);
check(
  "★ 现有比赛全完成但赛制还有阶段未开始 → 拒绝并点名是哪几个阶段",
  completeEventRefusal(FOUR_STAGE, { matches: afterPlayInMatches(), requests: noRequests })
    === "赛制还有 2 个阶段未开始：小组赛、淘汰赛，不能结束赛事",
  String(completeEventRefusal(FOUR_STAGE, { matches: afterPlayInMatches(), requests: noRequests })),
);
check(
  "四个阶段都打完 → 放行（返回 null）",
  completeEventRefusal(FOUR_STAGE, {
    matches: [
      ...stage("资格赛", 4, "已完成"),
      ...stage("入围赛", 16, "已完成"),
      ...stage("小组赛", 20, "已完成"),
      ...stage("淘汰赛", 14, "已完成"),
    ],
    requests: noRequests,
  }) === null,
);
check(
  "单阶段赛制打完全部比赛 → 放行（不能被新校验卡住）",
  completeEventRefusal(SINGLE_STAGE, { matches: stage("淘汰赛", 15, "已完成"), requests: noRequests }) === null,
);

console.log("");
console.log(`结果：通过 ${pass} / ${pass + fail}`);
if (fail > 0) {
  console.error(`${fail} 项未通过`);
  process.exit(1);
}
