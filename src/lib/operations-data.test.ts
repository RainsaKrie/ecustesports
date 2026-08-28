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
assert.equal(registration.actionLabel, "审核 3 名选手");
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

const finishing = getStageGuidance("比赛", { ...base, matchCount: 34, completedMatchCount: 34 });
assert.equal(finishing.actionLabel, "结束赛事");
assert.equal(finishing.actionKind, "complete-event");
assert.equal(finishing.actionHref, "/admin/events/event-test/settings");

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
