import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";
import { getSiteConfig, updateSiteConfig } from "@/lib/site-config";
import { eventDescriptionIssue, footerStatusIssue } from "@/lib/site-content-limits";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { recordOperationAuditSafely } from "@/lib/operation-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 路由级鉴权。网关已拦未登录写请求，这里是第二层纵深防御，见 SYS-04 审计报告第 3 节。
function isAdmin(request: NextRequest): boolean {
  return verifySessionToken(request.cookies.get(SESSION_COOKIE_NAME)?.value);
}

export async function PATCH(request: NextRequest) {
  if (!isAdmin(request)) return Response.json({ message: "未登录或会话已过期" }, { status: 401 });
  try {
    const body = await request.json() as { eventId?: string; description?: string; footerStatus?: string };
    const eventId = String(body.eventId ?? "").trim();
    const description = String(body.description ?? "").trim();
    const footerStatus = String(body.footerStatus ?? "").trim();
    if (!eventId) return Response.json({ message: "缺少赛事 ID" }, { status: 400 });

    // 字数规则来自 site-content-limits，与「赛事设置 → 玩家页面」共用同一套，
    // 避免两边规则漂移导致「在 A 处能存、在 B 处报错」。
    const descriptionIssue = eventDescriptionIssue(description);
    if (descriptionIssue) return Response.json({ message: descriptionIssue.message }, { status: 400 });
    const footerIssue = footerStatusIssue(footerStatus);
    if (footerIssue) return Response.json({ message: footerIssue.message }, { status: 400 });

    // 赛事存在性改用**显式分支**判断（原先是在 updater 里 throw）。
    // 这样下面的 catch 可以完全泛化：既不丢「赛事不存在」这个有用提示，
    // 也不会把数据层的内部故障（缺配置、上游 HTTP 细节）回传给客户端。
    const existing = await getSiteConfig();
    if (!existing.events.some((event) => event.id === eventId)) {
      return Response.json({ message: "赛事不存在" }, { status: 400 });
    }

    const config = await updateSiteConfig((current) => {
      // 防御性兜底：上面的检查与这里之间存在极小的并发窗口（赛事被同时删除）。
      // 这里仍然拦一下，确保不会给不存在的赛事写入文案。
      if (!current.events.some((event) => event.id === eventId)) throw new Error("赛事不存在");
      return {
        ...current,
        brand: { ...current.brand, footerStatus },
        events: current.events.map((event) => event.id === eventId ? { ...event, description } : event),
      };
    });

    revalidatePath("/", "layout");
    revalidatePath(`/events/${eventId}`);
    revalidatePath(`/admin/events/${eventId}`, "layout");

    await recordOperationAuditSafely(request, {
      eventId,
      actorType: "admin",
      action: "event.site-content.updated",
      // 这两段文案本来就是公开内容，但审计只记字段与长度即可定位改动，
      // 不必把正文再抄一份进日志。
      metadata: { descriptionLength: description.length, footerLength: footerStatus.length },
    });

    return Response.json({ config, message: "已同步官网" });
  } catch {
    return Response.json({ message: "保存失败，请稍后重试" }, { status: 400 });
  }
}
