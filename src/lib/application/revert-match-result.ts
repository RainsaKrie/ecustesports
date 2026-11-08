// =====================
// 撤销赛果 · 应用用例（2026-11-08）
//
// 为什么要有这一层：路由（app/）**不允许直接 import 数据访问层** ——
// 架构守卫 ③ 会拦。写入与审计统一放在 application 用例里，
// 路由只负责鉴权、解析入参、把结果翻成 HTTP。
//
// 为什么撤销必须由服务端执行，而不是让管理端整份快照保存：
// `/api/data/schedule` 的 `detectScheduleLosses` 会把「抹掉已完成场次的赛果」
// 判成覆盖别人成果的冲突并返回 409 —— 客户端保存被拒、再 refresh，界面就回弹成「已完成」
// （负责人 2026-11-08 报的现象）。撤销是显式意图，走这条专用路径。
// =====================

import { updateEventData } from "@/lib/data-store";
import { recordOperationAuditSafely } from "@/lib/operation-audit";
import { emptySchedule, normalizeScheduleState } from "@/lib/domains/schedule/schedule-data";
import { stampScheduleVersion } from "@/lib/domains/schedule/schedule-ops";
import { revertResultOp } from "@/lib/domains/schedule/revert-result";

export type RevertMatchResultOutcome =
  | { ok: true }
  | { ok: false; message: string };

class RevertRefusal extends Error {}

/**
 * 把一场已完成的比赛退回未打。
 *
 * 护栏来自 `revertResultOp`（本场无赛果 / 下一场已有赛果都会拒绝），
 * 这里只负责：读当前赛程 → 执行 → 递增 version 写回 → 记一条操作日志。
 */
export async function revertMatchResult(input: {
  request: Request;
  eventId: string;
  matchId: string;
  reason: string;
}): Promise<RevertMatchResultOutcome> {
  const { request, eventId, matchId, reason } = input;

  try {
    await updateEventData(eventId, "schedule", emptySchedule(), (raw) => {
      const current = normalizeScheduleState(raw);
      const outcome = revertResultOp(current, matchId);
      if (!outcome.ok) throw new RevertRefusal(outcome.message);
      return stampScheduleVersion(current, outcome.state);
    });
  } catch (error) {
    if (error instanceof RevertRefusal) return { ok: false, message: error.message };
    return { ok: false, message: "撤销失败，请刷新后重试" };
  }

  // 撤销是破坏性操作：留痕失败不影响业务（recordOperationAuditSafely 内部吞异常），
  // 但 reason 是必填的 —— 事后要能回答「谁为什么把这场退回去了」。
  await recordOperationAuditSafely(request, {
    eventId,
    actorType: "admin",
    action: "schedule.result.revert",
    target: matchId,
    metadata: { matchId, reason },
  });

  return { ok: true };
}
