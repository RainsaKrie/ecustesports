// =====================
// 当前登录状态查询（供 BP 房间等页面判断是否裁判身份）
// =====================

import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/domains/identity/admin-session";
import type { NextRequest } from "next/server";
import { withApiError } from "@/lib/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  return Response.json({ authed: verifySessionToken(token) });
}

export const GET = withApiError(handleGET);
