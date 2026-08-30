import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { uploadEventImage } from "../../src/lib/asset-store";
import { normalizeSupabaseProjectUrl } from "../../src/lib/supabase-config";

const BUCKET = "event-assets";
const VALID_IMAGE = path.join(
  process.cwd(),
  "public",
  "uploads",
  "hero-14503db8-66a1-411e-8dc6-2e1fd5b732e5.jpg",
);

interface RateLimitRow {
  allowed: boolean;
  remaining: number;
  reset_at: string;
}

async function expectFailure(run: () => Promise<unknown>, expected: RegExp): Promise<boolean> {
  try {
    await run();
    return false;
  } catch (error) {
    return error instanceof Error && expected.test(error.message);
  }
}

async function main() {
  loadEnvConfig(process.cwd(), true);
  const url = normalizeSupabaseProjectUrl(process.env.SUPABASE_URL);
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error("Gate 6 存储与限流测试缺少 Supabase staging 配置");
  process.env.DATA_BACKEND = "supabase";

  const authHeaders = {
    apikey: secret,
    Authorization: `Bearer ${secret}`,
  };
  const eventId = `gate6asset-${randomUUID().slice(0, 8)}`;
  const validBytes = new Uint8Array(await readFile(VALID_IMAGE));
  let uploadedObjectName = "";
  let publicReadStatus = 0;
  let uploadCleaned = false;

  try {
    const uploaded = await uploadEventImage({
      eventId,
      mimeType: "image/jpeg",
      bytes: validBytes,
    });
    uploadedObjectName = uploaded.objectName;
    const publicRead = await fetch(uploaded.path, { cache: "no-store" });
    publicReadStatus = publicRead.status;
  } finally {
    if (uploadedObjectName) {
      const cleanup = await fetch(`${url}/storage/v1/object/${BUCKET}/${uploadedObjectName}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      uploadCleaned = cleanup.ok;
    }
  }

  const fakeSignatureRejected = await expectFailure(
    () => uploadEventImage({
      eventId,
      mimeType: "image/jpeg",
      bytes: new TextEncoder().encode("not-an-image"),
    }),
    /格式不一致/,
  );
  const oversized = new Uint8Array(5 * 1024 * 1024 + 1);
  oversized.set([0xff, 0xd8, 0xff]);
  const oversizedRejected = await expectFailure(
    () => uploadEventImage({ eventId, mimeType: "image/jpeg", bytes: oversized }),
    /5MB/,
  );

  const rateKeyHash = createHash("sha256").update(randomUUID()).digest("hex");
  const rateAction = `gate6-${randomUUID().slice(0, 12)}`;
  const decisions: RateLimitRow[] = [];
  let rateRowsCleaned = false;
  try {
    for (let index = 0; index < 11; index += 1) {
      const response = await fetch(`${url}/rest/v1/rpc/consume_rate_limit`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          p_key_hash: rateKeyHash,
          p_action: rateAction,
          p_window_seconds: 60,
          p_limit: 10,
        }),
      });
      if (!response.ok) throw new Error(`限流 RPC 返回 HTTP ${response.status}`);
      const rows = await response.json() as RateLimitRow[];
      if (!rows[0]) throw new Error("限流 RPC 未返回判定结果");
      decisions.push(rows[0]);
    }
  } finally {
    const cleanup = await fetch(
      `${url}/rest/v1/rate_limit_buckets?key_hash=eq.${rateKeyHash}&action=eq.${rateAction}`,
      { method: "DELETE", headers: authHeaders },
    );
    rateRowsCleaned = cleanup.ok;
  }

  const firstTenAllowed = decisions.slice(0, 10).every((row) => row.allowed);
  const eleventhRejected = decisions.length === 11 && decisions[10]?.allowed === false;
  const passed = publicReadStatus === 200
    && uploadCleaned
    && fakeSignatureRejected
    && oversizedRejected
    && firstTenAllowed
    && eleventhRejected
    && rateRowsCleaned;
  const report = {
    recordedAt: new Date().toISOString(),
    validUploadBytes: validBytes.byteLength,
    validUploadPublicReadStatus: publicReadStatus,
    temporaryUploadDeleted: uploadCleaned,
    fakeImageSignatureRejected: fakeSignatureRejected,
    over5MbRejected: oversizedRejected,
    rateLimitAllowedBeforeLimit: decisions.filter((row) => row.allowed).length,
    rateLimitRejectedAtRequest: decisions.findIndex((row) => !row.allowed) + 1,
    temporaryRateRowsDeleted: rateRowsCleaned,
    passed,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!passed) process.exitCode = 2;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Gate 6 存储与限流测试失败");
  process.exitCode = 1;
});
