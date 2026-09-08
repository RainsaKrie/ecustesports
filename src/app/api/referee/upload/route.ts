// =====================
// POST /api/referee/upload —— 上传赛果凭证草稿（RPT-07a）
//
// 流程（对齐工作包 02 §5 / §6「图片先上传后提交」）：
//   1. 功能开关校验（refereeReportingEnabled）。
//   2. multipart 读 file 字段 + eventId（凭证走 x-referee-credential header 或 body.credential）。
//   3. 校验 MIME / 大小 / magic bytes / sha256（本地计算），非法 400。
//   4. 权限推导 authorizeReferee（凭证→身份→分配关系），拒绝未分配/停用/越权。
//   5. registerEvidenceOp 注册台账（查重 / 数量上限 / 幂等）。
//   6. 只在注册成功后写字节到私有存储（storeEvidenceObject）——失败不留下悬空台账。
//
// 返回 evidenceId 供前端携带进 submit 的 evidenceIds。
// =====================

import type { NextRequest } from "next/server";
import { readRefereeCredential } from "@/lib/referee/referee-auth";
import { refereeReportingEnabled } from "@/lib/referee/feature-flag";
import { refereeUploadEvidence, DEMO_EVENT_ID } from "@/lib/referee/reporting-data";
import { storeEvidenceObject } from "@/lib/referee/evidence-store";
import { hashEvidenceBytes, buildOpaqueObjectPath } from "@/lib/scheduling/evidence-ops";
import type { EvidenceMimeType } from "@/lib/scheduling/evidence-domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

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
  if (!(file instanceof File)) {
    return Response.json({ message: "请选择凭证图片" }, { status: 400 });
  }

  const credential = (text(formData.get("credential"), 200) || readRefereeCredential(request)).slice(0, 200);
  const eventId = text(formData.get("eventId"), 60) || DEMO_EVENT_ID;
  const matchId = text(formData.get("matchId"), 60);
  if (!matchId) return Response.json({ message: "缺少比赛 ID" }, { status: 400 });

  const mimeType = file.type;
  if (!ALLOWED_MIME.has(mimeType)) {
    return Response.json({ message: "仅支持 JPG、PNG 或 WebP 图片" }, { status: 400 });
  }
  if (file.size <= 0 || file.size > MAX_EVIDENCE_BYTES) {
    return Response.json({ message: "图片大小必须在 5MB 以内" }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = hashEvidenceBytes(bytes);

  // 注册台账（内部再跑一次 MIME/size/sha256 校验 + 分配合法性 + 查重 + 数量上限）
  const registered = await refereeUploadEvidence(eventId, credential, {
    matchId,
    mimeType,
    sizeBytes: file.size,
    sha256,
  });
  if (!registered.ok) {
    const status = ["INVALID_CREDENTIAL", "DISABLED", "EXPIRED", "NOT_ASSIGNED", "WRONG_EVENT"].includes(registered.code ?? "")
      ? 401
      : 400;
    return Response.json({ message: registered.error }, { status });
  }

  // 台账注册成功后写字节；objectPath 由 evidence-ops 生成（只含 eventId + 不透明 ID）。
  const objectPath = buildOpaqueObjectPath(eventId, mimeType as EvidenceMimeType, registered.value.evidenceId);
  try {
    await storeEvidenceObject({ eventId, objectName: objectPath, mimeType, bytes });
  } catch (error) {
    return Response.json({ message: error instanceof Error ? error.message : "凭证存储失败" }, { status: 500 });
  }

  return Response.json({
    evidenceId: registered.value.evidenceId,
    expiresAt: registered.value.expiresAt,
  });
}