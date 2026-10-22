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

import type { ScheduleState } from "./schedule-data.ts";

export type RemoveMatchResult =
  | { ok: true; state: ScheduleState }
  | { ok: false; message: string };

/**
 * 从赛程中删除一场比赛。
 *
 * 护栏（宁可拒绝，也不悄悄抹掉成果）：
 * - 已完成的比赛不允许删 —— 比分会连同胜者晋级关系一起消失；
 * - 被别的比赛引用过（`nextMatchId` 指向它）的也不允许删 —— 会留下悬空引用。
 */
export function removeMatchOp(state: ScheduleState, matchId: string): RemoveMatchResult {
  const target = state.matches.find((m) => m.id === matchId);
  if (!target) return { ok: false, message: "这场比赛不存在（可能已被删除）" };

  if (target.status === "已完成") {
    return { ok: false, message: "这场比赛已完成，不能删除。如需作废请先处理比分。" };
  }

  const referencedBy = state.matches.find(
    (m) => m.nextMatchId === matchId || m.nextLoserMatchId === matchId,
  );
  if (referencedBy) {
    return {
      ok: false,
      message: `还有别的比赛指向这场（${referencedBy.id}），直接删除会留下悬空引用。`,
    };
  }

  return { ok: true, state: { ...state, matches: state.matches.filter((m) => m.id !== matchId) } };
}
