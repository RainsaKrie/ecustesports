import type { NextRequest } from "next/server";
import { isAdminRequest } from "@/lib/domains/identity/admin-session";
import { getCommonRuleLibrary, saveCommonRuleLibrary } from "@/lib/rule-library";
import { recordOperationAuditSafely } from "@/lib/operation-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) return Response.json({ message: "未登录或会话已过期" }, { status: 401 });
  return Response.json({ rules: await getCommonRuleLibrary() });
}

export async function PUT(request: NextRequest) {
  if (!isAdminRequest(request)) return Response.json({ message: "未登录或会话已过期" }, { status: 401 });
  try {
    const body = await request.json().catch(() => null);
    const raw = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
    const rules = await saveCommonRuleLibrary(raw.rules);
    await recordOperationAuditSafely(request, {
      actorType: "admin",
      action: "rule-library.updated",
      // 这里改的是「后续赛事通用规则预设」，会跨赛事生效，属于需要归因的改动。
      // 只记条数，不把规则正文抄进日志。
      metadata: { ruleCount: Array.isArray(rules) ? rules.length : 0 },
    });
    return Response.json({ message: "后续赛事通用规则预设已更新", rules });
  } catch {
    return Response.json({ message: "通用规则预设保存失败" }, { status: 400 });
  }
}
