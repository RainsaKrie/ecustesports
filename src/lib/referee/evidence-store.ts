// =====================
// RPT-07a 赛果凭证私有存储（对齐工作包 02 §5「私有比赛凭证存储」）
//
// 与公开海报空间（asset-store 的 event-assets bucket）隔离：
//   - 本地：写入 data/evidence/<eventId>/<不透明文件名>，绝不进 public/uploads。
//   - 生产：写入 Supabase 私有 bucket `match-evidence`（无公开 URL，读取走鉴权签名）。
//
// 对象名重复使用 evidence-ops 的 buildOpaqueObjectPath 结果，只含 eventId + 不透明 ID，
// 不含 displayName / refereeId / matchId（ADR §3 冻结）。
// =====================

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertSafeEventId } from "@/lib/data-store-types";
import { isHostedRuntime } from "@/lib/deployment";
import { normalizeSupabaseProjectUrl } from "@/lib/supabase-config";

const EVIDENCE_BUCKET = "match-evidence";

function selectedBackend(): "file" | "supabase" {
  const configured = process.env.DATA_BACKEND?.trim().toLowerCase();
  if (configured === "file" || configured === "supabase") return configured;
  if (isHostedRuntime()) throw new Error("托管环境必须显式设置 DATA_BACKEND=supabase");
  return "file";
}

function supabaseConfig(): { url: string; secret: string } {
  const url = normalizeSupabaseProjectUrl(process.env.SUPABASE_URL);
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error("凭证存储缺少 Supabase 配置");
  return { url, secret };
}

/**
 * 把凭证字节写入私有存储。
 * @param objectName 以 bucket 名为前缀的对象路径（如 `match-evidence/<eventId>/<id>.jpg`）。
 *                   纯函数 buildOpaqueObjectPath 返回的正是这个形状。
 * @returns 生产返回私有对象名（不含账号）；本地返回相对 data 目录的落盘路径（仅可复现，不对外）。
 */
export async function storeEvidenceObject(input: {
  eventId: string;
  objectName: string;
  mimeType: string;
  bytes: Uint8Array;
}): Promise<{ stored: boolean }> {
  const eventId = assertSafeEventId(input.eventId);

  if (selectedBackend() === "file") {
    const fileName = input.objectName.split("/").pop() ?? input.objectName;
    const directory = path.join(process.cwd(), "data", "evidence", eventId);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, fileName), input.bytes);
    return { stored: true };
  }

  const { url, secret } = supabaseConfig();
  // objectName 形如 `match-evidence/<eventId>/<id>.jpg`；去掉 bucket 前缀得 Supabase object name。
  const objectName = input.objectName.startsWith(`${EVIDENCE_BUCKET}/`)
    ? input.objectName.slice(EVIDENCE_BUCKET.length + 1)
    : input.objectName;
  const objectUrl = `${url}/storage/v1/object/${EVIDENCE_BUCKET}/${objectName}`;
  const body = Uint8Array.from(input.bytes).buffer;
  const response = await fetch(objectUrl, {
    method: "POST",
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      "Content-Type": input.mimeType,
      "x-upsert": "false",
    },
    body,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`凭证存储失败（HTTP ${response.status}）${detail ? `：${detail.slice(0, 200)}` : ""}`);
  }
  return { stored: true };
}