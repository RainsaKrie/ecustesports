// =====================
// 管理员鉴权：无状态会话 token（HMAC 签名）+ 密码校验
// - 会话 token 不落盘，靠签名校验，重启不失效
// - 生产环境务必通过环境变量设置 AUTH_SECRET 与 ADMIN_PASSWORD
// =====================

import { createHmac, timingSafeEqual } from "node:crypto";
import { isHostedRuntime } from "@/lib/deployment";

export const SESSION_COOKIE_NAME = "admin_session";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

function requiredHostedSecret(name: "AUTH_SECRET" | "ADMIN_PASSWORD", localFallback: string, minLength: number): string {
  const value = process.env[name]?.trim();
  if (isHostedRuntime()) {
    if (!value) throw new Error(`Vercel 环境缺少 ${name}`);
    if (value.length < minLength) throw new Error(`${name} 长度不足，至少需要 ${minLength} 个字符`);
  }
  return value || localFallback;
}

// 本地保留固定值方便开发；任何 Vercel 环境都必须提供独立强密钥和强密码。
const SECRET = requiredHostedSecret("AUTH_SECRET", "ecust-esports-admin-secret-2026", 32);
const ADMIN_PASSWORD = requiredHostedSecret("ADMIN_PASSWORD", "ecust2026", 12);

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("hex");
}

/** 恒定时间比较，避免时序侧信道 */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** 校验管理员密码 */
export function verifyPassword(input: string): boolean {
  return safeEqual(input, ADMIN_PASSWORD);
}

/** 生成会话 token：`过期时间戳.签名` */
export function createSessionToken(): string {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = String(expiresAt);
  return `${payload}.${sign(payload)}`;
}

/** 校验会话 token 是否有效（签名正确且未过期） */
export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!payload || !signature) return false;
  if (!safeEqual(signature, sign(payload))) return false;
  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}
