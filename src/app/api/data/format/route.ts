import { readEventData, writeEventData } from "@/lib/data-store";
import { getSiteConfig } from "@/lib/site-config";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/domains/identity/admin-session";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMPTY = { seedPots: [], groups: [], matchups: [] };

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
  return Response.json(await readEventData(eventId, "format", EMPTY));
}

export async function POST(request: NextRequest) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 2_000_000) {
      return Response.json({ message: "数据过大" }, { status: 413 });
    }
    const eventId = await resolveEventId(request);
    if (!eventId) return Response.json({ message: "未登录、赛事不存在或缺少赛事 ID。" }, { status: 401 });
    await writeEventData(eventId, "format", await request.json());
    return Response.json({ message: "saved" });
  } catch {
    return Response.json({ message: "保存失败" }, { status: 400 });
  }
}
