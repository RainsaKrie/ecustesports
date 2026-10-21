import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/domains/identity/admin-session";
import { withApiError } from "@/lib/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}

export const POST = withApiError(handlePOST);
