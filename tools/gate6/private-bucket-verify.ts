// =====================
// 私有凭证桶（match-evidence）的安全属性验收
//
// 这个脚本测的是**桶级防线**，不是应用代码：
//   · 服务端密钥能写能读
//   · 匿名绝对读不到（私有桶的全部意义）
//   · MIME 白名单与 5MB 上限由**桶**强制（应用层被绕过时，桶是最后一道）
//   · 同路径重传不静默覆盖
//
// 为什么不 import `src/lib/referee/evidence-store`：
// 该模块 `import "server-only"`，而 `server-only` 由 Next 内部提供、不在 node_modules 里，
// 纯 Node 下解析不到（装真包反而会主动抛错）。
// **应用层那条路径改由端到端验收覆盖**——走 /api/referee/upload，在 Next 里运行，
// server-only 正常解析，测的是真正上线的代码。
//
// 只写探针赛事（rpt08probe-xxxx）目录下的对象，结束即删。
// 运行：node node_modules/tsx/dist/cli.mjs tools/gate6/private-bucket-verify.ts
// =====================

import { randomUUID, createHash } from "node:crypto";
import { loadEnvConfig } from "@next/env";

const BUCKET = "match-evidence";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `（${detail}）` : ""}`); }
}

/** 一张最小的合法 PNG（1x1 透明像素） */
function tinyPng(): Uint8Array<ArrayBuffer> {
  // 在**全新的 ArrayBuffer** 上建 Uint8Array：这样类型是 Uint8Array<ArrayBuffer>，
  // 可以直接作为 fetch 的 body 与 BlobPart（Uint8Array<ArrayBufferLike> 不行，TS 5.7+ 起）。
  const decoded = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  const out = new Uint8Array(decoded.length);
  out.set(decoded);
  return out;
}

async function main() {
  loadEnvConfig(process.cwd(), true);
  const base = (process.env.SUPABASE_URL ?? "").replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
  const secret = process.env.SUPABASE_SECRET_KEY ?? "";
  if (!base || !secret) throw new Error("缺少 Supabase 配置");

  const eventId = `rpt08probe-${randomUUID().slice(0, 8)}`;
  // 路径形状与 evidence-ops.buildOpaqueObjectPath 一致：
  //   match-evidence/{eventId}/{不透明ID}.{ext}
  const objectName = `${eventId}/${randomUUID()}.png`;
  const objectPath = `${BUCKET}/${objectName}`;
  const authUrl = `${base}/storage/v1/object/${BUCKET}/${objectName}`;
  const publicUrl = `${base}/storage/v1/object/public/${BUCKET}/${objectName}`;
  const auth = { Authorization: `Bearer ${secret}`, apikey: secret };
  const bytes = tinyPng();

  console.log(`探针对象：${objectPath}`);
  console.log(`目标项目：${base}`);
  console.log("");

  try {
    console.log("== 1. 服务端密钥写入 ==");
    const w = await fetch(authUrl, {
      method: "POST",
      headers: { ...auth, "Content-Type": "image/png", "x-upsert": "false" },
      body: bytes,
    });
    const wBody = (await w.text()).slice(0, 150);
    console.log(`    HTTP ${w.status}  ${wBody}`);
    check("写入成功", w.status === 200 || w.status === 201, `HTTP ${w.status}`);

    console.log("");
    console.log("== 2. 服务端密钥读回 ==");
    const r = await fetch(authUrl, { headers: auth });
    const got = new Uint8Array(await r.arrayBuffer());
    check("读回 HTTP 200", r.status === 200, String(r.status));
    check("字节数一致", got.length === bytes.length, `${got.length} vs ${bytes.length}`);
    check(
      "sha256 一致",
      createHash("sha256").update(got).digest("hex") === createHash("sha256").update(bytes).digest("hex"),
    );

    console.log("");
    console.log("== 3. ★ 匿名读不到（私有桶的核心属性）==");
    const pub = await fetch(publicUrl);
    const pubBody = (await pub.text()).slice(0, 130);
    console.log(`    /object/public/... → HTTP ${pub.status}  ${pubBody}`);
    check("公开 URL 非 200", pub.status !== 200, `HTTP ${pub.status}`);
    check("响应不含图片内容", !pubBody.includes("PNG"), pubBody.slice(0, 50));

    const anon = await fetch(authUrl);
    const anonBody = (await anon.text()).slice(0, 130);
    console.log(`    匿名 GET          → HTTP ${anon.status}  ${anonBody}`);
    check("匿名直读非 200", anon.status !== 200, `HTTP ${anon.status}`);

    console.log("");
    console.log("== 4. 匿名无法列举对象 ==");
    const list = await fetch(`${base}/storage/v1/object/list/${BUCKET}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: `${eventId}/`, limit: 100 }),
    });
    const listBody = (await list.text()).slice(0, 130);
    console.log(`    HTTP ${list.status}  ${listBody}`);
    check(
      "匿名列举被拒或看不到对象",
      list.status !== 200 || !listBody.includes(objectName.split("/")[1]),
      listBody.slice(0, 50),
    );

    console.log("");
    console.log("== 5. ★ 桶级 MIME 白名单 ==");
    const badMime = await fetch(`${base}/storage/v1/object/${BUCKET}/${eventId}/probe.txt`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "text/plain", "x-upsert": "false" },
      body: Buffer.from("not an image"),
    });
    const bmBody = (await badMime.text()).slice(0, 130);
    console.log(`    text/plain → HTTP ${badMime.status}  ${bmBody}`);
    check("桶拒绝 text/plain", badMime.status !== 200, `HTTP ${badMime.status}`);

    console.log("");
    console.log("== 6. ★ 桶级 5MB 上限 ==");
    const sixMb = new Uint8Array(6 * 1024 * 1024);
    sixMb.set(tinyPng(), 0); // 首字节是 PNG magic，确保不是被 magic 检查拦下
    const big = await fetch(`${base}/storage/v1/object/${BUCKET}/${eventId}/probe-big.png`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "image/png", "x-upsert": "false" },
      body: sixMb,
    });
    const bigBody = (await big.text()).slice(0, 130);
    console.log(`    6MB image/png → HTTP ${big.status}  ${bigBody}`);
    check("桶拒绝超过 5MB 的对象", big.status !== 200, `HTTP ${big.status}`);

    console.log("");
    console.log("== 7. 同路径重传不静默覆盖 ==");
    const dup = await fetch(authUrl, {
      method: "POST",
      headers: { ...auth, "Content-Type": "image/png", "x-upsert": "false" },
      body: bytes,
    });
    const dupBody = (await dup.text()).slice(0, 130);
    console.log(`    重传同路径 → HTTP ${dup.status}  ${dupBody}`);
    check("重传被拒（不会覆盖既有凭证）", dup.status !== 200, `HTTP ${dup.status}`);

    console.log("");
    console.log("== 8. 删除生效 ==");
    const del = await fetch(authUrl, { method: "DELETE", headers: auth });
    console.log(`    DELETE → HTTP ${del.status}`);
    check("删除成功", del.status === 200, String(del.status));
    const after = await fetch(authUrl, { headers: auth });
    check("删除后取不到", after.status !== 200, `HTTP ${after.status}`);
  } finally {
    // 兜底：把探针赛事目录下的对象清干净（中途失败也不留孤儿文件）
    try {
      const list = await fetch(`${base}/storage/v1/object/list/${BUCKET}`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ prefix: `${eventId}/`, limit: 100 }),
      });
      const items = (await list.json()) as Array<{ name?: string }>;
      for (const it of Array.isArray(items) ? items : []) {
        if (!it.name) continue;
        await fetch(`${base}/storage/v1/object/${BUCKET}/${eventId}/${it.name}`, { method: "DELETE", headers: auth });
      }
      console.log("");
      console.log(`已清理探针对象（${eventId}）`);
    } catch {
      console.log("清理时出错，请人工确认 " + eventId);
    }
  }

  console.log("");
  console.log(`结果：通过 ${pass} / ${pass + fail}`);
  if (fail > 0) process.exitCode = 2;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "私有桶验收失败");
  process.exitCode = 1;
});
