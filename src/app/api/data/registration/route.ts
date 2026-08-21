import { readEventData, writeEventData } from "@/lib/data-store";
import { initialRegistration, normalizeRegistrationState } from "@/lib/scheduling/registration-data";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resolveEventId(request: NextRequest): string {
  return request.nextUrl.searchParams.get("eventId")?.trim() ?? "";
}

export async function GET(request: NextRequest) {
  if (!verifySessionToken(request.cookies.get(SESSION_COOKIE_NAME)?.value)) {
    return Response.json({ message: "未登录" }, { status: 401 });
  }
  const eventId = resolveEventId(request);
  if (!eventId) return Response.json({ message: "缺少赛事 ID" }, { status: 400 });
  const stored = await readEventData(eventId, "registration", initialRegistration());
  return Response.json(normalizeRegistrationState(stored));
}

export async function POST(request: NextRequest) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 2_000_000) {
      return Response.json({ message: "数据过大" }, { status: 413 });
    }
    const eventId = resolveEventId(request);
    if (!eventId) return Response.json({ message: "缺少赛事 ID" }, { status: 400 });
    await writeEventData(eventId, "registration", normalizeRegistrationState(await request.json()));
    return Response.json({ message: "saved" });
  } catch {
    return Response.json({ message: "保存失败" }, { status: 400 });
  }
}
