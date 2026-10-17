// =====================
// 官网文案的字数与格式约束（单一来源）
//
// 为什么单独抽一个文件：同一个字段曾经有两个编辑入口、两套规则——
//   赛事设置 → 玩家页面：只截断到 500，没有下限，写 5 个字也能保存
//   官网内容：          强制 10–280，否则 400
// 而「官网内容」每次都把简介与页脚一起提交，于是在赛事设置写坏的值会让它
// 永久保存失败，且报错指向的是另一个字段（改页脚却提示「简介字数不对」）。
//
// 现在两边用同一组常量与同一个校验函数。改规则只改这里。
// 下限 10 与 publication-check 的「赛事简介至少 10 个字」保持一致，
// 否则会出现「能保存但发布检查不通过」这种自相矛盾的状态。
// =====================

/** 首页赛事简介：下限与 publication-check 的发布门槛一致。 */
export const EVENT_DESCRIPTION_MIN = 10;
export const EVENT_DESCRIPTION_MAX = 280;

/** 页脚状态：站点级文案，比简介更短。 */
export const FOOTER_STATUS_MIN = 4;
export const FOOTER_STATUS_MAX = 100;

export type TextIssue = { message: string } | null;

/** 校验首页赛事简介。返回 null 表示合法。 */
export function eventDescriptionIssue(value: string): TextIssue {
  const length = value.trim().length;
  if (length < EVENT_DESCRIPTION_MIN || length > EVENT_DESCRIPTION_MAX) {
    return { message: `首页赛事简介应为 ${EVENT_DESCRIPTION_MIN}—${EVENT_DESCRIPTION_MAX} 字（当前 ${length} 字）` };
  }
  return null;
}

/** 校验页脚状态。返回 null 表示合法。 */
export function footerStatusIssue(value: string): TextIssue {
  const length = value.trim().length;
  if (length < FOOTER_STATUS_MIN || length > FOOTER_STATUS_MAX) {
    return { message: `页脚状态应为 ${FOOTER_STATUS_MIN}—${FOOTER_STATUS_MAX} 字（当前 ${length} 字）` };
  }
  return null;
}
