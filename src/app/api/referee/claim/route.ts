// =====================
// /api/referee/claim —— 裁判自助认领 / 释放比赛
//
//   GET  ?eventId=xx          列出可认领的比赛（已排期、未完成、尚无人认领）
//   POST { eventId, matchId, action: "claim" | "release" }
//
// 背景：原本由负责人在管理端逐场指派。实际流程是队伍先约好时间、
// 得到比赛列表，裁判自己看哪些能执裁再认领——指派反而成了负责人的负担。
// 管理端的指派能力保留，用作「某场没人认领」时的兜底。
//
// 身份一律从裁判凭证推导，不接受客户端传 refereeId。
// =====================

import type { NextRequest } from "next/server";
import { readRefereeCredential } from "@/lib/domains/result/referee-auth";
import { refereeReportingEnabled } from "@/lib/domains/result/feature-flag";
import { refereeFailureResponse } from "@/lib/domains/result/failure-response";
import { refereeClaimMatch, refereeOpenMatches, refereeReleaseMatch } from "@/lib/domains/result/reporting-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function GET(request: NextRequest) {
  // 读取不检查功能开关——开关只拦写操作（见 feature-flag 的语义说明），
  // 「我的比赛」等读取接口同理。否则关闭开关会让裁判连自己有什么活都看不到。
  const eventId = text(request.nextUrl.searchParams.get("eventId"), 60);
  if (!eventId) return Response.json({ message: "缺少赛事 ID" }, { status: 400 });

  const result = await refereeOpenMatches(eventId, readRefereeCredential(request));
  if (!result.ok) return refereeFailureResponse(result);
  return Response.json({ matches: result.matches, scheduleVersion: result.scheduleVersion });
}

export async function POST(request: NextRequest) {
  // 认领会写裁判台账，属于写操作 → 受功能开关约束
  if (!refereeReportingEnabled()) {
    return Response.json({ message: "裁判报分功能暂未开放" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null) {
    return Response.json({ message: "请求格式错误" }, { status: 400 });
  }
  const raw = body as Record<string, unknown>;
  const eventId = text(raw.eventId, 60);
  const matchId = text(raw.matchId, 60);
  const action = text(raw.action, 20) || "claim";
  if (!eventId || !matchId) return Response.json({ message: "缺少赛事或比赛 ID" }, { status: 400 });
  if (action !== "claim" && action !== "release") {
    return Response.json({ message: "不支持的操作" }, { status: 400 });
  }

  const credential = readRefereeCredential(request)
    || text(raw.credential, 200);

  const result = action === "claim"
    ? await refereeClaimMatch(eventId, credential, matchId)
    : await refereeReleaseMatch(eventId, credential, matchId);

  if (!result.ok) {
    // 已被他人占走属于正常竞争结果，不是错误请求 → 409
    return refereeFailureResponse(result, { MATCH_TAKEN: 409 });
  }
  return Response.json({
    ok: true,
    action,
    matchId,
    message: result.reason ?? (action === "claim" ? "已认领该场" : "已释放该场"),
  });
}
