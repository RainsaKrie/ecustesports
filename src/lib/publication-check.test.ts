import assert from "node:assert/strict";
import { canPublish, publicationChecklist } from "./publication-check";
import { DEFAULT_SITE_CONFIG, type EditableEvent } from "./site-config-schema";

function fixture(patch: Partial<EditableEvent> = {}): EditableEvent {
  return structuredClone({ ...DEFAULT_SITE_CONFIG.events[0], ...patch });
}

const draft = fixture();
assert.equal(canPublish(draft), true, "筹备中的完整赛事可先公开预告");

const missingDescription = fixture({ description: "短" });
assert.equal(canPublish(missingDescription), false, "简介过短时禁止发布");
assert.equal(publicationChecklist(missingDescription).find((item) => item.key === "description")?.ok, false);

const registration = fixture({ status: "registration", registrationStart: "2026-09-01", registrationEnd: "2026-08-30", teamRegistrationEnd: "2026-09-05" });
assert.equal(canPublish(registration), false, "报名日期顺序错误时禁止发布");

const readyRegistration = fixture({ status: "registration", registrationStart: "2026-08-01", registrationEnd: "2026-08-30", teamRegistrationEnd: "2026-09-05" });
assert.equal(canPublish(readyRegistration), true, "报名日期完整且顺序正确时允许发布");

const unconfirmedPenalty = fixture({
  rules: fixture().rules.map((rule, index) => index === 0
    ? { ...rule, emphasis: "warning", confirmed: false }
    : rule),
});
assert.equal(canPublish(unconfirmedPenalty), false, "处罚条款未经负责人确认时禁止发布");
assert.equal(publicationChecklist(unconfirmedPenalty).find((item) => item.key === "rule-review")?.ok, false);

const confirmedPenalty = fixture({
  rules: unconfirmedPenalty.rules.map((rule) => ({ ...rule, confirmed: true })),
});
assert.equal(canPublish(confirmedPenalty), true, "处罚条款确认后允许发布");

console.log("7/7 publication checks passed");
