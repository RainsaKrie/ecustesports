// =====================
// POST /api/referee/login —— 验证裁判凭证，返回裁判身份
// =====================

import type { NextRequest } from "next/server";
import { readRefereeCredential } from "@/lib/referee/referee-auth";
import { refereeLogin, DEMO_EVENT_ID } from "@/lib/referee/reporting-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const credential = (typeof body.credential === "string" ? body.credential.trim() : "").slice(0, 200)
    || readRefereeCredential(request);
  const eventId = (typeof body.eventId === "string" ? body.eventId.trim() : "").slice(0, 60) || DEMO_EVENT_ID;
  const result = await refereeLogin(eventId, credential);
  if (!result.ok) return Response.json({ message: "裁判凭证无效" }, { status: 401 });
  return Response.json({ refereeId: result.refereeId });
}