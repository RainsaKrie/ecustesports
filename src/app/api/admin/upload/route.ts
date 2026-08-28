import { uploadEventImage } from "@/lib/asset-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const eventId = String(formData.get("eventId") ?? "").trim();
    if (!(file instanceof File)) {
      return Response.json({ message: "请选择图片文件。" }, { status: 400 });
    }
    if (file.size > 5 * 1024 * 1024) {
      return Response.json({ message: "图片不能超过 5MB。" }, { status: 413 });
    }
    const uploaded = await uploadEventImage({
      eventId,
      mimeType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return Response.json({ path: uploaded.path });
  } catch (error) {
    return Response.json({ message: error instanceof Error ? error.message : "图片上传失败，请重试。" }, { status: 400 });
  }
}
