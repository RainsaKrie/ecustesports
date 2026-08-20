import { revalidatePath } from "next/cache";
import { getSiteConfig, saveSiteConfig } from "@/lib/site-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await getSiteConfig());
}

export async function PUT(request: Request) {
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

    return Response.json({ config, message: "已保存并同步到前台。" });
  } catch {
    return Response.json({ message: "保存失败，请检查填写内容后重试。" }, { status: 400 });
  }
}
