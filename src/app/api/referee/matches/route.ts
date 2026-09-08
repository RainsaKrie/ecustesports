// =====================
// GET /api/referee/matches —— 我的比赛（只含被分配场次）
// =====================

import type { NextRequest } from "next/server";
import { readRefereeCredential } from "@/lib/referee/referee-auth";
import { refereeMyMatches, DEMO_EVENT_ID } from "@/lib/referee/reporting-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const eventId = request.nextUrl.searchParams.get("eventId")?.trim()?.slice(0, 60) || DEMO_EVENT_ID;
  const credential = readRefereeCredential(request);
  const result = await refereeMyMatches(eventId, credential);
  if (!result.ok) return Response.json({ message: "裁判凭证无效" }, { status: 401 });
  return Response.json({ matches: result.matches, scheduleVersion: result.scheduleVersion });
}