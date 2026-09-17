import type { NextRequest } from "next/server";
import { AssetValidationError, uploadEventImage } from "@/lib/asset-store";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { recordOperationAuditSafely } from "@/lib/operation-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 路由级鉴权。
// 网关（src/proxy.ts）已拦未登录的写请求，这里是**第二层**：纵深防御。
// 理由见 SYS-04 审计报告第 3 节 —— 只靠网关时，一旦 matcher 或路径前缀被改动，
// 保护会静默失效；两层则网关出问题时仍能自保。与本目录其余管理员路由保持一致。
function isAdmin(request: NextRequest): boolean {
  return verifySessionToken(request.cookies.get(SESSION_COOKIE_NAME)?.value);
}

export async function POST(request: NextRequest) {
  if (!isAdmin(request)) return Response.json({ message: "未登录或会话已过期" }, { status: 401 });
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
