import type { NextRequest } from "next/server";
import { AssetValidationError, uploadEventImage } from "@/lib/asset-store";
import { isAdminRequest } from "@/lib/domains/identity/admin-session";
import { recordOperationAuditSafely } from "@/lib/operation-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) return Response.json({ message: "未登录或会话已过期" }, { status: 401 });
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const eventId = String(formData.get("eventId") ?? "").trim();
    if (!(file instanceof File)) {
      return Response.json({ message: "请选择图片文件。" }, { status: 400 });
    }
    if (file.size > 5 * 1024 * 1024) {
      return Response.json({ message: "图片不能超过 5MB。" }, { status: 413 });
    }
    const uploaded = await uploadEventImage({
      eventId,
      mimeType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    await recordOperationAuditSafely(request, {
      eventId,
      actorType: "admin",
      action: "asset.uploaded",
      // 只记不透明对象名（形如 events/<eventId>/hero-<uuid>.jpg），不记含账号的完整 URL
      target: uploaded.objectName,
      metadata: { bytes: file.size, mimeType: file.type },
    });
    return Response.json({ path: uploaded.path });
  } catch (error) {
    // 只把「用户能据此改对输入」的校验错误回传；内部故障（缺配置、上游响应细节）
    // 一律泛化，避免泄露部署与环境信息。
    if (error instanceof AssetValidationError) {
      return Response.json({ message: error.message }, { status: 400 });
    }
    return Response.json({ message: "图片上传失败，请重试。" }, { status: 400 });
  }
}
