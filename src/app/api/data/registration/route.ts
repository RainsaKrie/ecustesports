import { readEventData } from "@/lib/data-store";
import { getSiteConfig } from "@/lib/site-config";
import { initialRegistration, normalizeRegistrationState } from "@/lib/scheduling/registration-data";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 与 data/schedule、data/format 保持一致的两件事：
 *   1. 先校验会话，再把 eventId 与站点配置比对 —— 否则带合法会话就能读到
 *      任意（例如已删除赛事）的报名数据。
 *   2. 未通过的 eventId 一律挡在数据层之外 —— `assertSafeEventId` 是**抛错**的，
 *      直接透传会让非法 ID 变成 500 而不是 401。
 */
async function resolveEventId(request: NextRequest): Promise<string | null> {
  if (!verifySessionToken(request.cookies.get(SESSION_COOKIE_NAME)?.value)) return null;
  const fromQuery = request.nextUrl.searchParams.get("eventId")?.trim() ?? "";
  if (!fromQuery) return null;
  const config = await getSiteConfig();
  return config.events.some((event) => event.id === fromQuery) ? fromQuery : null;
}

export async function GET(request: NextRequest) {
  const eventId = await resolveEventId(request);
  if (!eventId) return Response.json({ message: "未登录、赛事不存在或缺少赛事 ID。" }, { status: 401 });
  const stored = await readEventData(eventId, "registration", initialRegistration());
  return Response.json(normalizeRegistrationState(stored));
}
