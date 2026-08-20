// =====================
// 更新某届赛事的策划案信息（管理员）
// POST /api/admin/events/proposal  { eventId, proposal }
// =====================

import { getSiteConfig, saveSiteConfig } from "@/lib/site-config";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(v: unknown, max = 800): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!verifySessionToken(token)) {
    return Response.json({ message: "未登录或会话已过期" }, { status: 401 });
  }
  try {
    const body = await request.json().catch(() => null);
    const input = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
    const eventId = typeof input.eventId === "string" ? input.eventId : "";
    const p = (typeof input.proposal === "object" && input.proposal !== null ? input.proposal : {}) as Record<string, unknown>;

    const config = await getSiteConfig();
    const event = config.events.find((e) => e.id === eventId);
    if (!event) {
      return Response.json({ message: "赛事不存在" }, { status: 400 });
    }

    const proposal = {
      background: text(p.background),
      purpose: text(p.purpose),
      budget: text(p.budget),
      prizes: text(p.prizes),
      leader: text(p.leader, 40),
      contact: text(p.contact, 80),
    };

    const saved = await saveSiteConfig({
      ...config,
      events: config.events.map((e) => (e.id === eventId ? { ...e, proposal } : e)),
    });

    return Response.json({ message: "已保存", proposal: saved.events.find((e) => e.id === eventId)?.proposal });
  } catch {
    return Response.json({ message: "保存失败，请稍后重试" }, { status: 400 });
  }
}
