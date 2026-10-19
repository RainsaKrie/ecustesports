// =====================
// 排期模式（2026-10-16）
//
// 两种**并列**的模式，在赛事配置时选定，抽签发布后不再改：
//   · `open`  自由约赛  —— 队伍在时段窗口内自行协商时间（默认）
//   · `fixed` 固定比赛时间 —— 由主办方统一排定，队伍侧没有协商入口
//
// 为什么要有这个区分：混成一套流程时，选手看到的"时间"既是承诺、又是可以改的，规则对外讲不清。
// 分成两个模式后，各自内部规则单一，一句话能说明白。
//
// ★ 「待排期」这个状态的语义在两种模式下**完全不同**：
//   open  模式下它是正常状态（就等协商）；
//   fixed 模式下它是异常状态（应当长期为 0，不为 0 说明排期漏了）。
// =====================

export type ScheduleMode = "open" | "fixed";

/** 读事件的排期模式：只认 `fixed` 字面量，其余（含缺失）退回 `open` —— 存量赛事行为不变 */
export function scheduleModeOf(event: { scheduleMode?: string } | null | undefined): ScheduleMode {
  return event?.scheduleMode === "fixed" ? "fixed" : "open";
}

export const SCHEDULE_MODE_LABELS: Record<ScheduleMode, string> = {
  open: "自由约赛",
  fixed: "固定比赛时间",
};

/**
 * 队伍侧协商的拒绝理由；返回 `null` 表示允许。
 *
 * 固定模式下**必须真的拒绝**（不能只把界面入口藏起来）——
 * 否则熟悉接口的人仍能提交约赛申请，模式就形同虚设。
 */
export function captainNegotiationRefusal(mode: ScheduleMode): string | null {
  if (mode !== "fixed") return null;
  return "本届采用固定比赛时间，赛程由主办方统一排定，不接受队伍自行协商时间。如确有困难，请联系赛事负责人。";
}

/** 固定模式下「有待排期场次」属于异常：给负责人的提示（open 模式返回 null，因为那是正常状态） */
export function unscheduledAnomalyNotice(mode: ScheduleMode, pendingCount: number): string | null {
  if (mode !== "fixed" || pendingCount <= 0) return null;
  return `固定比赛时间模式下仍有 ${pendingCount} 场未排定 —— 正常应为 0，请到赛程页一键排定。`;
}
