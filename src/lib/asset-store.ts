import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertSafeEventId } from "@/lib/data-store-types";
import { isHostedRuntime } from "@/lib/deployment";
import { normalizeSupabaseProjectUrl } from "@/lib/supabase-config";

const BUCKET = "event-assets";
const MAX_FILE_BYTES = 5 * 1024 * 1024;

/**
 * 客户端可见的校验错误。
 *
 * 用途：把「用户输入不合法」与「内部故障」分开，让路由层能安全地只展示前者。
 *
 * 为什么需要区分：本文件里的抛错混了两类——
 *   · 业务校验（该告诉用户）：「仅支持 JPG、PNG 或 WebP」这类，用户知道怎么改
 *   · 内部故障（**不该外泄**）：「托管环境必须显式设置 DATA_BACKEND=supabase」
 *     「图片存储缺少 Supabase 配置」「图片存储失败（HTTP 500）：<上游响应体>」
 * 路由层若直接回传 `error.message`，后一类会把部署配置、环境变量名和上游响应
 * 细节泄露给任何能调用该接口的人（见 SYS-04 审计报告第 4 节）。
 *
 * 约定：**只有「用户能据此改对输入」的错误才用这个类**；其余一律普通 Error，
 * 由路由层泛化。新增抛错时请按此判断。
 */
export class AssetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssetValidationError";
  }
}

const extensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function hasImageSignature(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
  }
  if (mimeType === "image/webp") {
    return bytes.length >= 12
      && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
      && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  }
  return false;
}

function selectedBackend(): "file" | "supabase" {
  const configured = process.env.DATA_BACKEND?.trim().toLowerCase();
  if (configured === "file" || configured === "supabase") return configured;
  if (isHostedRuntime()) throw new Error("托管环境必须显式设置 DATA_BACKEND=supabase");
  return "file";
}

function supabaseConfig(): { url: string; secret: string } {
  const url = normalizeSupabaseProjectUrl(process.env.SUPABASE_URL);
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error("图片存储缺少 Supabase 配置");
  return { url, secret };
}

export interface UploadedAsset {
  path: string;
  objectName: string;
}

export async function uploadEventImage(input: {
  eventId: string;
  mimeType: string;
  bytes: Uint8Array;
}): Promise<UploadedAsset> {
  const eventId = assertSafeEventId(input.eventId);
  const extension = extensions[input.mimeType];
  if (!extension) throw new AssetValidationError("仅支持 JPG、PNG 或 WebP 图片");
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_FILE_BYTES) {
    throw new AssetValidationError("图片大小必须在 5MB 以内");
  }
  if (!hasImageSignature(input.bytes, input.mimeType)) {
    throw new AssetValidationError("文件内容与图片格式不一致");
  }

  const fileName = `hero-${randomUUID()}.${extension}`;
  if (selectedBackend() === "file") {
    const uploadDirectory = path.join(process.cwd(), "public", "uploads");
    await mkdir(uploadDirectory, { recursive: true });
    await writeFile(path.join(uploadDirectory, fileName), input.bytes);
    return { path: `/uploads/${fileName}`, objectName: fileName };
  }

  const { url, secret } = supabaseConfig();
  const objectName = `events/${eventId}/${fileName}`;
  const objectUrl = `${url}/storage/v1/object/${BUCKET}/${objectName}`;
  const body = Uint8Array.from(input.bytes).buffer;
  const response = await fetch(objectUrl, {
    method: "POST",
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      "Content-Type": input.mimeType,
      "x-upsert": "false",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
    body,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`图片存储失败（HTTP ${response.status}）${detail ? `：${detail.slice(0, 200)}` : ""}`);
  }

  return {
    path: `${url}/storage/v1/object/public/${BUCKET}/${objectName}`,
    objectName,
  };
}
