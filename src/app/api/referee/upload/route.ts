// =====================
// POST /api/referee/upload —— 上传赛果凭证草稿（RPT-07a）
//
// 流程（对齐工作包 02 §5 / §6「图片先上传后提交」）：
//   1. 功能开关校验（refereeReportingEnabled）。
//   2. multipart 读 file 字段 + eventId（凭证走 x-referee-credential header 或 body.credential）。
//   3. 校验 MIME / 大小 / magic bytes / sha256（本地计算），非法 400。
//   4. 权限推导 authorizeReferee（凭证→身份→分配关系），拒绝未分配/停用/越权。
//   5. 生成待登记记录（查重 / 数量上限 / 幂等），再写入私有对象。
//   6. 以并发安全更新登记台账；登记失败时回滚对象，避免悬空台账或孤儿文件。
//
// 返回 evidenceId 供前端携带进 submit 的 evidenceIds。
// =====================

import type { NextRequest } from "next/server";
import { readRefereeCredential } from "@/lib/referee/referee-auth";
import { refereeReportingEnabled } from "@/lib/referee/feature-flag";
import { refereeFailureResponse } from "@/lib/referee/failure-response";
import { refereeUploadEvidence } from "@/lib/referee/reporting-data";
import { hashEvidenceBytes } from "@/lib/domains/schedule/evidence-ops";
import { MAX_EVIDENCE_BYTES } from "@/lib/domains/schedule/evidence-domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const eventId = text(formData.get("eventId"), 60);
  const matchId = text(formData.get("matchId"), 60);
  if (!eventId || !matchId) return Response.json({ message: "缺少赛事或比赛 ID" }, { status: 400 });

  const mimeType = file.type;
  if (file.size <= 0 || file.size > MAX_EVIDENCE_BYTES) {
    return Response.json({ message: "图片大小必须在 5MB 以内" }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = hashEvidenceBytes(bytes);

  // 编排层再次校验 MIME/size/sha256/magic bytes，并完成鉴权、存储与并发安全登记。
  const registered = await refereeUploadEvidence(eventId, credential, {
    matchId,
    mimeType,
    sizeBytes: file.size,
    sha256,
    bytes,
  });
  if (!registered.ok) {
    return refereeFailureResponse(registered);
  }

  return Response.json({
    evidenceId: registered.value.evidenceId,
    expiresAt: registered.value.expiresAt,
  });
}
