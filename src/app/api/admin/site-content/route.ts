import { revalidatePath } from "next/cache";
import { updateSiteConfig } from "@/lib/site-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { eventId?: string; description?: string; footerStatus?: string };
    const eventId = String(body.eventId ?? "").trim();
    const description = String(body.description ?? "").trim();
    const footerStatus = String(body.footerStatus ?? "").trim();
    if (!eventId) return Response.json({ message: "缺少赛事 ID" }, { status: 400 });
    if (description.length < 10 || description.length > 280) return Response.json({ message: "首页赛事简介应为 10—280 字" }, { status: 400 });
    if (footerStatus.length < 4 || footerStatus.length > 100) return Response.json({ message: "页脚状态应为 4—100 字" }, { status: 400 });

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
