// =====================
// RPT-04 裁判会话令牌（无状态 HMAC，对齐 auth.ts 模式）
// 裁判用一次性凭证登录 → 换取会话令牌（cookie 只放令牌，不放凭证明文）。
// 会话内容由服务端签名，防篡改，不信任客户端传入的 refereeId。
// =====================

import { createHmac, timingSafeEqual } from "node:crypto";

export const REFEREE_SESSION_COOKIE = "referee_session";

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * 签发裁判会话令牌：`refereeId.eventId.expiresAtMs.签名`。
 * refereeId / eventId 进 payload 由服务端签名，客户端无法伪造。
 */
export function issueRefereeSession(input: {
  refereeId: string;
  eventId: string;
  expiresAtMs: number;
  secret: string;
}): string {
  const payload = `${input.refereeId}.${input.eventId}.${input.expiresAtMs}`;
  return `${payload}.${sign(payload, input.secret)}`;
}

export interface VerifiedRefereeSession {
  refereeId: string;
  eventId: string;
}

/**
 * 校验裁判会话令牌：签名正确且未过期。
 * 返回 { refereeId, eventId }，调用方据此再查分配关系推导权限（不信任客户端字段）。
 */
export function verifyRefereeSession(token: string | undefined | null, secret: string, nowMs: number = Date.now()): VerifiedRefereeSession | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!payload || !signature) return null;
  if (!safeEqual(signature, sign(payload, secret))) return null;

  const parts = payload.split(".");
  if (parts.length !== 3) return null;
  const [refereeId, eventId, expiresAtStr] = parts;
  if (!refereeId || !eventId || !expiresAtStr) return null;
  const expiresAtMs = Number(expiresAtStr);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) return null;

  return { refereeId, eventId };
}