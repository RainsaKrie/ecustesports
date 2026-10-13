import assert from "node:assert/strict";
import { getStageGuidance, type StageGuidanceInput } from "./operations-data";
import { STAGE_CONFIGS } from "./scheduling/stage";

const base: StageGuidanceInput = {
  eventId: "event-test",
  visibility: "public",
  publishIssues: [],
  activeTeamCount: 16,
  confirmedTeamCount: 16,
  requiredTeamCount: 16,
  pendingReviewCount: 0,
  hasFormat: false,
  matchCount: 0,
  unscheduledMatchCount: 0,
  completedMatchCount: 0,
  stagesNotStarted: [],
  raceFinished: false,
  pendingRescheduleCount: 0,
  publicContentIssues: [],
};

const preparation = getStageGuidance("筹备", {
  ...base,
  visibility: "private",
  publishIssues: ["赛事简介至少 10 个字"],
});
assert.equal(preparation.actionLabel, "补齐赛事设置");
assert.deepEqual(preparation.blockers, ["赛事简介至少 10 个字", "赛事尚未发布，玩家侧当前不可访问"]);

const preparationReady = getStageGuidance("筹备", base);
assert.equal(preparationReady.actionLabel, "进入报名阶段");
assert.equal(preparationReady.actionKind, "open-registration");

const registration = getStageGuidance("报名", {
  ...base,
  activeTeamCount: 9,
  confirmedTeamCount: 6,
  pendingReviewCount: 3,
});
assert.equal(registration.actionLabel, "处理 3 名资料待修改的选手");
assert.equal(registration.actionHref, "/admin/events/event-test/registration");

const rosterReady = getStageGuidance("报名", base);
assert.equal(rosterReady.actionLabel, "结束报名并进入分组");
assert.equal(rosterReady.actionKind, "close-registration");
assert.equal(rosterReady.actionHref, "/admin/events/event-test/schedule/draw");

const grouping = getStageGuidance("分组", { ...base, confirmedTeamCount: 12 });
assert.equal(grouping.actionLabel, "返回确认正式名单");
assert.ok(grouping.blockers.some((item) => item.includes("12/16")));

const ongoing = getStageGuidance("比赛", {
  ...base,
  matchCount: 34,
  unscheduledMatchCount: 8,
  completedMatchCount: 10,
  pendingRescheduleCount: 2,
});
assert.equal(ongoing.actionLabel, "处理改期申请");
assert.equal(ongoing.blockers[0], "2 条改期申请待处理");

const finishing = getStageGuidance("比赛", { ...base, matchCount: 34, completedMatchCount: 34, raceFinished: true });
assert.equal(finishing.actionLabel, "结束赛事");
assert.equal(finishing.actionKind, "complete-event");
assert.equal(finishing.actionHref, "/admin/events/event-test/settings");

// ★ 2026-10-13 修的那个问题：四阶段赛制录完入围赛 —— 现有比赛全完成（20/20），
// 但小组赛与淘汰赛还没开始。这时**绝不能**推出「结束赛事」，而应引导去抽下一阶段的签。
const awaitGroupStage = getStageGuidance("比赛", {
  ...base,
  matchCount: 20,
  completedMatchCount: 20,
  stagesNotStarted: ["小组赛", "淘汰赛"],
  raceFinished: false,
});
assert.equal(awaitGroupStage.actionLabel, "开始小组赛抽签");
assert.equal(awaitGroupStage.actionHref, "/admin/events/event-test/schedule/draw");
assert.equal(awaitGroupStage.actionKind, undefined, "还有后续阶段时不得给出 complete-event");
assert.ok(
  awaitGroupStage.blockers.some((item) => item.includes("2 个阶段未开始") && item.includes("小组赛、淘汰赛")),
  `应说明是哪几个阶段未开始，实际：${JSON.stringify(awaitGroupStage.blockers)}`,
);
assert.ok(
  !awaitGroupStage.blockers.some((item) => item.includes("全部比赛已完成")),
  "现有比赛全完成但赛制未完时，不能说「全部比赛已完成」",
);

const postEventUpdate = getStageGuidance("赛后", {
  ...base,
  publicContentIssues: ["首页赛事简介仍为赛前内容", "页脚状态仍为赛前内容"],
});
assert.equal(postEventUpdate.actionLabel, "更新官网赛后内容");
assert.equal(postEventUpdate.actionHref, "/admin/site-content?eventId=event-test");
assert.equal(postEventUpdate.blockers.length, 2);

const playerStageExpectations = {
  筹备: ["查看竞赛规程", "赛事手册"],
  报名: ["提交参赛报名", "队伍名单"],
  分组: ["查看分组对阵", "对阵图"],
  比赛: ["查看赛事赛程", "赛程"],
  赛后: ["查看最终赛果", "赛程"],
} as const;

for (const [stage, [cta, defaultTab]] of Object.entries(playerStageExpectations)) {
  const config = STAGE_CONFIGS[stage as keyof typeof STAGE_CONFIGS];
  assert.equal(config.cta, cta);
  assert.equal(config.defaultTab, defaultTab);
  assert.ok(config.title.length > 0 && config.description.length > 0);
}

console.log("16/16 admin and player stage guidance checks passed");
