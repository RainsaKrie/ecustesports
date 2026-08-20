import { readEventData, writeEventData } from "@/lib/data-store";
import { getSiteConfig } from "@/lib/site-config";
import { initialSchedule } from "@/lib/scheduling/schedule-data";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveEventId(request: NextRequest): Promise<string> {
  const fromQuery = request.nextUrl.searchParams.get("eventId");
  if (fromQuery) return fromQuery;
  const config = await getSiteConfig();
  return config.currentEventId;
}

export async function GET(request: NextRequest) {
  const eventId = await resolveEventId(request);
  return Response.json(await readEventData(eventId, "schedule", initialSchedule()));
}

export async function POST(request: NextRequest) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 2_000_000) {
      return Response.json({ message: "数据过大" }, { status: 413 });
    }
    const eventId = await resolveEventId(request);
    await writeEventData(eventId, "schedule", await request.json());
    return Response.json({ message: "saved" });
  } catch {
    return Response.json({ message: "保存失败" }, { status: 400 });
  }
}
