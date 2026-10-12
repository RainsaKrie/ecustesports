// =====================
// 裁判接口失败映射的守卫测试
// 运行：npm run test:referee-failure
//
// 为什么这些几行的映射值得单独测：
//   这一批之前，同一个「凭证失效」在四个接口上有两种表现 —— claim/upload/matches 回 401，
//   submit 回 400，而且把内部码 `INVALID_CREDENTIAL` 直接当成提示文案显示给裁判。
//   裁判看到的是一串大写英文，不知道该重新登录；负责人也不知道该不该重置凭证。
//
// 所以这里把三件事钉住：
//   1. 哪些码算「未授权」→ 401（逐个枚举，不靠抽样）
//   2. 每一档都要有**中文**文案，且文案绝不能是内部码本身
//   3. 未登记的码保留领域层原文（别把上传格式不符那句也换掉 —— 端到端脚本按它断言过）
// =====================

import {
  refereeFailureMessage,
  refereeFailureStatus,
} from "./failure-response";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `（${detail}）` : ""}`); }
}

/** 内部码的样子：全大写字母与下划线。提示文案绝不能长这样。 */
const LOOKS_LIKE_INTERNAL_CODE = /^[A-Z][A-Z0-9_]*$/;

/** 领域层会返回的、需要 401 的失败码（与 referee-domain 的联合类型对齐）。 */
const AUTH_CODES = ["INVALID_CREDENTIAL", "DISABLED", "EXPIRED", "WRONG_EVENT", "NOT_ASSIGNED"];

console.log("== 组1 · 未授权类失败码逐个判成 401 ==");
for (const code of AUTH_CODES) {
  check(`${code} → 401`, refereeFailureStatus(code) === 401, String(refereeFailureStatus(code)));
}
// 反面：不带凭证时上游可能给空特征，不能把「没有码」当成未授权（那属于校验失败）
check("空码 → 400（不是未授权）", refereeFailureStatus(undefined) === 400 && refereeFailureStatus("") === 400);

console.log("\n== 组2 · 正常竞争结果走 extra，且优先于默认 ==");
check("MATCH_TAKEN → 409（已被人认领是正常结果）", refereeFailureStatus("MATCH_TAKEN", { MATCH_TAKEN: 409 }) === 409);
check("MATCH_CHANGED → 409（对阵已变更）", refereeFailureStatus("MATCH_CHANGED", { MATCH_CHANGED: 409 }) === 409);
check(
  "extra 优先：即使码同时属于未授权类",
  refereeFailureStatus("NOT_ASSIGNED", { NOT_ASSIGNED: 403 }) === 403,
  String(refereeFailureStatus("NOT_ASSIGNED", { NOT_ASSIGNED: 403 })),
);
check("extra 不含的码不受影响", refereeFailureStatus("EXPIRED", { MATCH_TAKEN: 409 }) === 401);

console.log("\n== 组3 · 其余失败码仍是 400（校验类） ==");
for (const code of ["EVIDENCE_NOT_FOUND", "EVIDENCE_MATCH_MISMATCH", "SIGNATURE_MISMATCH", "BO_NOT_COMPLETE", "不知道的码"]) {
  check(`${code} → 400`, refereeFailureStatus(code) === 400, String(refereeFailureStatus(code)));
}

console.log("\n== 组4 · ★ 每一档未授权失败都要有中文文案，且不能是内部码 ==");
for (const code of AUTH_CODES) {
  const message = refereeFailureMessage(code, "兜底文案");
  check(`${code} 有文案`, message.length > 0);
  check(`${code} 的文案不是内部码`, !LOOKS_LIKE_INTERNAL_CODE.test(message), message);
  check(`${code} 的文案含中文`, /[\u4e00-\u9fa5]/.test(message), message);
  // 关键一条：必须告诉裁判「下一步做什么」，否则等于没说
  check(`${code} 的文案给出了下一步`, /重新登录|联系负责人|索取|确认赛事/.test(message), message);
}

console.log("\n== 组5 · 未登记的码保留领域层原文（不要顺手换掉被断言的文案） ==");
check(
  "SIGNATURE_MISMATCH 保留原文",
  refereeFailureMessage("SIGNATURE_MISMATCH", "图片格式与后缀不一致") === "图片格式与后缀不一致",
);
check("没码时用兜底", refereeFailureMessage(undefined, "自定义兜底") === "自定义兜底");
check("码与兜底都没有时给一句通用话", refereeFailureMessage(undefined, undefined) === "操作失败");
check(
  "已登记的码不会被兜底覆盖",
  refereeFailureMessage("INVALID_CREDENTIAL", "原始内部码") !== "原始内部码",
  refereeFailureMessage("INVALID_CREDENTIAL", "原始内部码"),
);

console.log(`\n${pass} 通过 / ${fail} 未通过`);
if (fail > 0) process.exitCode = 1;
