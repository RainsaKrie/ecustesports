// L3：鉴权 → 解析 → 调 L2 用例 → 留痕 → 返回响应。**这里不写业务判断**。
import type { NextRequest } from "next/server";
import { isAdminRequest } from "@/lib/domains/identity/admin-session";
import { recordOperationAuditSafely } from "@/lib/operation-audit";
import { isStageAction, runStageTransition, StageTransitionError } from "@/lib/application/advance-stage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return Response.json({ message: "未登录或会话已过期" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => null);
    const input = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
    const eventId = typeof input.eventId === "string" ? input.eventId.trim() : "";
    const action = input.action;
    if (!eventId || !isStageAction(action)) {
      throw new StageTransitionError("阶段操作不合法", 400);
    }

    const result = await runStageTransition(eventId, action);

    await recordOperationAuditSafely(request, {
      eventId,
      actorType: "admin",
      action: `event.stage.${action}`,
      target: String(result.event && typeof result.event === "object" && "name" in result.event ? (result.event as { name: string }).name : ""),
      metadata: { from: result.from, to: result.to },
    });

    return Response.json({ message: result.message, event: result.event });
  } catch (error) {
    if (error instanceof StageTransitionError) {
      return Response.json({ message: error.message }, { status: error.status });
    }
    return Response.json({ message: "阶段更新失败，请稍后重试" }, { status: 400 });
  }
}
