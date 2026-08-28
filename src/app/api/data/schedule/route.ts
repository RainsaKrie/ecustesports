import { readEventData, updateEventData } from "@/lib/data-store";
import { getSiteConfig } from "@/lib/site-config";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { emptySchedule, normalizeScheduleState } from "@/lib/scheduling/schedule-data";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  return Response.json(normalizeScheduleState(await readEventData(eventId, "schedule", emptySchedule())));
}

export async function POST(request: NextRequest) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 2_000_000) {
      return Response.json({ message: "数据过大" }, { status: 413 });
    }
    const eventId = await resolveEventId(request);
    if (!eventId) return Response.json({ message: "未登录、赛事不存在或缺少赛事 ID。" }, { status: 401 });
    const expectedVersion = Number(request.headers.get("if-match"));
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      return Response.json({ message: "保存请求缺少赛程版本，请刷新后重试" }, { status: 428 });
    }
    const incoming = normalizeScheduleState(await request.json());
    const saved = await updateEventData(eventId, "schedule", emptySchedule(), (raw) => {
      const current = normalizeScheduleState(raw);
      if (current.version !== expectedVersion) {
        throw new ScheduleVersionConflict();
      }
      return {
        ...incoming,
        version: incoming.version > current.version ? incoming.version : current.version + 1,
      };
    });
    return Response.json({ message: "saved", schedule: saved });
  } catch (error) {
    if (error instanceof ScheduleVersionConflict) {
      return Response.json({ message: "赛程已被其他操作更新，请刷新后再提交" }, { status: 409 });
    }
    return Response.json({ message: "保存失败" }, { status: 400 });
  }
}

class ScheduleVersionConflict extends Error {}
