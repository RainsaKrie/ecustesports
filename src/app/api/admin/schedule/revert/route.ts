// =====================
// 撤销赛果接口（2026-11-08）
//
// 只做三件事：鉴权、解析入参、把用例结果翻成 HTTP。
// 写入与审计在 `lib/application/revert-match-result.ts` —— 路由不允许直连数据层（架构守卫 ③）。
//
// 为什么需要独立接口：整份快照保存路径会把「抹掉赛果」判成覆盖冲突（409），
// 客户端保存被拒后 refresh，界面就回弹成「已完成」。
// =====================

import type { NextRequest } from "next/server";

import { isAdminRequest } from "@/lib/domains/identity/admin-session";
import { revertMatchResult } from "@/lib/application/revert-match-result";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return Response.json({ message: "未登录或会话已过期" }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as
    | { eventId?: string; matchId?: string; reason?: string }
    | null;
  const eventId = body?.eventId?.trim() ?? "";
  const matchId = body?.matchId?.trim() ?? "";
  const reason = body?.reason?.trim() ?? "";

  if (!eventId || !matchId) return Response.json({ message: "缺少赛事或比赛" }, { status: 400 });
  if (!reason) return Response.json({ message: "请填写撤销原因" }, { status: 400 });

  const outcome = await revertMatchResult({ request, eventId, matchId, reason });
  if (!outcome.ok) return Response.json({ message: outcome.message }, { status: 400 });
  return Response.json({ message: "已撤销赛果" });
}
