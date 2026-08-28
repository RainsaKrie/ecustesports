import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { getCommonRuleLibrary, saveCommonRuleLibrary } from "@/lib/rule-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAdmin(request: NextRequest): boolean {
  return verifySessionToken(request.cookies.get(SESSION_COOKIE_NAME)?.value);
}

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) return Response.json({ message: "未登录或会话已过期" }, { status: 401 });
  return Response.json({ rules: await getCommonRuleLibrary() });
}

export async function PUT(request: NextRequest) {
  if (!isAdmin(request)) return Response.json({ message: "未登录或会话已过期" }, { status: 401 });
  try {
    const body = await request.json().catch(() => null);
    const raw = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
    const rules = await saveCommonRuleLibrary(raw.rules);
    return Response.json({ message: "后续赛事通用规则预设已更新", rules });
  } catch {
    return Response.json({ message: "通用规则预设保存失败" }, { status: 400 });
  }
}
