// =====================
// RPT-05 裁判凭证读取（对齐 participant-auth.ts 的 token header 模式）
// 裁判凭证本身即高熵随机数（randomBytes(24)），服务端只存哈希；
// 每个请求由凭证 → 身份 → 分配关系推导权限，不信任客户端 refereeId。
// =====================

import "server-only";

export function readRefereeCredential(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.startsWith("Bearer ")) return authorization.slice(7).trim();
  return request.headers.get("x-referee-credential")?.trim() ?? "";
}
