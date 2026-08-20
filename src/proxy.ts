import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

// 不需要登录的公开 API 写接口（登录/登出、玩家报名与组队、BP 会话[服务端按操作校验身份]）
const PUBLIC_WRITE_PATHS = [
  "/api/admin/login",
  "/api/admin/logout",
  "/api/public/register",
  "/api/public/team",
  "/api/public/team/member",
  "/api/data/bp",
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const authed = verifySessionToken(token);

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
    const method = request.method.toUpperCase();
    const isWrite = ["POST", "PUT", "DELETE", "PATCH"].includes(method);
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
