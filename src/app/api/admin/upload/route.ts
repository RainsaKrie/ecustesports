import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const extensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return Response.json({ message: "请选择图片文件。" }, { status: 400 });
    }
    const extension = extensions[file.type];
    if (!extension) {
      return Response.json({ message: "仅支持 JPG、PNG 或 WebP 图片。" }, { status: 415 });
    }
    if (file.size > 5 * 1024 * 1024) {
      return Response.json({ message: "图片不能超过 5MB。" }, { status: 413 });
    }

    const uploadDirectory = path.join(process.cwd(), "public", "uploads");
    await mkdir(uploadDirectory, { recursive: true });
    const fileName = `hero-${randomUUID()}.${extension}`;
    await writeFile(path.join(uploadDirectory, fileName), Buffer.from(await file.arrayBuffer()));
    return Response.json({ path: `/uploads/${fileName}` });
  } catch {
    return Response.json({ message: "图片上传失败，请重试。" }, { status: 400 });
  }
}
