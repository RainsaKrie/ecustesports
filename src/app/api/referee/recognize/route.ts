// =====================
// POST /api/referee/recognize —— 上传一局截图并识别，返回填表建议
//
// 这是「AI 识图报分」的入口。一次请求完成三件事：
//   1. 把图存成凭证（复用 RPT-07a 的上传链路）—— 图因此进入系统，赛后可用于优化
//   2. 调视觉模型读出这一局的比分与分组
//   3. 用双方名单校正左右，产出填表建议
//
// 三条边界（不可越过）：
//   · **AI 不写赛果。** 本接口只返回「建议」，最终写入仍走 /api/referee/submit，
//     由裁判确认后提交。ADR「不让 AI 绕过裁判确认写赛果」不因本功能而改。
//   · **识别失败不等于上传失败。** 图已存下来，裁判仍可手工填分。
//   · **不猜。** 定向证据不足时不校正左右，只如实提示，交人判断。
// =====================

import type { NextRequest } from "next/server";
import { readRefereeCredential } from "@/lib/referee/referee-auth";
import { refereeReportingEnabled } from "@/lib/referee/feature-flag";
import { refereeMatchContext, refereeUploadEvidence } from "@/lib/referee/reporting-data";
import {
  callVisionModel,
  toDataUrl,
  visionConfigHint,
  visionOptionsFromEnv,
} from "@/lib/referee/result-vision";
import { buildRecognizeSuggestion } from "@/lib/referee/recognize-result";
import { hashEvidenceBytes } from "@/lib/scheduling/evidence-ops";
import { MAX_EVIDENCE_BYTES } from "@/lib/scheduling/evidence-domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 上传 + 模型调用串行，给足时间；超过这个时长说明上游异常，让请求失败而不是吊着裁判
export const maxDuration = 60;

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: NextRequest) {
  if (!refereeReportingEnabled()) {
    return Response.json({ message: "裁判报分功能暂未开放" }, { status: 403 });
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) return Response.json({ message: "请求格式错误" }, { status: 400 });

  const file = formData.get("file");
  if (!(file instanceof File)) return Response.json({ message: "请选择截图" }, { status: 400 });

  const credential = (text(formData.get("credential"), 200) || readRefereeCredential(request)).slice(0, 200);
  const eventId = text(formData.get("eventId"), 60);
  const matchId = text(formData.get("matchId"), 60);
  const gameIndex = Number(text(formData.get("gameIndex"), 6)) || 1;
  if (!eventId || !matchId) return Response.json({ message: "缺少赛事或比赛 ID" }, { status: 400 });
  if (!Number.isSafeInteger(gameIndex) || gameIndex < 1 || gameIndex > 9) {
    return Response.json({ message: "局次不合法" }, { status: 400 });
  }

  if (file.size <= 0 || file.size > MAX_EVIDENCE_BYTES) {
    return Response.json({ message: "图片大小必须在 5MB 以内" }, { status: 400 });
  }

  // 先鉴权、先取上下文：未分配的场次直接拒绝，不浪费模型额度、也不泄露名单
  const context = await refereeMatchContext(eventId, credential, matchId);
  if (!context.ok) {
    const status = ["INVALID_CREDENTIAL", "DISABLED", "EXPIRED", "NOT_ASSIGNED", "WRONG_EVENT"].includes(context.code ?? "")
      ? 401
      : 400;
    return Response.json({ message: context.error }, { status });
  }
  const match = context.value.match;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = hashEvidenceBytes(bytes);

  // 先存图。这样即使识别失败，凭证也已留档，裁判仍可手工报分。
  const stored = await refereeUploadEvidence(eventId, credential, {
    matchId,
    mimeType: file.type,
    sizeBytes: file.size,
    sha256,
    bytes,
  });
  if (!stored.ok) {
    const status = ["INVALID_CREDENTIAL", "DISABLED", "EXPIRED", "NOT_ASSIGNED", "WRONG_EVENT"].includes(stored.code ?? "")
      ? 401
      : 400;
    return Response.json({ message: stored.error }, { status });
  }

  const base = { evidenceId: stored.value.evidenceId, expiresAt: stored.value.expiresAt, gameIndex };

  const options = visionOptionsFromEnv();
  if (!options) {
    // 配置缺失不是错误：图已存下，裁判手工填分即可。如实说明原因，不静默失败。
    return Response.json({
      ...base,
      recognized: false,
      suggestion: null,
      message: visionConfigHint(),
    });
  }

  const outcome = await callVisionModel(
    {
      caseId: `${matchId}#${gameIndex}`,
      teams: { a: match.teamAName, b: match.teamBName },
      boType: match.boType,
      game: "valorant",
      pageType: "对局结果页（计分板）",
      knownMaps: match.mapSequence,
      squads: match.squads,
      note:
        match.mapSequence.length > 0
          ? `这张图应当是本场比赛的第 ${gameIndex} 局，对应地图：${match.mapSequence[gameIndex - 1] ?? "（BP 序列里没有这一局）"}`
          : `这张图应当是本场比赛的第 ${gameIndex} 局（BP 地图未确定）`,
      images: [toDataUrl(bytes, file.type || "image/jpeg")],
    },
    options,
  );

  if (outcome.refused) {
    return Response.json({
      ...base,
      recognized: false,
      suggestion: null,
      message: `模型拒绝识别：${outcome.refusedReason ?? "key 信息不足"}`,
    });
  }
  if (!outcome.parsed) {
    return Response.json({
      ...base,
      recognized: false,
      suggestion: null,
      message: outcome.parseError ?? "识别失败，请手工填写",
    });
  }

  const suggestion = buildRecognizeSuggestion(outcome.parsed, {
    matchId,
    gameIndex,
    boType: match.boType,
    teams: { a: match.teamAName, b: match.teamBName },
    mapSequence: match.mapSequence,
    squads: match.squads,
  });

  return Response.json({
    ...base,
    recognized: true,
    // 只回传建议，不回传模型原文——原文可能含图上所有信息，没有必要外露
    suggestion,
    usage: outcome.usage,
  });
}
