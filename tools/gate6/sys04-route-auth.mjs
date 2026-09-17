// =====================
// SYS-04 端到端验证：管理员写路由的两层鉴权与错误不外泄
//
// 静态守卫测试（src/lib/admin-route-guards.test.ts）只能证明「代码里写了鉴权」，
// 证明不了「未登录时真的被拒」。本脚本起真实 dev server 打真实 HTTP 来验证行为。
//
// 覆盖：
//   1. 三个新补鉴权的路由：未登录 → 401，带有效会话 → 放行（不再是 401）
//   2. site-config 的 GET 仍然公开（保护线上只读核实入口）
//   3. upload 的错误消息不泄露内部信息（伪造图片 → 只看到校验提示）
//
// 只写 data/ 下自建赛事，结束时还原 site-config 快照。
// 用法：node tools/gate6/sys04-route-auth.mjs
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHmac } from "node:crypto";

const PORT = 3201;
const BASE = `http://localhost:${PORT}`;
const EVENT = "sys04-auth-check";
const EVENT_DIR = `data/events/${EVENT}`;
const ADMIN_PASSWORD = "ecust2026";
const SECRET_FALLBACK = "ecust-esports-admin-secret-2026";
const DIST_DIR = ".workbuddy/next-sys04";

let pass = 0;
const failures = [];
function check(label, ok, detail) {
  if (ok) { pass += 1; console.log(`  ✓ ${label}`); }
  else { failures.push(label); console.log(`  ✗ ${label}${detail ? `（${detail}）` : ""}`); }
}

function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function walkFiles(root, acc = []) {
  for (const e of readdirSync(root, { withFileTypes: true })) {
    const q = `${root}/${e.name}`;
    if (e.isDirectory()) walkFiles(q, acc); else acc.push(q);
  }
  return acc;
}
function walkDirs(root, acc = []) {
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (e.isDirectory()) { walkDirs(`${root}/${e.name}`, acc); acc.push(`${root}/${e.name}`); }
  }
  return acc;
}
function removeDirTree(root) {
  if (!existsSync(root)) return { files: 0, removed: true };
  const files = walkFiles(root);
  for (const f of files) { try { rmSync(f, { force: true }); } catch { /* 重试 */ } }
  const tryRmdir = (d) => {
    for (let i = 0; i < 14; i += 1) {
      try { rmSync(d, { recursive: false }); return true; } catch { sleepSync(500); }
    }
    return false;
  };
  for (const d of walkDirs(root)) tryRmdir(d);
  tryRmdir(root);
  return { files: files.length, removed: !existsSync(root) };
}
function clearNextIncrementalCache() {
  const cache = `${DIST_DIR}/dev/cache`;
  if (!existsSync(cache)) return;
  const r = removeDirTree(cache);
  console.log(`  已清 Next 增量缓存（${r.files} 个文件）`);
}

let server = null;
function startServer() {
  return new Promise((resolve, reject) => {
    server = spawn("node", ["node_modules/next/dist/bin/next", "dev", "-p", String(PORT)], {
      env: {
        ...process.env,
        CODEBUDDY_SAFE_DELETE_ENABLED: "0",
        NEXT_DIST_DIR: DIST_DIR,
        AUTH_SECRET: SECRET_FALLBACK,
        ADMIN_PASSWORD,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    server.stdout.on("data", (d) => { out += String(d); });
    server.stderr.on("data", (d) => { out += String(d); });
    server.on("error", reject);
    const t0 = Date.now();
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) });
        if (r.status === 200) { clearInterval(poll); resolve(); return; }
      } catch { /* 未就绪 */ }
      if (Date.now() - t0 > 120000) { clearInterval(poll); reject(new Error("启动超时\n" + out.slice(-800))); }
    }, 1000);
  });
}
async function stopServer() {
  if (!server) return;
  const s = server; const pid = s.pid; server = null;
  if (process.platform === "win32" && pid) {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  } else s.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 2000));
}

/** 本地自签会话 token（与 src/lib/auth.ts 的算法一致），避免依赖登录接口 */
function sessionCookie() {
  const secret = process.env.AUTH_SECRET?.trim() || SECRET_FALLBACK;
  const exp = String(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const sig = createHmac("sha256", secret).update(exp).digest("hex");
  return `admin_session=${exp}.${sig}`;
}

async function call(path, { method = "GET", body, cookie, form } = {}) {
  const headers = {};
  let payload;
  if (form) { payload = form; }
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, {
    method, headers, body: payload, signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, text, json };
}

let siteConfigBackup = null;
let tsconfigBackup = null;
/**
 * 运行前 `public/uploads/` 的文件清单。
 *
 * ⚠️ 这个目录里**有被 git 跟踪的真实仓库文件**（首页主视觉），绝不能整目录删。
 * 上传接口在本地是写到这里的，所以只能按「运行前后的差异」删掉本次新增的。
 * 第一版脚本漏了这步，留下了一个测试图片（已在开发过程中清掉）。
 */
let uploadsBefore = null;

function seed() {
  mkdirSync(EVENT_DIR, { recursive: true });
  // 记下会被本次运行改写的现场（清理时必须还原）
  tsconfigBackup = readFileSync("tsconfig.json", "utf8");
  uploadsBefore = existsSync("public/uploads") ? readdirSync("public/uploads") : [];
  writeFileSync(`${EVENT_DIR}/schedule.json`, JSON.stringify({
    config: { maxConcurrentMatches: 2, boDurations: { BO1: 45, BO3: 90, BO5: 150 }, stageStart: "2026-10-06T12:00:00", stageEnd: "2026-10-15T14:30:00" },
    configConfirmed: true, version: 1, matches: [], versions: [], requests: [], notifications: [],
  }, null, 2) + "\n", "utf8");
  writeFileSync(`${EVENT_DIR}/registration.json`, JSON.stringify({
    players: [], teams: [], teamRequests: [], operationLogs: [],
    playerRegistrationClosed: false, teamRegistrationClosed: false, frozen: false,
  }, null, 2) + "\n", "utf8");

  const cfgPath = "data/site-config.json";
  siteConfigBackup = readFileSync(cfgPath, "utf8");
  const cfg = JSON.parse(siteConfigBackup);
  cfg.events = (cfg.events ?? []).filter((e) => e.id !== EVENT);
  cfg.events.push({
    id: EVENT, name: "SYS-04 鉴权验证赛", game: "无畏契约", status: "准备中", visibility: "private",
    publishedAt: "", teamCount: 4, teamSize: 5, description: "SYS-04 鉴权与错误处理验证使用的隔离赛事，测完即删。",
    organizer: "本地验证", registrationStart: "2026-09-01", registrationEnd: "2026-09-30",
    teamRegistrationEnd: "2026-09-30", eventDateLabel: "10.06-10.15", registrationLabel: "未开始",
    stageSummary: "验证用", prizePool: "无", coverColor: "#ff4655", mapPool: ["莲华古城"],
    preparationSteps: [], rules: [], formatTemplateId: "val-16gsl-8de", eventQqGroup: "",
    proposal: { background: "", purpose: "", budget: "", prizes: "", leader: "", contact: "" },
    stageConfigs: [], createdAt: "2026-09-01T00:00:00.000Z",
  });
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n", "utf8");
}
function cleanup() {
  if (siteConfigBackup !== null) {
    writeFileSync("data/site-config.json", siteConfigBackup, "utf8");
    siteConfigBackup = null;
    console.log("  已还原 data/site-config.json");
  }
  // next dev 会因自定义 NEXT_DIST_DIR 改写 tsconfig.json（往 include 里加 types 路径）
  if (tsconfigBackup !== null) {
    writeFileSync("tsconfig.json", tsconfigBackup, "utf8");
    tsconfigBackup = null;
    console.log("  已还原 tsconfig.json");
  }
  // 只删本次新增的上传文件，保留仓库里原有的
  if (uploadsBefore !== null && existsSync("public/uploads")) {
    const now = readdirSync("public/uploads");
    const added = now.filter((f) => !uploadsBefore.includes(f));
    for (const f of added) {
      try { rmSync(`public/uploads/${f}`, { force: true }); } catch { /* 忽略 */ }
    }
    console.log(`  已删本次新增的上传文件 ${added.length} 个（原有 ${uploadsBefore.length} 个保留）`);
    uploadsBefore = null;
  }
  const r = removeDirTree(EVENT_DIR);
  console.log(`  已删 ${EVENT_DIR}（${r.files} 个文件）${r.removed ? "" : " ← 未删净（句柄未释放，稍后可手删）"}`);
}

async function main() {
  console.log("SYS-04 端到端验证：鉴权两层 + 错误不外泄");
  console.log(`  端口 ${PORT}`);
  seed();
  clearNextIncrementalCache();
  await startServer();
  console.log("  服务器就绪");
  const COOKIE = sessionCookie();

  // ---- 0. 夹具前提：会话 token 有效 ----
  console.log("");
  console.log("【0】前提校验：自签会话可被识别");
  const okCall = await call("/api/admin/me", { cookie: COOKIE });
  check("有效会话能通过鉴权（/api/admin/me 200）", okCall.status === 200, `HTTP ${okCall.status}`);

  // ---- 1. site-config：GET 公开，PUT 受保护 ----
  console.log("");
  console.log("【1】/api/admin/site-config");
  const scGet = await call("/api/admin/site-config");
  check("GET 无会话仍可读（线上只读核实入口必须保留）", scGet.status === 200, `HTTP ${scGet.status}`);
  const scPutNo = await call("/api/admin/site-config", { method: "PUT", body: scGet.json });
  check("PUT 无会话被拒 401", scPutNo.status === 401, `HTTP ${scPutNo.status} ${scPutNo.text.slice(0, 70)}`);
  const scPutYes = await call("/api/admin/site-config", { method: "PUT", body: scGet.json, cookie: COOKIE });
  check("PUT 带会话放行（不再是 401）", scPutYes.status !== 401, `HTTP ${scPutYes.status}`);

  // ---- 2. site-content ----
  console.log("");
  console.log("【2】/api/admin/site-content");
  // ⚠️ 夹具须满足 site-content-limits 的字数规则（简介 10–280 字、页脚 4–100 字）。
  //    首版这里用了 3 个字的页脚，被校验正确拒绝 —— 那是夹具的问题，不是代码问题。
  const VALID_DESCRIPTION = "SYS-04 验证用赛事简介，这是一段长度合法的正常文案内容。";
  const VALID_FOOTER = "赛事进行中";
  const contentBody = { eventId: EVENT, description: VALID_DESCRIPTION, footerStatus: VALID_FOOTER };
  const scNo = await call("/api/admin/site-content", { method: "PATCH", body: contentBody });
  check("PATCH 无会话被拒 401", scNo.status === 401, `HTTP ${scNo.status} ${scNo.text.slice(0, 70)}`);
  const scYes = await call("/api/admin/site-content", { method: "PATCH", body: contentBody, cookie: COOKIE });
  check("PATCH 带会话放行", scYes.status === 200, `HTTP ${scYes.status} ${scYes.text.slice(0, 70)}`);
  const scMissing = await call("/api/admin/site-content", {
    method: "PATCH", cookie: COOKIE,
    body: { eventId: "no-such-event", description: VALID_DESCRIPTION, footerStatus: VALID_FOOTER },
  });
  check("赛事不存在时仍给出明确提示（不是泛化的「保存失败」）",
    scMissing.status === 400 && /赛事不存在/.test(scMissing.text),
    `HTTP ${scMissing.status} ${scMissing.text.slice(0, 70)}`);
  // 反向：字数不合法时也要给出可操作的提示（不能被泛化成「保存失败」）
  const scBadLength = await call("/api/admin/site-content", {
    method: "PATCH", cookie: COOKIE,
    body: { eventId: EVENT, description: VALID_DESCRIPTION, footerStatus: "短" },
  });
  check("字数不合法 → 提示具体规则（保留可操作信息）",
    scBadLength.status === 400 && /页脚状态应为/.test(scBadLength.text),
    `HTTP ${scBadLength.status} ${scBadLength.text.slice(0, 70)}`);

  // ---- 3. upload：鉴权 + 错误不外泄 ----
  console.log("");
  console.log("【3】/api/admin/upload");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");
  function form(bytes, name, type) {
    const fd = new FormData();
    fd.append("file", new Blob([new Uint8Array(bytes)], { type }), name);
    fd.append("eventId", EVENT);
    return fd;
  }
  const upNo = await call("/api/admin/upload", { method: "POST", form: form(png, "a.png", "image/png") });
  check("POST 无会话被拒 401", upNo.status === 401, `HTTP ${upNo.status} ${upNo.text.slice(0, 70)}`);
  const upYes = await call("/api/admin/upload", { method: "POST", form: form(png, "a.png", "image/png"), cookie: COOKIE });
  check("合法图片上传成功", upYes.status === 200 && typeof upYes.json?.path === "string", `HTTP ${upYes.status} ${upYes.text.slice(0, 70)}`);

  const upBadType = await call("/api/admin/upload", { method: "POST", form: form(png, "a.gif", "image/gif"), cookie: COOKIE });
  check("不支持的格式 → 给出可操作的校验提示",
    upBadType.status === 400 && /仅支持 JPG、PNG 或 WebP/.test(upBadType.text),
    `HTTP ${upBadType.status} ${upBadType.text.slice(0, 70)}`);

  const fakePng = Buffer.from("这不是图片，只是一段文本。".repeat(30), "utf8");
  const upFake = await call("/api/admin/upload", { method: "POST", form: form(fakePng, "fake.png", "image/png"), cookie: COOKIE });
  check("伪装成 PNG 的文本 → 内容校验提示",
    upFake.status === 400 && /文件内容与图片格式不一致/.test(upFake.text),
    `HTTP ${upFake.status} ${upFake.text.slice(0, 70)}`);

  // ★ 关键断言：错误消息里不得出现内部实现细节
  const leakNeedles = ["SUPABASE", "DATA_BACKEND", "supabase", "secret", "apikey", "Bearer", "storage/v1", "HTTP "];
  const allUploadTexts = [upBadType.text, upFake.text, upNo.text, upYes.text].join(" ");
  const leaked = leakNeedles.filter((n) => allUploadTexts.includes(n));
  check("上传类响应不含内部实现细节（配置名/存储路径/上游状态）", leaked.length === 0, `泄露: ${leaked.join(", ")}`);

  // ---- 4. rule-library / events/switch（补审计的两个） ----
  console.log("");
  console.log("【4】/api/admin/rule-library 与 /api/admin/events/switch");
  const rlNo = await call("/api/admin/rule-library", { method: "PUT", body: { rules: [] } });
  check("rule-library PUT 无会话 401", rlNo.status === 401, `HTTP ${rlNo.status}`);
  const cur = await call("/api/admin/site-config");
  const swNo = await call("/api/admin/events/switch", { method: "POST", body: { eventId: EVENT } });
  check("events/switch POST 无会话 401", swNo.status === 401, `HTTP ${swNo.status}`);
  const swYes = await call("/api/admin/events/switch", { method: "POST", body: { eventId: cur.json?.currentEventId ?? EVENT }, cookie: COOKIE });
  check("events/switch 带会话放行", swYes.status !== 401, `HTTP ${swYes.status}`);
}

main()
  .catch((e) => {
    console.error("");
    console.error("!! 脚本异常中止：" + (e?.message ?? e));
    failures.push("脚本异常中止");
  })
  .finally(async () => {
    await stopServer();
    await new Promise((r) => setTimeout(r, 2500));
    console.log("");
    console.log("清理：");
    try { cleanup(); } catch (e) { console.log("  清理失败: " + (e?.message ?? e)); }
    console.log("");
    console.log(`结果：通过 ${pass} / ${pass + failures.length}`);
    if (failures.length) { console.log("未通过："); for (const f of failures) console.log("  - " + f); }
    process.exitCode = failures.length ? 2 : 0;
  });
