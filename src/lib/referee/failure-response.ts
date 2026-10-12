// =====================
// 裁判接口的失败 → HTTP 状态码与「给用户看的话」（单一出处）
//
// 为什么单独一份：这段「哪些失败码算未授权」的映射原先在 claim / upload / recognize
// 三处各写了一遍（recognize 里其实写了两遍），submit 漏了 —— 于是同一个「凭证失效」
// 在四个接口上得到两种表现：
//   claim 401「裁判凭证无效」/ upload 401 / matches 401，而 submit 回 400，
//   并把内部码 `INVALID_CREDENTIAL` **原样当成提示文案**显示在裁判屏幕上。
// 裁判看到的是一串大写英文，不知道该重新登录；负责人也无从判断该不该重置凭证。
//
// 收成一份之后：新增裁判接口只需调这里，状态码与文案成对产生，不会再只改一半。
//
// 本文件刻意不 import "server-only"：它是纯映射，要能在普通 Node 下直接测。
// =====================

/**
 * 鉴权类失败码 → 401。
 *
 * `NOT_ASSIGNED`（这场没分给你）为什么也归 401 而不是 403：这是**既有约定**，
 * staging 的端到端脚本已按 `未指派的比赛被拒（401）` 断言过。语义上 403 更准，
 * 但一致性优先；真改就四处一起改，不要在这里单独改一个。
 */
const AUTH_FAILURE_CODES = ["INVALID_CREDENTIAL", "DISABLED", "EXPIRED", "WRONG_EVENT", "NOT_ASSIGNED"];

/**
 * 这些码换成「能照着做」的一句话。
 *
 * 不在这里的码（如 `EVIDENCE_NOT_FOUND`、`SIGNATURE_MISMATCH`）保留领域层原文 ——
 * 那些文案本身已是中文说明，且被端到端脚本按关键词断言过。
 */
const MESSAGES: Record<string, string> = {
  // 与 referee-ops 一致：不区分「不存在」和「凭证错」，防枚举
  INVALID_CREDENTIAL: "裁判凭证无效或已失效，请重新登录",
  EXPIRED: "裁判凭证已过期，请向负责人索取新凭证",
  DISABLED: "这条裁判凭证已被停用，请联系负责人",
  WRONG_EVENT: "这条凭证不属于该赛事，请确认赛事 ID",
  NOT_ASSIGNED: "这场比赛没有分配给你，请确认执裁安排或联系负责人",
};

/** 失败码 → HTTP 状态码。`extra` 用于个别路由的正常竞争结果（如已被人认领 → 409）。 */
export function refereeFailureStatus(code: string | undefined, extra: Record<string, number> = {}): number {
  const key = code ?? "";
  if (Object.prototype.hasOwnProperty.call(extra, key)) return extra[key];
  return AUTH_FAILURE_CODES.includes(key) ? 401 : 400;
}

/** 失败码 → 给用户看的文案；不在表里的保留领域层原文。 */
export function refereeFailureMessage(code: string | undefined, fallback?: string): string {
  return MESSAGES[code ?? ""] ?? fallback ?? "操作失败";
}

/**
 * 失败 → Response。
 *
 * 故意做成「返回 Response」而不是只返回状态码：这样状态码与文案必然成对，
 * 调用点不会出现「改了状态码忘了换文案」——submit 当初就是这么漏的。
 */
export function refereeFailureResponse(
  failure: { code?: string; error?: string },
  extra?: Record<string, number>,
): Response {
  return Response.json(
    { message: refereeFailureMessage(failure.code, failure.error) },
    { status: refereeFailureStatus(failure.code, extra) },
  );
}
