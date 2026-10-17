// =====================
// 切换当前赛事（管理员）
// POST /api/admin/events/switch  { eventId }
// =====================

import { getSiteConfig, saveSiteConfig } from "@/lib/site-config";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/domains/identity/admin-session";
import { recordOperationAuditSafely } from "@/lib/operation-audit";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!verifySessionToken(token)) {
    return Response.json({ message: "未登录或会话已过期" }, { status: 401 });
  }
  try {
    const body = await request.json().catch(() => null);
    const eventId = (typeof body === "object" && body !== null && typeof (body as Record<string, unknown>).eventId === "string")
      ? ((body as Record<string, unknown>).eventId as string)
      : "";

    const config = await getSiteConfig();
    if (!config.events.some((e) => e.id === eventId)) {
      return Response.json({ message: "赛事不存在" }, { status: 400 });
    }

    const previousEventId = config.currentEventId;
    await saveSiteConfig({ ...config, currentEventId: eventId });
    await recordOperationAuditSafely(request, {
      eventId,
      actorType: "admin",
      action: "event.current.switched",
      // 只改「当前焦点赛事」指针，但会影响后台默认进入哪一场，记下前后值便于回溯。
      metadata: { from: previousEventId ?? null, to: eventId },
    });
    return Response.json({ message: "已切换当前赛事" });
  } catch {
    return Response.json({ message: "切换失败，请稍后重试" }, { status: 400 });
  }
}
