import { isHostedRuntime } from "@/lib/deployment";
import { resolveDataBackend } from "@/lib/data-backend";
import { normalizeSupabaseProjectUrl } from "@/lib/supabase-config";

interface RateLimitInput {
  clientKey: string;
  action: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface LocalBucket {
  count: number;
  resetAt: number;
}

const localBuckets = new Map<string, LocalBucket>();

function rateLimitSecret(): string {
  const value = process.env.RATE_LIMIT_SECRET?.trim();
  if (isHostedRuntime() && (!value || value.length < 32)) {
    throw new Error("Vercel 环境缺少至少 32 字符的 RATE_LIMIT_SECRET");
  }
  return value || "local-rate-limit-secret";
}

async function hashKey(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${rateLimitSecret()}:${value}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function localConsume(keyHash: string, input: RateLimitInput): RateLimitResult {
  const now = Date.now();
  const windowMs = input.windowSeconds * 1000;
  const bucketStart = Math.floor(now / windowMs) * windowMs;
  const bucketKey = `${keyHash}:${input.action}:${bucketStart}`;
  const current = localBuckets.get(bucketKey);
  const count = (current?.count ?? 0) + 1;
  const resetAt = bucketStart + windowMs;
  localBuckets.set(bucketKey, { count, resetAt });

  if (localBuckets.size > 2_000) {
    for (const [key, bucket] of localBuckets) {
      if (bucket.resetAt <= now) localBuckets.delete(key);
    }
  }

  return {
    allowed: count <= input.limit,
    remaining: Math.max(0, input.limit - count),
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
  };
}

async function supabaseConsume(keyHash: string, input: RateLimitInput): Promise<RateLimitResult> {
  const url = normalizeSupabaseProjectUrl(process.env.SUPABASE_URL);
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error("限流服务缺少 Supabase 配置");

  const response = await fetch(`${url}/rest/v1/rpc/consume_rate_limit`, {
    method: "POST",
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_key_hash: keyHash,
      p_action: input.action,
      p_window_seconds: input.windowSeconds,
      p_limit: input.limit,
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`限流服务不可用（HTTP ${response.status}）${detail ? `：${detail.slice(0, 200)}` : ""}`);
  }
  const rows = (await response.json()) as Array<{
    allowed: boolean;
    remaining: number;
    reset_at: string;
  }>;
  const row = rows[0];
  if (!row) throw new Error("限流服务未返回结果");
  return {
    allowed: row.allowed,
    remaining: Math.max(0, row.remaining),
    retryAfterSeconds: Math.max(1, Math.ceil((new Date(row.reset_at).getTime() - Date.now()) / 1000)),
  };
}

export async function consumeRateLimit(input: RateLimitInput): Promise<RateLimitResult> {
  const keyHash = await hashKey(input.clientKey);
  return resolveDataBackend() === "supabase" ? supabaseConsume(keyHash, input) : localConsume(keyHash, input);
}
