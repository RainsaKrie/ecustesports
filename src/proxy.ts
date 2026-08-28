import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { consumeRateLimit } from "@/lib/rate-limit";
import { isHostedRuntime } from "@/lib/deployment";

// 不需要登录的公开 API 写接口（登录/登出、玩家报名与组队、BP 会话[服务端按操作校验身份]）
const PUBLIC_WRITE_PATHS = [
  "/api/admin/login",
  "/api/admin/logout",
  "/api/public/register",
  "/api/public/participant",
  "/api/public/team",
  "/api/public/team/request",
  "/api/public/schedule/request",
  "/api/data/bp",
];

const WRITE_LIMITS: Array<{ prefix: string; action: string; limit: number; windowSeconds: number }> = [
  { prefix: "/api/admin/login", action: "admin-login", limit: 10, windowSeconds: 15 * 60 },
  { prefix: "/api/admin/upload", action: "asset-upload", limit: 10, windowSeconds: 60 * 60 },
  { prefix: "/api/public/register", action: "registration", limit: 12, windowSeconds: 10 * 60 },
  { prefix: "/api/public/team", action: "team-operation", limit: 40, windowSeconds: 10 * 60 },
  { prefix: "/api/public/schedule/request", action: "schedule-request", limit: 30, windowSeconds: 10 * 60 },
  { prefix: "/api/data/bp", action: "bp-operation", limit: 90, windowSeconds: 60 },
  { prefix: "/api", action: "admin-write", limit: 180, windowSeconds: 10 * 60 },
];

function clientAddress(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "unknown";
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const authed = verifySessionToken(token);

  const method = request.method.toUpperCase();
  const isWrite = ["POST", "PUT", "DELETE", "PATCH"].includes(method);
  if (pathname.startsWith("/api") && isWrite) {
    const policy = WRITE_LIMITS.find((candidate) => pathname.startsWith(candidate.prefix));
    if (policy) {
      try {
        const result = await consumeRateLimit({
          clientKey: clientAddress(request),
          action: policy.action,
          limit: policy.limit,
          windowSeconds: policy.windowSeconds,
        });
        if (!result.allowed) {
          return NextResponse.json(
            { message: "操作过于频繁，请稍后重试" },
            { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
          );
        }
      } catch (error) {
        if (isHostedRuntime()) {
          return NextResponse.json(
            { message: "请求保护服务暂不可用" },
            { status: 503 },
          );
        }
        console.error(error);
      }
    }
  }

  if (pathname.startsWith("/api") && isWrite && isHostedRuntime()) {
    const origin = request.headers.get("origin");
    const configuredOrigin = process.env.APP_ORIGIN?.replace(/\/$/, "");
    const deploymentOrigin = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "";
    const allowedOrigins = new Set([configuredOrigin, deploymentOrigin].filter(Boolean));
    if (allowedOrigins.size === 0) {
      return NextResponse.json({ message: "服务端缺少来源配置" }, { status: 503 });
    }
    if (!origin || !allowedOrigins.has(origin.replace(/\/$/, ""))) {
      return NextResponse.json({ message: "请求来源不被允许" }, { status: 403 });
    }
  }

  // 1. 后台页面：未登录一律跳转到登录页
  if (pathname.startsWith("/admin")) {
    if (!authed) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  // 2. 写操作 API：未登录返回 401（登录/登出接口除外）
  if (pathname.startsWith("/api")) {
    if (isWrite && !PUBLIC_WRITE_PATHS.includes(pathname) && !authed) {
      return NextResponse.json({ message: "未登录" }, { status: 401 });
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/:path*"],
};
