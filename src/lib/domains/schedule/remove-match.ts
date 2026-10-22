// =====================
// 删除单场比赛（2026-10-22）
//
// 为什么需要：赛事中途取消某一场（例如取消小组决赛、直接进淘汰赛）时，
// 平台原先**没有删除入口**。而 `event-progress.ts` 的完成判据是
//   `matches.every(m => m.status === "已完成")`
// —— 只要有一场永远停在「待排期」，赛事就永远不算完成，「结束赛事」按钮永远不出现。
//
// 独立成文件而不是加进 `schedule-ops.ts`：那个文件已 825 行、被架构守卫锁行（只许变短）。
// =====================

import type { ScheduleMatch, ScheduleState } from "./schedule-data.ts";

export type RemoveMatchResult =
  | { ok: true; state: ScheduleState }
  | { ok: false; message: string };

/**
 * 从赛程中删除一场比赛。
 *
 * 护栏（宁可拒绝，也不悄悄抹掉成果）：
 * - 已完成的比赛不允许删 —— 比分会连同胜者晋级关系一起消失；
 * - 被别的比赛指向时**不拒绝，而是断开链接**（`nextMatchId`/`nextLoserMatchId` 置空）——
 *   拒绝的话，小组决赛因被半决赛指着而永远删不掉，赛事也就永远算不完成。
 */
export function removeMatchOp(state: ScheduleState, matchId: string): RemoveMatchResult {
  const target = state.matches.find((m) => m.id === matchId);
  if (!target) return { ok: false, message: "这场比赛不存在（可能已被删除）" };

  if (target.status === "已完成") {
    return { ok: false, message: "这场比赛已完成，不能删除。如需作废请先处理比分。" };
  }

  // 指向这场的比赛：删除后把它们的前进链接断开，而不是拒绝删除。
  // （典型场景：取消小组决赛 —— 半决赛的 nextMatchId 正指着决赛。
  //   若因"被引用"就拒绝，则决赛永远删不掉，赛事也就永远算不完成。）
  const remaining = state.matches
    .filter((m) => m.id !== matchId)
    .map((m) => {
      const patch: Partial<ScheduleMatch> = {};
      if (m.nextMatchId === matchId) patch.nextMatchId = undefined;
      if (m.nextLoserMatchId === matchId) patch.nextLoserMatchId = undefined;
      return Object.keys(patch).length ? { ...m, ...patch } : m;
    });

  return { ok: true, state: { ...state, matches: remaining } };
}
