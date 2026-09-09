// =====================
// 管理员异常赛果工作台（RPT-06）
// GET  /api/admin/review?eventId=xx  —— 读异常队列（needs-review 提交投影）
// POST /api/admin/review             —— 裁决（resolve）/ 受控更正（correct）
// 鉴权复用管理员 session（verifySessionToken），不新造身份。
// =====================

import type { NextRequest } from "next/server";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import {
  adminReviewData,
  adminResolveReview,
  adminCorrectResult,
} from "@/lib/referee/reporting-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAdmin(request: NextRequest): boolean {
  return verifySessionToken(request.cookies.get(SESSION_COOKIE_NAME)?.value);
}

function text(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function bodyObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) return Response.json({ message: "未登录或会话已过期" }, { status: 401 });
  const eventId = text(request.nextUrl.searchParams.get("eventId"), 60);
  if (!eventId) return Response.json({ message: "缺少赛事 ID" }, { status: 400 });
  return Response.json(await adminReviewData(eventId));
}

export async function POST(request: NextRequest) {
  if (!isAdmin(request)) return Response.json({ message: "未登录或会话已过期" }, { status: 401 });
  try {
    const body = bodyObject(await request.json().catch(() => null));
    const eventId = text(body.eventId, 60);
    const action = text(body.action, 40);
    const payload = bodyObject(body.payload);
    if (!eventId || !action) return Response.json({ message: "缺少赛事或操作类型" }, { status: 400 });

    if (action === "resolve") {
      const submissionId = text(payload.submissionId, 100);
      const accept = payload.accept === true;
      const reason = text(payload.reason, 500);
      if (!submissionId || !reason) return Response.json({ message: "缺少提交记录或裁决原因" }, { status: 400 });
      const result = await adminResolveReview(eventId, { submissionId, accept, actorId: "admin", reason });
      if (!result.ok) return Response.json({ message: result.error, code: result.code }, { status: 400 });
      return Response.json(result.value);
    }

    if (action === "correct") {
      const matchId = text(payload.matchId, 60);
      const reason = text(payload.reason, 500);
      const newGames = Array.isArray(payload.newGames) ? payload.newGames : [];
      if (!matchId || !reason || newGames.length === 0) {
        return Response.json({ message: "缺少更正信息" }, { status: 400 });
      }
      const result = await adminCorrectResult(eventId, {
        matchId,
        actorId: "admin",
        reason,
        newGames: newGames as Parameters<typeof adminCorrectResult>[1]["newGames"],
      });
      if (!result.ok) {
        const status = result.code === "DOWNSTREAM_PROGRESSED" ? 409 : 400;
        return Response.json({ message: result.error, code: result.code }, { status });
      }
      return Response.json(result.value);
    }

    return Response.json({ message: "不支持的操作" }, { status: 400 });
  } catch {
    return Response.json({ message: "操作失败，请稍后重试" }, { status: 400 });
  }
}
