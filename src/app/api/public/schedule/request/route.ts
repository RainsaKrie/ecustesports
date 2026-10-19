// L3：解析请求 → 调 L2 用例 → 返回响应。**这里不写业务判断**。
import type { NextRequest } from "next/server";
import { readParticipantToken } from "@/lib/domains/identity/participant-auth";
import { decideRescheduleRequest, submitRescheduleRequest } from "@/lib/application/reschedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function shortText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const result = await submitRescheduleRequest({
      eventId: shortText(body.eventId, 60),
      participantToken: readParticipantToken(request),
      matchId: shortText(body.matchId, 80),
      newStartTime: shortText(body.newStartTime, 32),
      reason: shortText(body.reason, 160),
    });
    return Response.json(result.body, { status: result.status });
  } catch {
    return Response.json({ message: "约赛申请提交失败，请稍后重试。" }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const eventId = shortText(body.eventId, 60);
    const requestId = shortText(body.requestId, 100);
    const decision = body.decision === "accept" ? "accept" : body.decision === "reject" ? "reject" : "";
    if (!eventId || !requestId || !decision) {
      return Response.json({ message: "缺少约赛申请或处理结果。" }, { status: 400 });
    }
    const result = await decideRescheduleRequest({
      eventId,
      participantToken: readParticipantToken(request),
      requestId,
      decision,
    });
    return Response.json(result.body, { status: result.status });
  } catch {
    return Response.json({ message: "约赛申请处理失败，请稍后重试。" }, { status: 400 });
  }
}
