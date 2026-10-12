import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";
import { getSiteConfig, saveSiteConfig } from "@/lib/site-config";
import { isAdminRequest } from "@/lib/auth";
import { recordOperationAuditSafely } from "@/lib/operation-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ⚠️ **GET 必须保持公开，不要给它加鉴权。**
 *
 * 它是「不登录也能只读核实线上配置」的唯一入口 —— 用
 * `GET https://ecustesports.top/api/admin/site-config` 可以确认生产配置的实际值
 * （例如赛事 ID、可见性、阶段），这是排查「配置值对但页面显示不对」这类问题的起点。
 * 它只返回站点配置，不含任何选手个人信息。
 *
 * 若将来确实需要收紧，请先确认还有别的只读核实途径，否则会让生产排查失去抓手。
 */
export async function GET() {
  return Response.json(await getSiteConfig());
}

export async function PUT(request: NextRequest) {
  if (!isAdminRequest(request)) return Response.json({ message: "未登录或会话已过期" }, { status: 401 });
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 200_000) {
      return Response.json({ message: "配置内容过大，无法保存。" }, { status: 413 });
    }

    const config = await saveSiteConfig(await request.json());
    revalidatePath("/", "layout");
    revalidatePath("/events");
    revalidatePath("/events/[id]", "page");
    revalidatePath("/admin", "layout");

    await recordOperationAuditSafely(request, {
      actorType: "admin",
      action: "site-config.updated",
      // 整体重写站点配置是高风险操作，但内容就是公开的站点配置本身，
      // 记条数与更新时间足够定位「谁在什么时候覆盖过全站配置」，且不含个人信息。
      metadata: { eventCount: config.events.length, updatedAt: config.updatedAt },
    });

    return Response.json({ config, message: "已保存并同步到前台。" });
  } catch {
    return Response.json({ message: "保存失败，请检查填写内容后重试。" }, { status: 400 });
  }
}
