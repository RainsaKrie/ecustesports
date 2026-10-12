import { isHostedRuntime } from "@/lib/deployment";
import { normalizeSupabaseProjectUrl } from "@/lib/supabase-config";

export interface OperationAuditInput {
  eventId?: string;
  actorType: "admin" | "participant" | "system";
  action: string;
  target?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

function supabaseConfig(): { url: string; secret: string } {
  const url = normalizeSupabaseProjectUrl(process.env.SUPABASE_URL);
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error("操作日志缺少 Supabase 配置");
  return { url, secret };
}

function auditSecret(): string {
  const value = process.env.RATE_LIMIT_SECRET?.trim();
  if (!value || value.length < 32) throw new Error("操作日志缺少至少 32 字符的 RATE_LIMIT_SECRET");
  return value;
}

function clientAddress(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "unknown";
}

async function hashActor(request: Request): Promise<string> {
  const bytes = new TextEncoder().encode(`${auditSecret()}:${clientAddress(request)}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * 写一条操作日志。**只在本文件内使用**：调用方一律走 `recordOperationAuditSafely`，
 * 因为日志故障不该把已经提交成功的业务操作伪装成失败。之前它是对外导出的，
 * 但全仓库没有任何地方直接调用它。
 */
async function recordOperationAudit(request: Request, input: OperationAuditInput): Promise<void> {
  // 本地开发不建立另一套日志事实源；业务数据内部操作记录保持原样。
  if (!isHostedRuntime()) return;

  const { url, secret } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/operation_audit`, {
    method: "POST",
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      event_id: input.eventId || null,
      actor_type: input.actorType,
      actor_hash: await hashActor(request),
      action: input.action.slice(0, 80),
      target: input.target?.slice(0, 160) || null,
      metadata: input.metadata ?? {},
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`操作日志写入失败（HTTP ${response.status}）${detail ? `：${detail.slice(0, 200)}` : ""}`);
  }
}

export async function recordOperationAuditSafely(request: Request, input: OperationAuditInput): Promise<void> {
  try {
    await recordOperationAudit(request, input);
  } catch (error) {
    // 日志故障不能把已成功提交的业务操作伪装成失败；生产监控应收集此错误。
    console.error("operation audit failed", error);
  }
}
