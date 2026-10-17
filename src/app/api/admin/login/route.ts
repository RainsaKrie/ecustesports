import { NextResponse } from "next/server";
import { createSessionToken, verifyPassword, SESSION_COOKIE_NAME } from "@/lib/domains/identity/admin-session";
import { recordOperationAuditSafely } from "@/lib/operation-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let password = "";
  try {
    const body = await request.json();
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    // 请求体不是合法 JSON，按空密码处理
  }

  if (!verifyPassword(password)) {
    await recordOperationAuditSafely(request, {
      actorType: "admin",
      action: "admin.login.failed",
    });
    return NextResponse.json({ message: "密码错误" }, { status: 401 });
  }

  const token = createSessionToken();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
    secure: process.env.NODE_ENV === "production",
  });
  await recordOperationAuditSafely(request, {
    actorType: "admin",
    action: "admin.login.succeeded",
  });
  return response;
}
