// =====================
// POST /api/referee/login —— 验证裁判凭证；成功只返回布尔结果，不暴露内部身份 ID
// =====================

import type { NextRequest } from "next/server";
import { readRefereeCredential } from "@/lib/referee/referee-auth";
import { refereeFailureResponse } from "@/lib/referee/failure-response";
import { refereeLogin } from "@/lib/referee/reporting-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const credential = (typeof body.credential === "string" ? body.credential.trim() : "").slice(0, 200)
    || readRefereeCredential(request);
  const eventId = (typeof body.eventId === "string" ? body.eventId.trim() : "").slice(0, 60);
  if (!eventId) return Response.json({ message: "缺少赛事 ID" }, { status: 400 });
  const result = await refereeLogin(eventId, credential);
  if (!result.ok) return refereeFailureResponse(result);
  return Response.json({ ok: true });
}
