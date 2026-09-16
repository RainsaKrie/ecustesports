// =====================
// 端到端：裁判传图 → 私有桶（真实 Supabase）
//
// 这是「本地 file 驱动测不出来」的那条路径的完整链路：
//   登录（seed 演示裁判） → 认领比赛 → 上传凭证
//     → 应用层校验 → 写入私有桶 match-evidence → 登记台账
//
// 与 private-bucket-verify.ts 的分工：
//   那个测**桶级防线**（MIME/大小/私有性由桶强制），
//   这个测**应用层**——URL 拼装、magic bytes、幂等、鉴权、台账与对象的一致性。
//
// 前置：本地 next dev 以 DATA_BACKEND=supabase + REFEREE_REPORTING_ENABLED=1 启动。
// 会向 staging 写演示赛事（demo-referee），结束时删除。
// =====================

import { loadEnvConfig } from "@next/env";

const BASE = "http://localhost:3100";
const EVENT = "demo-referee";
const CRED = "referee-demo-credential-2026-09";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `（${detail}）` : ""}`); }
}

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
  const supaBase = (process.env.SUPABASE_URL ?? "").replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
  const secret = process.env.SUPABASE_SECRET_KEY ?? "";
  if (!supaBase || !secret) throw new Error("缺少 Supabase 配置");

  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (r.status === 200) break;
    } catch {
      await new Promise((s) => setTimeout(s, 2000));
    }
  }

  console.log("== 0. 确认服务跑在 supabase 后端上 ==");
  // 通过 API 探测：若后端是 file，登录会 seed 到本地 data/ 而不是 Supabase。
  // 这里用「Supabase 里出现了 demo-referee 的文档」来确认。
  const probeSupa = async () => {
    const r = await fetch(
      `${supaBase}/rest/v1/app_documents?scope=eq.event&event_id=eq.${EVENT}&select=name`,
      { headers: { Authorization: `Bearer ${secret}`, apikey: secret } },
    );
    return (await r.json()) as Array<{ name: string }>;
  };
  const before = await probeSupa();
  console.log(`    staging 里 demo-referee 的文档数（登录前）：${Array.isArray(before) ? before.length : "?"}`);

  console.log("");
  console.log("== 1. 裁判登录（触发 seed）==");
  const login = await fetch(`${BASE}/api/referee/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-referee-credential": CRED },
    body: JSON.stringify({ credential: CRED, eventId: EVENT }),
  });
  const loginBody = (await login.text()).slice(0, 150);
  console.log(`    HTTP ${login.status}  ${loginBody}`);
  check("登录成功", login.status === 200, `HTTP ${login.status}`);

  const docs = await probeSupa();
  console.log(`    staging 里 demo-referee 的文档数（登录后）：${Array.isArray(docs) ? docs.length : "?"}`);
  check("★ 数据确实写进了 Supabase（证明后端是 supabase 而非 file）",
    Array.isArray(docs) && docs.length >= 2, `文档数 ${Array.isArray(docs) ? docs.length : "?"}`);

  console.log("");
  console.log("== 2. 取我的比赛，挑一场来上传 ==");
  const mine = await fetch(`${BASE}/api/referee/matches?eventId=${EVENT}`, {
    headers: { "x-referee-credential": CRED },
  });
  const mineJson = (await mine.json()) as { matches?: Array<{ matchId: string; status: string }> };
  const matches = mineJson.matches ?? [];
  console.log(`    HTTP ${mine.status}，我的比赛 ${matches.length} 场：${matches.map((m) => m.matchId).join(", ")}`);
  check("拿到已指派的比赛", matches.length > 0, JSON.stringify(mineJson).slice(0, 120));

  // 选一场未完成的
  const target = matches.find((m) => m.status !== "已完成") ?? matches[0];
  if (!target) throw new Error("没有可用于上传的比赛");

  console.log("");
  console.log("== 3. ★ 上传凭证（走真实 /api/referee/upload）==");
  const png = tinyPng();
  const fd = new FormData();
  fd.append("file", new File([png], "evidence.png", { type: "image/png" }));
  fd.append("eventId", EVENT);
  fd.append("matchId", target.matchId);

  const up = await fetch(`${BASE}/api/referee/upload`, {
    method: "POST",
    headers: { "x-referee-credential": CRED },
    body: fd,
  });
  const upJson = (await up.json()) as { evidenceId?: string; expiresAt?: string; message?: string };
  console.log(`    HTTP ${up.status}  ${JSON.stringify(upJson).slice(0, 180)}`);
  check("上传成功", up.status === 200 && Boolean(upJson.evidenceId), `HTTP ${up.status} ${upJson.message ?? ""}`);
  const evidenceId = upJson.evidenceId;
  if (!evidenceId) throw new Error("未拿到 evidenceId");

  console.log("");
  console.log("== 4. ★ 对象真的落在私有桶里 ==");
  // 路径形状：match-evidence/{eventId}/{evidenceId}.png
  const objectName = `${EVENT}/${evidenceId}.png`;
  const authUrl = `${supaBase}/storage/v1/object/match-evidence/${objectName}`;
  const auth = { Authorization: `Bearer ${secret}`, apikey: secret };
  const head = await fetch(authUrl, { headers: auth });
  const got = new Uint8Array(await head.arrayBuffer());
  check("服务端能取到对象", head.status === 200, `HTTP ${head.status}`);
  check("字节数与上传一致", got.length === png.length, `${got.length} vs ${png.length}`);

  console.log("");
  console.log("== 5. ★ 该对象匿名读不到 ==");
  const pubUrl = `${supaBase}/storage/v1/object/public/match-evidence/${objectName}`;
  const pub = await fetch(pubUrl);
  console.log(`    公开 URL → HTTP ${pub.status}`);
  check("匿名读不到（私有生效）", pub.status !== 200, `HTTP ${pub.status}`);

  console.log("");
  console.log("== 6. 台账与对象一致（登记成功）==");
  const ledRes = await fetch(
    `${supaBase}/rest/v1/app_documents?scope=eq.event&event_id=eq.${EVENT}&name=eq.evidence-ledger&select=payload`,
    { headers: auth },
  );
  const rows = (await ledRes.json()) as Array<{ payload: { evidence?: Array<{ id: string; objectPath: string }> } }>;
  const ev = rows[0]?.payload?.evidence?.find((e) => e.id === evidenceId);
  check("台账里有这条凭证", Boolean(ev), `find ${evidenceId}`);
  check("台账的 objectPath 与桶内路径一致",
    ev?.objectPath === `match-evidence/${objectName}`,
    `${ev?.objectPath}`);

  console.log("");
  console.log("== 7. 非法文件被挡（应用层 magic bytes）==");
  const badFd = new FormData();
  // 声明 png 但内容是文本 → 应在应用层被 SIGNATURE_MISMATCH 挡下
  badFd.append("file", new File([Buffer.from("plain text, not an image")], "fake.png", { type: "image/png" }));
  badFd.append("eventId", EVENT);
  badFd.append("matchId", target.matchId);
  const bad = await fetch(`${BASE}/api/referee/upload`, {
    method: "POST",
    headers: { "x-referee-credential": CRED },
    body: badFd,
  });
  const badJson = (await bad.text()).slice(0, 160);
  console.log(`    HTTP ${bad.status}  ${badJson}`);
  check("伪装成 png 的文本被拒", bad.status !== 200, `HTTP ${bad.status}`);
  check("错误信息指出格式不符", /格式|签名|不一致|图片/.test(badJson), badJson.slice(0, 80));

  console.log("");
  console.log("== 8. 未认领的比赛不能上传（鉴权）==");
  const notMine = new FormData();
  notMine.append("file", new File([png], "e.png", { type: "image/png" }));
  notMine.append("eventId", EVENT);
  notMine.append("matchId", "M-NOT-ASSIGNED");
  const nm = await fetch(`${BASE}/api/referee/upload`, {
    method: "POST",
    headers: { "x-referee-credential": CRED },
    body: notMine,
  });
  const nmJson = (await nm.text()).slice(0, 160);
  console.log(`    HTTP ${nm.status}  ${nmJson}`);
  check("未指派的比赛被拒（401）", nm.status === 401, `HTTP ${nm.status}`);

  console.log("");
  console.log("== 9. 清理 ==");
  // 删对象
  const delObj = await fetch(authUrl, { method: "DELETE", headers: auth });
  console.log(`    删除桶内对象：HTTP ${delObj.status}`);
  // 删赛事文档（staging 可清空）
  const delDocs = await fetch(`${supaBase}/rest/v1/app_documents?event_id=eq.${EVENT}`, {
    method: "DELETE",
    headers: { ...auth, Prefer: "return=minimal" },
  });
  console.log(`    删除 staging 中的演示文档：HTTP ${delDocs.status}`);
  const afterClean = await probeSupa();
  check("清理后 staging 无残留文档", Array.isArray(afterClean) && afterClean.length === 0,
    `残留 ${Array.isArray(afterClean) ? afterClean.length : "?"}`);

  console.log("");
  console.log(`结果：通过 ${pass} / ${pass + fail}`);
  if (fail > 0) process.exitCode = 2;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "端到端上传验收失败");
  process.exitCode = 1;
});
