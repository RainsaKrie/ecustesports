// =====================
// 单场比赛的写操作（2026-11-08）
//
// 从 `useSchedule.ts` 拆出来的原因：那个文件卡在 400 行架构上限，
// 而「删除这场」「撤销赛果」这组操作本身是自洽的 —— 都是「单场 + 返回失败原因」的形状。
//
// 拆出来的收益不只是行数：
//   · 删除 / 撤销共用同一条 `runOp` 路径，不会各写一遍；
//   · 撤销的失败原因走服务端（整份快照保存会被丢失护栏判成覆盖冲突，见 revert-result-client）。
// =====================

import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";

import { removeMatchOp } from "@/lib/domains/schedule/remove-match";
import type { ScheduleState } from "@/lib/domains/schedule/schedule-data";
import { postRevertResult } from "@/lib/admin/revert-result-client";

type OpOutcome = { ok: true; state: ScheduleState } | { ok: false; message: string };

export function useScheduleWriters({
  eventId,
  getState,
  applyState,
  markDirty,
  refresh,
}: {
  eventId: string;
  /** 取当前 state（用 ref，避免闭包里的旧快照） */
  getState: () => ScheduleState;
  applyState: Dispatch<SetStateAction<ScheduleState>>;
  markDirty: () => void;
  refresh: () => Promise<void>;
}) {
  /**
   * 单场写操作的统一壳：先用当前 state 算、再落盘，返回失败原因（成功为 null）。
   * ★ 别放进 setState 的更新函数：它延迟执行且 StrictMode 跑两次，返回时拿不到原因。
   */
  const runOp = useCallback(
    (op: (state: ScheduleState, matchId: string) => OpOutcome) =>
      (matchId: string): string | null => {
        const outcome = op(getState(), matchId);
        if (!outcome.ok) return outcome.message;
        markDirty();
        applyState(outcome.state);
        return null;
      },
    [getState, applyState, markDirty],
  );

  /** 删除一场比赛（赛事中途取消某场时用）。 */
  const removeMatch = runOp(removeMatchOp);

  /** 撤销赛果：走服务端专用接口，成功后再拉一次最新赛程。 */
  const revertResult = useCallback(
    async (matchId: string, reason: string): Promise<string | null> => {
      const reply = await postRevertResult(eventId, matchId, reason);
      if (!reply.ok) return reply.message;
      await refresh();
      return null;
    },
    [eventId, refresh],
  );

  return { removeMatch, revertResult };
}
