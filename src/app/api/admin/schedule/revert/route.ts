// =====================
// 撤销赛果接口（2026-11-08）
//
// 为什么必须是**独立接口**，而不是让管理端整份快照保存：
// `/api/data/schedule` 的保存路径有 `detectScheduleLosses` 护栏 ——
// 任何「把已完成场次的赛果抹掉」的提交都会被判成「覆盖别人已写好的成果」并返回 409。
// 于是客户端撤销完、自动保存被拒、前端再 refresh，界面就回弹成「已完成」
// （负责人 2026-11-08 报的正是这个现象）。
//
// 撤销是**显式意图**，不该走那条「怀疑是过期快照」的路径：
// 这里由服务端自己读出当前赛程、执行 `revertResultOp`、写回，并记一条操作日志。
// 护栏仍在（本场无赛果 / 下一场已有赛果 → 拒绝），只是不复用丢失检测。
// =====================

import type { NextRequest } from "next/server";

import { isAdminRequest } from "@/lib/domains/identity/admin-session";
import { updateEventData } from "@/lib/data-store";
import { recordOperationAuditSafely } from "@/lib/operation-audit";
import { emptySchedule, normalizeScheduleState } from "@/lib/domains/schedule/schedule-data";
import { stampScheduleVersion } from "@/lib/domains/schedule/schedule-ops";
import { revertResultOp } from "@/lib/domains/schedule/revert-result";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

class RevertRefusal extends Error {}

export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return Response.json({ message: "未登录或会话已过期" }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as
    | { eventId?: string; matchId?: string; reason?: string }
    | null;
  const eventId = body?.eventId?.trim() ?? "";
  const matchId = body?.matchId?.trim() ?? "";
  const reason = body?.reason?.trim() ?? "";

  if (!eventId || !matchId) return Response.json({ message: "缺少赛事或比赛" }, { status: 400 });
  // 撤销是破坏性操作：没有原因就不落库，否则事后无从追溯是谁为什么退的。
  if (!reason) return Response.json({ message: "请填写撤销原因" }, { status: 400 });

  let revertedName = "";
  try {
    const saved = await updateEventData(eventId, "schedule", emptySchedule(), (raw) => {
      const current = normalizeScheduleState(raw);
      const outcome = revertResultOp(current, matchId);
      if (!outcome.ok) throw new RevertRefusal(outcome.message);
      revertedName = current.matches.find((match) => match.id === matchId)?.id ?? matchId;
      return stampScheduleVersion(current, outcome.state);
    });

    await recordOperationAuditSafely(request, {
      eventId,
      actorType: "admin",
      action: "schedule.result.revert",
      target: revertedName || matchId,
      metadata: { matchId, reason },
    });

    return Response.json({ message: "已撤销赛果", schedule: saved });
  } catch (error) {
    if (error instanceof RevertRefusal) {
      return Response.json({ message: error.message }, { status: 400 });
    }
    return Response.json({ message: "撤销失败，请刷新后重试" }, { status: 400 });
  }
}
