// =====================
// 管理员裁判管理 API（RPT-07a）
// GET  /api/admin/referees?eventId=xx —— 裁判列表 + 比赛清单（含分配关系）
// POST /api/admin/referees             —— create / disable / reset / assign / revoke
// 鉴权复用管理员 session（isAdminRequest@/lib/auth），不新造身份。
// =====================

import type { NextRequest } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import {
  adminListReferees,
  adminCreateReferee,
  adminDisableReferee,
  adminResetCredential,
  adminAssignMatch,
  adminRevokeAssignment,
} from "@/lib/referee/reporting-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function bodyObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

/** 凭证有效期缺省：默认给 90 天，避免创建裁判时强制管理员填时间。 */
function defaultExpiry(): string {
  return new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
}

export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) return Response.json({ message: "未登录或会话已过期" }, { status: 401 });
  const eventId = text(request.nextUrl.searchParams.get("eventId"), 60);
  if (!eventId) return Response.json({ message: "缺少赛事 ID" }, { status: 400 });
  const data = await adminListReferees(eventId);
  return Response.json(data);
}

export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) return Response.json({ message: "未登录或会话已过期" }, { status: 401 });
  try {
    const body = bodyObject(await request.json().catch(() => null));
    const eventId = text(body.eventId, 60);
    const action = text(body.action, 40);
    const payload = bodyObject(body.payload);
    if (!eventId || !action) return Response.json({ message: "缺少赛事或操作类型" }, { status: 400 });

    if (action === "create") {
      const displayName = text(payload.displayName, 60);
      if (!displayName) return Response.json({ message: "缺少裁判姓名" }, { status: 400 });
      const credentialExpiresAt = text(payload.credentialExpiresAt, 40) || defaultExpiry();
      const result = await adminCreateReferee(eventId, { displayName, actorId: "admin", credentialExpiresAt });
      if (!result.ok) return Response.json({ message: result.error, code: result.code }, { status: 400 });
      return Response.json(result.value);
    }

    if (action === "disable") {
      const refereeId = text(payload.refereeId, 100);
      if (!refereeId) return Response.json({ message: "缺少裁判 ID" }, { status: 400 });
      const result = await adminDisableReferee(eventId, { refereeId, actorId: "admin" });
      if (!result.ok) return Response.json({ message: result.error, code: result.code }, { status: 400 });
      return Response.json(result.value);
    }

    if (action === "reset") {
      const refereeId = text(payload.refereeId, 100);
      if (!refereeId) return Response.json({ message: "缺少裁判 ID" }, { status: 400 });
      const newCredentialExpiresAt = text(payload.credentialExpiresAt, 40) || defaultExpiry();
      const result = await adminResetCredential(eventId, { refereeId, actorId: "admin", newCredentialExpiresAt });
      if (!result.ok) return Response.json({ message: result.error, code: result.code }, { status: 400 });
      return Response.json(result.value);
    }

    if (action === "assign") {
      const refereeId = text(payload.refereeId, 100);
      const matchId = text(payload.matchId, 60);
      if (!refereeId || !matchId) return Response.json({ message: "缺少裁判或比赛 ID" }, { status: 400 });
      const result = await adminAssignMatch(eventId, { refereeId, matchId, actorId: "admin" });
      if (!result.ok) return Response.json({ message: result.error, code: result.code }, { status: 400 });
      return Response.json(result.value);
    }

    if (action === "revoke") {
      const assignmentId = text(payload.assignmentId, 100);
      if (!assignmentId) return Response.json({ message: "缺少分配关系 ID" }, { status: 400 });
      const result = await adminRevokeAssignment(eventId, { assignmentId, actorId: "admin" });
      if (!result.ok) return Response.json({ message: result.error, code: result.code }, { status: 400 });
      return Response.json(result.value);
    }

    return Response.json({ message: "不支持的操作" }, { status: 400 });
  } catch {
    return Response.json({ message: "操作失败，请稍后重试" }, { status: 400 });
  }
}