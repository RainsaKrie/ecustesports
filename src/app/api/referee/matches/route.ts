// =====================
// GET /api/referee/matches —— 我的比赛（只含被分配场次）
// =====================

import type { NextRequest } from "next/server";
import { readRefereeCredential } from "@/lib/domains/result/referee-auth";
import { refereeFailureResponse } from "@/lib/domains/result/failure-response";
import { refereeMyMatches } from "@/lib/domains/result/reporting-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const eventId = request.nextUrl.searchParams.get("eventId")?.trim()?.slice(0, 60) ?? "";
  if (!eventId) return Response.json({ message: "缺少赛事 ID" }, { status: 400 });
  const credential = readRefereeCredential(request);
  const result = await refereeMyMatches(eventId, credential);
  if (!result.ok) return refereeFailureResponse(result);
  return Response.json({ matches: result.matches, scheduleVersion: result.scheduleVersion });
}
