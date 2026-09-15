import { revalidatePath } from "next/cache";
import { updateSiteConfig } from "@/lib/site-config";
import { eventDescriptionIssue, footerStatusIssue } from "@/lib/site-content-limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
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

    const config = await updateSiteConfig((current) => {
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
    return Response.json({ config, message: "已同步官网" });
  } catch (error) {
    return Response.json({ message: error instanceof Error ? error.message : "保存失败" }, { status: 400 });
  }
}
