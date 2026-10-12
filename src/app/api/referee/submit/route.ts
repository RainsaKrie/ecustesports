// =====================
// POST /api/referee/submit —— 提交赛果（凭证推导身份；幂等；对阵变更 409）
// =====================

import type { NextRequest } from "next/server";
import { readRefereeCredential } from "@/lib/referee/referee-auth";
import { refereeReportingEnabled } from "@/lib/referee/feature-flag";
import { refereeSubmit } from "@/lib/referee/reporting-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

export async function POST(request: NextRequest) {
  if (!refereeReportingEnabled()) {
    return Response.json({ message: "裁判报分功能暂未开放" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const credential = text(body.credential, 200) ?? readRefereeCredential(request);
  const eventId = text(body.eventId, 60) ?? "";
  const matchId = text(body.matchId, 60) ?? "";
  const basedOnScheduleVersion = typeof body.basedOnScheduleVersion === "number" ? body.basedOnScheduleVersion : -1;
  const games = Array.isArray(body.games) ? body.games : [];
  const evidenceIds = Array.isArray(body.evidenceIds)
    ? body.evidenceIds.filter((x): x is string => typeof x === "string")
    : [];
  // 裁判端所见对阵（逐场前置条件）：只做回传校验，不作为身份依据
  const expectedTeamAName = text(body.expectedTeamAName, 80);
  const expectedTeamBName = text(body.expectedTeamBName, 80);

  if (!eventId || !matchId) return Response.json({ message: "缺少赛事或比赛 ID" }, { status: 400 });

  const result = await refereeSubmit(eventId, credential, {
    matchId,
    basedOnScheduleVersion,
    games,
    evidenceIds,
    expectedTeamAName,
    expectedTeamBName,
  });
  if (!result.ok) {
    // 对阵已变更是「先看后写」冲突，客户端需要刷新后重看，用 409 与校验失败区分开
    const status = result.code === "MATCH_CHANGED" ? 409 : 400;
    return Response.json({ message: result.error }, { status });
  }
  return Response.json(result.value);
}
