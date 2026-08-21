import type { NextRequest } from "next/server";
import { readEventData } from "@/lib/data-store";
import { getSiteConfig } from "@/lib/site-config";
import { emptySchedule, type ScheduleState } from "@/lib/scheduling/schedule-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const eventId = request.nextUrl.searchParams.get("eventId")?.trim() ?? "";
  const config = await getSiteConfig();
  const event = config.events.find((item) => item.id === eventId && item.status !== "draft");
  if (!event) return Response.json({ message: "赛事不存在或尚未公开。" }, { status: 404 });
  const state = await readEventData<ScheduleState>(eventId, "schedule", emptySchedule());
  return Response.json({ version: state.version, matches: state.matches });
}
