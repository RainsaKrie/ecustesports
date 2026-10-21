// =====================
// POST /api/referee/submit —— 提交赛果（凭证推导身份；幂等；对阵变更 409）
// =====================

import type { NextRequest } from "next/server";
import { readRefereeCredential } from "@/lib/domains/result/referee-auth";
import { refereeReportingEnabled } from "@/lib/domains/result/feature-flag";
import { refereeFailureResponse } from "@/lib/domains/result/failure-response";
import { refereeSubmit } from "@/lib/domains/result/reporting-data";
import { withApiError } from "@/lib/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

async function handlePOST(request: NextRequest) {
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
    // 状态码与文案走统一的映射（原先这里把所有失败都报 400，于是「凭证失效」
    // 在界面上显示的是一串内部码 `INVALID_CREDENTIAL`）。
    // 对阵已变更是「先看后写」冲突，客户端需要刷新后重看，用 409 与校验失败区分开。
    return refereeFailureResponse(result, { MATCH_CHANGED: 409 });
  }
  return Response.json(result.value);
}

export const POST = withApiError(handlePOST);
