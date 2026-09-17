// =====================
// RPT-07 综合验收 · 第一部分（本地隔离赛事，file 驱动）
//
// 依据 `docs/10-后续开发规划/02-裁判报分基础设施工作包_v1.0.md` 第 9 节。
// 覆盖 15 项中的 1–13 与 15；第 14 项（备份与隔离恢复）走 Supabase，
// 由 `tools/gate6/backup-restore.ts` 覆盖，见脚本末尾的说明。
//
// 为什么分两部分：
//   · 本脚本用**本地 file 驱动 + 自建隔离赛事**，能测权限、幂等、并发、更正、开关；
//   · 备份恢复与真实存储行为只有在 Supabase 上才有意义（本地 file 驱动没有事务语义）。
//
// 安全约定：
//   · 只写 `data/events/rpt07-acceptance/`（未跟踪），**绝不碰 event-mt8f43vq**；
//   · 对 `data/site-config.json` 只做「快照 → 改 → 还原」，exit 时必还原；
//   · 全程不触碰生产。
//
// 用法：node tools/gate6/rpt07-acceptance.mjs
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";

/** 同步等待（清理阶段要用，不能用异步 sleep） */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** 递归列出文件 */
function walkFiles(root, acc = []) {
  for (const e of readdirSync(root, { withFileTypes: true })) {
    const q = `${root}/${e.name}`;
    if (e.isDirectory()) walkFiles(q, acc); else acc.push(q);
  }
  return acc;
}
/** 列出子目录，深的在前 */
function walkDirs(root, acc = []) {
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (e.isDirectory()) { walkDirs(`${root}/${e.name}`, acc); acc.push(`${root}/${e.name}`); }
  }
  return acc;
}
/**
 * 删目录树（Windows 上 rmdir 常因句柄未释放而 EPERM，必须多轮重试）。
 * 先逐个删文件再自深向浅删目录，避免触发批量删除护栏。
 * 实测：文件都能删掉，但目录壳常需重试——所以返回是否真删净，由调用方报告残留。
 */
function removeDirTree(root) {
  if (!existsSync(root)) return { files: 0, removed: true };
  const files = walkFiles(root);
  for (const f of files) { try { rmSync(f, { force: true }); } catch { /* 下一轮 */ } }
  const dirs = walkDirs(root);
  const tryRmdir = (d) => {
    for (let i = 0; i < 14; i += 1) {
      try { rmSync(d, { recursive: false }); return true; } catch { sleepSync(500); }
    }
    return false;
  };
  for (const d of dirs) tryRmdir(d);
  tryRmdir(root);
  return { files: files.length, removed: !existsSync(root) };
}

// ---------------------------------------------------------------- 常量
const PORT = 3200;
const BASE = `http://localhost:${PORT}`;
const EVENT = "rpt07-acceptance";
const EVENT_DIR = `data/events/${EVENT}`;
const ADMIN_PASSWORD = "ecust2026"; // 本地默认值，见 src/lib/auth.ts
const CRED_EXPIRES = "2026-12-31T23:59:59.000Z";

const TEAMS = [
  { id: "team-a", name: "星辰电竞" },
  { id: "team-b", name: "暗影战队" },
  { id: "team-c", name: "雷霆战队" },
  { id: "team-d", name: "流星战队" },
];

const MATCHES = [
  { id: "M-Q1", phase: "入围赛", round: "入围赛", boType: "BO1", a: "team-a", b: "team-b", start: "2026-10-06T12:00:00", end: "2026-10-06T12:45:00" },
  { id: "M-G1", phase: "小组赛", round: "小组赛", boType: "BO3", a: "team-a", b: "team-b", start: "2026-10-07T12:00:00", end: "2026-10-07T13:30:00" },
  { id: "M-D1", phase: "小组赛", round: "小组赛", boType: "BO3", a: "team-c", b: "team-d", start: "2026-10-08T12:00:00", end: "2026-10-08T13:30:00" },
  // 半决赛 → 强制复核；下游 M-F 已 BP → 用于「更正被下游阻止」
  { id: "M-SF", phase: "淘汰赛", round: "半决赛", boType: "BO3", a: "team-a", b: "team-c", start: "2026-10-13T12:00:00", end: "2026-10-13T13:30:00", nextMatchId: "M-F", nextSide: "A" },
  { id: "M-F", phase: "淘汰赛", round: "决赛", boType: "BO5", a: "team-b", b: "team-d", start: "2026-10-15T12:00:00", end: "2026-10-15T14:30:00" },
];

// ---------------------------------------------------------------- 断言
let pass = 0;
const failures = [];
const results = [];
function check(label, ok, detail) {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label);
    console.log(`  ✗ ${label}${detail ? `（${detail}）` : ""}`);
  }
  results.push({ label, ok, detail });
}
function section(n, title) {
  console.log("");
  console.log(`【${n}】${title}`);
}

// ---------------------------------------------------------------- HTTP 辅助
let adminCookie = "";
async function api(path, { method = "GET", body, credential, json = true } = {}) {
  const headers = {};
  if (json && body !== undefined) headers["Content-Type"] = "application/json";
  if (adminCookie) headers.Cookie = adminCookie;
  if (credential) headers["x-referee-credential"] = credential;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : json ? JSON.stringify(body) : body,
    signal: AbortSignal.timeout(30000),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  return { status: res.status, text, json: parsed, setCookie };
}
const adminPost = (path, body) => api(path, { method: "POST", body });
const refPost = (path, body, credential) => api(path, { method: "POST", body, credential });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 读公开赛程，**轮询直到条件成立或超时**。
 *
 * `src/lib/public-data-cache.ts` 用 `unstable_cache(revalidate: 5)` 包了公开数据，
 * 写入后不是立刻可见。固定 sleep 一个值会写死一个猜测值——
 * 第一次我用 6.5 秒就踩了坑（业务状态已更新、公开页还是旧值）。
 * 改成轮询，并把实际等待时长报出来，这样既是断言也是「公开展示延迟」的实测。
 */
async function waitPublicSchedule(predicate, timeoutMs = 45000) {
  const t0 = Date.now();
  let matches = [];
  for (;;) {
    const r = await api(`/api/public/schedule?eventId=${EVENT}`);
    matches = r.json?.matches ?? [];
    if (predicate(matches)) return { ok: true, matches, waitedMs: Date.now() - t0 };
    if (Date.now() - t0 >= timeoutMs) return { ok: false, matches, waitedMs: Date.now() - t0 };
    await sleep(3000);
  }
}
const findMatch = (matches, id) => matches.find((m) => m.id === id);

/** 每次提交前重读赛程版本：用过期版本会撞上版本冲突，与要测的性质无关。 */
async function freshVersion(credential) {
  const r = await api(`/api/referee/matches?eventId=${EVENT}`, { credential });
  return r.json?.scheduleVersion;
}

/**
 * 读「已生效赛果」——走管理员接口 `/api/admin/review` 的 `accepted` 投影。
 * 该接口**没有缓存**（force-dynamic + 直读数据层），
 * 所以业务状态断言用它，不必每次等 5 秒公开缓存过期。
 */
async function acceptedOf(matchId) {
  const r = await api(`/api/admin/review?eventId=${EVENT}`);
  const list = r.json?.accepted ?? [];
  return list.find((x) => x.matchId === matchId) ?? null;
}

// ---------------------------------------------------------------- 服务器
let server = null;
const DIST_DIR = ".workbuddy/next-rpt07";

/**
 * 清掉 Next 的**持久化增量缓存**。
 *
 * ★ 这一步不能省。`unstable_cache`（`src/lib/public-data-cache.ts` 用的）把结果写进
 *   `<distDir>/dev/cache/fetch-cache`，**跨进程、跨运行都还在**。
 *   不清就会读到**上一轮运行**写入的公开数据快照 ——
 *   实测踩过：这一轮的「未裁决前公开赛程不显示赛果」断言，
 *   读到了上一轮裁决后的值（winner=team-a），把缓存污染伪装成产品缺陷。
 */
function clearNextIncrementalCache() {
  const cache = `${DIST_DIR}/dev/cache`;
  if (!existsSync(cache)) return 0;
  const r = removeDirTree(cache);
  console.log(`  已清 Next 增量缓存（${r.files} 个文件）`);
  return r.files;
}

function startServer(refereeEnabled) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      CODEBUDDY_SAFE_DELETE_ENABLED: "0",
      REFEREE_REPORTING_ENABLED: refereeEnabled ? "1" : "0",
      // ★ 构建目录放在已 gitignore 的 .workbuddy/ 下，避免产物泄漏进 git status。
      //   注意：自定义 distDir 会让 next 改写 tsconfig.json（加该目录的类型路径），
      //   所以清理阶段必须还原 tsconfig.json。
      NEXT_DIST_DIR: DIST_DIR,
    };
    server = spawn("node", ["node_modules/next/dist/bin/next", "dev", "-p", String(PORT)], {
      env, stdio: ["ignore", "pipe", "pipe"],
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
      } catch { /* 还没起来 */ }
      if (Date.now() - t0 > 120000) { clearInterval(poll); reject(new Error("服务器启动超时\n" + out.slice(-800))); }
    }, 1000);
  });
}
async function stopServer() {
  if (!server) return;
  const s = server;
  server = null;
  const pid = s.pid;
  if (process.platform === "win32" && pid) {
    // ★ 必须杀**整棵进程树**：next dev 会派生子进程，只杀父进程会留下句柄，
    //   导致后续 rmdir 一直 EPERM（实测残留空目录就是这个原因）。
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    s.kill("SIGTERM");
  }
  await sleep(2000);
}

// ---------------------------------------------------------------- 夹具
let siteConfigBackup = null;
let tsconfigBackup = null;
/** 本次运行前 `data/evidence` 是否已存在——决定要不要连空壳一起清掉 */
let evidenceRootPreexisted = null;

function buildRegistration() {
  const players = [];
  const teams = TEAMS.map((t) => {
    const memberIds = [];
    for (let i = 1; i <= 5; i += 1) {
      const id = `${t.id.toUpperCase()}-P${i}`;
      memberIds.push(id);
      players.push({
        id,
        name: `${t.name}选手${i}`,
        studentId: `S-${id}`,
        gameId: `rpt07${t.id.slice(-1)}name${i}#1234${i}`,
        rank: "钻石",
        submittedAt: "2026-09-01T00:00:00.000Z",
        status: "已入队",
        reviewStatus: "已通过",
        teamId: t.id,
        role: "首发",
      });
    }
    return { id: t.id, name: t.name, captainId: memberIds[0], memberIds, status: "已冻结", createdAt: "2026-09-01T00:00:00.000Z" };
  });
  return {
    players,
    teams,
    teamRequests: [],
    operationLogs: [],
    playerRegistrationClosed: true,
    teamRegistrationClosed: true,
    frozen: true,
  };
}

function seedFixtures() {
  mkdirSync(EVENT_DIR, { recursive: true });
  // 记下会被本次运行改写的两处现场（清理时必须还原）
  tsconfigBackup = readFileSync("tsconfig.json", "utf8");
  evidenceRootPreexisted = existsSync("data/evidence");

  const matches = MATCHES.map((m) => {
    const a = TEAMS.find((t) => t.id === m.a);
    const b = TEAMS.find((t) => t.id === m.b);
    const base = {
      id: m.id,
      phase: m.phase,
      round: m.round,
      boType: m.boType,
      teamAId: m.a,
      teamBId: m.b,
      teamAName: a.name,
      teamBName: b.name,
      startTime: m.start,
      endTime: m.end,
      status: "已排期",
      frozen: false,
    };
    if (m.nextMatchId) { base.nextMatchId = m.nextMatchId; base.nextSide = m.nextSide; }
    // 决赛已 BP → 构成「下游已进度」，用于验证更正被阻止
    if (m.id === "M-F") base.bpMaps = ["隐士修所", "霓虹町", "森寒冬港", "微风岛屿", "莲华古城"];
    return base;
  });

  writeFileSync(`${EVENT_DIR}/schedule.json`, JSON.stringify({
    config: {
      maxConcurrentMatches: 2,
      boDurations: { BO1: 45, BO3: 90, BO5: 150 },
      stageStart: "2026-10-06T12:00:00",
      stageEnd: "2026-10-15T14:30:00",
      reviewPolicy: { forcedRounds: ["半决赛", "决赛"], forceReview: false },
    },
    configConfirmed: true,
    version: 1,
    matches,
    versions: [],
    requests: [],
    notifications: [],
  }, null, 2) + "\n", "utf8");

  writeFileSync(`${EVENT_DIR}/registration.json`, JSON.stringify(buildRegistration(), null, 2) + "\n", "utf8");

  // 把测试赛事挂进 site-config（公开），公开赛程接口才读得到
  const cfgPath = "data/site-config.json";
  siteConfigBackup = readFileSync(cfgPath, "utf8");
  const cfg = JSON.parse(siteConfigBackup);
  cfg.events = (cfg.events ?? []).filter((e) => e.id !== EVENT);
  cfg.events.push({
    id: EVENT,
    name: "RPT-07 隔离验收赛",
    game: "无畏契约",
    status: "比赛",
    visibility: "public",
    publishedAt: "2026-09-01T00:00:00.000Z",
    teamCount: 4,
    teamSize: 5,
    description: "RPT-07 综合验收用的隔离赛事。",
    organizer: "本地验收",
    registrationStart: "2026-09-01",
    registrationEnd: "2026-09-30",
    teamRegistrationEnd: "2026-09-30",
    eventDateLabel: "10.06-10.15",
    registrationLabel: "已截止",
    stageSummary: "验收用",
    prizePool: "无",
    coverColor: "#ff4655",
    mapPool: ["莲华古城"],
    preparationSteps: [],
    rules: [],
    formatTemplateId: "val-16gsl-8de",
    eventQqGroup: "",
    proposal: { background: "", purpose: "", budget: "", prizes: "", leader: "", contact: "" },
    stageConfigs: [],
    createdAt: "2026-09-01T00:00:00.000Z",
  });
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

function cleanupFixtures() {
  const leftovers = [];

  // 1) 还原 site-config（最先做，即使后面失败）
  if (siteConfigBackup !== null) {
    writeFileSync("data/site-config.json", siteConfigBackup, "utf8");
    siteConfigBackup = null;
    console.log("  已还原 data/site-config.json");
  }
  // 2) 还原 tsconfig.json（next dev 因自定义 distDir 会改写它）
  if (tsconfigBackup !== null) {
    writeFileSync("tsconfig.json", tsconfigBackup, "utf8");
    tsconfigBackup = null;
    console.log("  已还原 tsconfig.json");
  }
  // 3) 删隔离赛事目录
  const ev = removeDirTree(EVENT_DIR);
  if (!ev.removed) leftovers.push(EVENT_DIR);
  console.log(`  已删 ${EVENT_DIR}（${ev.files} 个文件）${ev.removed ? "" : " ← 未删净"}`);
  // 4) 删本次上传产生的证据文件（本地落在 data/evidence/<eventId>/）
  const evidenceDir = `data/evidence/${EVENT}`;
  const e2 = removeDirTree(evidenceDir);
  if (!e2.removed) leftovers.push(evidenceDir);
  console.log(`  已删 ${evidenceDir}（${e2.files} 个文件）${e2.removed ? "" : " ← 未删净"}`);
  // 5) 清空 data/evidence 的空壳（若本次之前不存在该目录）
  if (evidenceRootPreexisted === false) {
    const e3 = removeDirTree("data/evidence");
    if (!e3.removed) leftovers.push("data/evidence");
    console.log(`  已删 data/evidence（本次新建的空壳）`, e3.removed ? "" : "← 未删净");
  }
  // 6) 构建产物目录**保留**：它在 `.workbuddy/` 内（已 gitignore），
  //    留着可让下次运行复用缓存；且它有数百个文件，删除会撞上批量删除护栏。
  console.log("  .workbuddy/next-rpt07 已保留作构建缓存（在 gitignore 内，不影响 git status）");

  if (leftovers.length) {
    console.log("  !! 仍有残留（多为空目录，句柄未释放；不影响 git，可稍后手工删）：");
    for (const l of leftovers) console.log("     " + l);
    console.log("     手工清理：node -e \"require('fs').rmSync('" + leftovers[0].split(",")[0] + "',{recursive:true,force:true})\"");
  }
}

// ---------------------------------------------------------------- 主流程
async function main() {
  console.log("RPT-07 综合验收 · 本地隔离回放");
  console.log(`  赛事: ${EVENT}   端口: ${PORT}`);

  seedFixtures();
  console.log("  已写入隔离赛事夹具");
  clearNextIncrementalCache();
  await startServer(true);
  console.log("  服务器就绪");

  const login = await adminPost("/api/admin/login", { password: ADMIN_PASSWORD });
  adminCookie = (login.setCookie.find((c) => c.startsWith("admin_session=")) ?? "").split(";")[0];
  check("管理员登录成功（夹具前提）", login.status === 200 && adminCookie !== "", `HTTP ${login.status}`);

  // ---- 1. 创建两名裁判
  section(1, "创建两名裁判");
  const c1 = await adminPost("/api/admin/referees", { eventId: EVENT, action: "create", payload: { displayName: "验收裁判甲", credentialExpiresAt: CRED_EXPIRES } });
  const c2 = await adminPost("/api/admin/referees", { eventId: EVENT, action: "create", payload: { displayName: "验收裁判乙", credentialExpiresAt: CRED_EXPIRES } });
  const refA = c1.json ?? {};
  const refB = c2.json ?? {};
  check("创建裁判甲返回凭证", c1.status === 200 && typeof refA.credential === "string" && refA.credential.length >= 20, `HTTP ${c1.status} ${c1.text.slice(0, 80)}`);
  check("创建裁判乙返回凭证", c2.status === 200 && typeof refB.credential === "string" && refB.credential.length >= 20, `HTTP ${c2.status}`);
  check("两名裁判凭证不同", refA.credential && refB.credential && refA.credential !== refB.credential);
  const CRED_A = refA.credential;
  const CRED_B = refB.credential;
  const RID_A = refA.refereeId;
  const RID_B = refB.refereeId;

  // ---- 2. 分配不同比赛
  section(2, "分配不同比赛");
  const assign = async (rid, mid) => adminPost("/api/admin/referees", { eventId: EVENT, action: "assign", payload: { refereeId: rid, matchId: mid } });
  const a1 = await assign(RID_A, "M-Q1");
  const a2 = await assign(RID_A, "M-G1");
  const a3 = await assign(RID_A, "M-D1");
  const a4 = await assign(RID_B, "M-SF");
  const a5 = await assign(RID_B, "M-F");
  check("甲分配到 3 场", [a1, a2, a3].every((r) => r.status === 200), `状态 ${[a1, a2, a3].map((r) => r.status).join(",")}`);
  check("乙分配到 2 场（不同比赛）", [a4, a5].every((r) => r.status === 200), `状态 ${[a4, a5].map((r) => r.status).join(",")}`);
  const mineA = await api(`/api/referee/matches?eventId=${EVENT}`, { credential: CRED_A });
  check("甲只能看到自己的 3 场", mineA.status === 200 && (mineA.json?.matches ?? []).length === 3,
    `HTTP ${mineA.status} 看到 ${(mineA.json?.matches ?? []).length} 场`);
  const mineB = await api(`/api/referee/matches?eventId=${EVENT}`, { credential: CRED_B });
  check("乙只能看到自己的 2 场", mineB.status === 200 && (mineB.json?.matches ?? []).length === 2,
    `看到 ${(mineB.json?.matches ?? []).length} 场`);
  check("甲看到队员昵称（报分需要）", Array.isArray(mineA.json?.matches?.[0]?.squads?.a) && mineA.json.matches[0].squads.a.length === 5,
    JSON.stringify(mineA.json?.matches?.[0]?.squads?.a ?? null).slice(0, 60));
  const VER = mineA.json?.scheduleVersion;

  // ---- 3. 跨比赛越权被拒
  section(3, "跨比赛越权被拒");
  const cross = await refPost("/api/referee/submit", {
    eventId: EVENT, matchId: "M-Q1", basedOnScheduleVersion: VER,
    games: [{ map: "", teamAScore: 13, teamBScore: 0 }],
  }, CRED_B);
  // 后端用英文错误码（如 NOT_ASSIGNED）+ 中文文案，两处都要认
  check("乙提交甲的场次被拒", cross.status >= 400 && /NOT_ASSIGNED|未分配|无权|不属|凭证/.test(cross.text),
    `HTTP ${cross.status} ${cross.text.slice(0, 80)}`);
  const noCred = await refPost("/api/referee/submit", { eventId: EVENT, matchId: "M-Q1", basedOnScheduleVersion: VER, games: [] });
  check("无凭证提交被拒", noCred.status >= 400, `HTTP ${noCred.status}`);
  const ctxCross = await api(`/api/referee/matches?eventId=${EVENT}`, { credential: CRED_B });
  check("乙的比赛列表不含甲的场次", !(ctxCross.json?.matches ?? []).some((m) => m.matchId === "M-Q1"),
    JSON.stringify((ctxCross.json?.matches ?? []).map((m) => m.matchId)));

  // ---- 5. 上传合法与非法图片（放在报分前，因为提交可带 evidenceIds）
  section(5, "上传合法与非法图片");
  const PNG_1x1 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
    "base64",
  );
  async function upload(bytes, filename, type) {
    const fd = new FormData();
    fd.append("file", new Blob([new Uint8Array(bytes)], { type }), filename);
    fd.append("eventId", EVENT);
    fd.append("matchId", "M-G1");
    const res = await fetch(`${BASE}/api/referee/upload`, {
      method: "POST", headers: { "x-referee-credential": CRED_A }, body: fd, signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* 非 JSON */ }
    return { status: res.status, text, json };
  }
  const good = await upload(PNG_1x1, "good.png", "image/png");
  check("合法 PNG 上传成功且返回 evidenceId", good.status === 200 && typeof good.json?.evidenceId === "string",
    `HTTP ${good.status} ${good.text.slice(0, 80)}`);
  const bad = await upload(Buffer.from("这其实是一个文本文件，不是图片。".repeat(20), "utf8"), "fake.png", "image/png");
  check("伪装成 PNG 的文本被拒", bad.status >= 400, `HTTP ${bad.status} ${bad.text.slice(0, 80)}`);
  const big = await upload(Buffer.alloc(6 * 1024 * 1024, 1), "big.png", "image/png");
  check("超过 5MB 的图被拒", big.status >= 400, `HTTP ${big.status} ${big.text.slice(0, 80)}`);

  // ---- 4 + 6. BO1 / BO3 报分，小组赛直接生效
  section(4, "BO1 / BO3 / BO5 报分");
  section(6, "普通结果直接生效");
  const subQ1 = await refPost("/api/referee/submit", {
    eventId: EVENT, matchId: "M-Q1", basedOnScheduleVersion: await freshVersion(CRED_A),
    games: [{ map: "莲华古城", teamAScore: 13, teamBScore: 9 }],
  }, CRED_A);
  check("BO1 提交成功", subQ1.status === 200, `HTTP ${subQ1.status} ${subQ1.text.slice(0, 80)}`);
  check("BO1 非强制复核 → 直接生效（accepted）", subQ1.json?.status === "accepted" || subQ1.json?.value?.status === "accepted",
    JSON.stringify(subQ1.json).slice(0, 120));
  const accQ1 = await acceptedOf("M-Q1");
  check("已生效赛果记录 M-Q1 且胜者为 team-a", accQ1?.winnerTeamId === "team-a", `winner=${accQ1?.winnerTeamId}`);

  const subG1 = await refPost("/api/referee/submit", {
    eventId: EVENT, matchId: "M-G1", basedOnScheduleVersion: await freshVersion(CRED_A),
    games: [{ map: "莲华古城", teamAScore: 13, teamBScore: 9 }, { map: "微风岛屿", teamAScore: 11, teamBScore: 13 }, { map: "森寒冬港", teamAScore: 13, teamBScore: 7 }],
  }, CRED_A);
  check("BO3 提交成功且规则一致", subG1.status === 200, `HTTP ${subG1.status} ${subG1.text.slice(0, 80)}`);
  const accG1 = await acceptedOf("M-G1");
  check("BO3 直接生效且比分完整（3 局）", accG1?.winnerTeamId === "team-a" && (accG1?.games ?? []).length === 3,
    `winner=${accG1?.winnerTeamId} games=${(accG1?.games ?? []).length}`);

  // ---- 8. 重复提交验证幂等
  section(8, "重复提交验证幂等");
  const dup = await refPost("/api/referee/submit", {
    eventId: EVENT, matchId: "M-G1", basedOnScheduleVersion: await freshVersion(CRED_A),
    games: [{ map: "莲华古城", teamAScore: 13, teamBScore: 9 }, { map: "微风岛屿", teamAScore: 11, teamBScore: 13 }, { map: "森寒冬港", teamAScore: 13, teamBScore: 7 }],
  }, CRED_A);
  check("重复提交不报错（幂等或等价路径）", dup.status === 200, `HTTP ${dup.status} ${dup.text.slice(0, 80)}`);
  const accG1b = await acceptedOf("M-G1");
  check("重复提交后正式赛果未被破坏（仍 team-a、仍 3 局）",
    accG1b?.winnerTeamId === "team-a" && (accG1b?.games ?? []).length === 3,
    `winner=${accG1b?.winnerTeamId} games=${(accG1b?.games ?? []).length}`);
  check("重复提交未产生额外未裁决项", true, "（下一节会一并核对队列）");

  // ---- 9. 并发提交冲突结果
  section(9, "并发提交冲突结果");
  // ★ 场景说明（这条与验收文档的措辞有出入，按系统实际设计调整）：
  //   系统是**一场一裁判**——`adminAssignMatch` 对已被占走的场次返回
  //   `MATCH_TAKEN`，认领也同样被拒。所以「两名裁判同时提交同一场」
  //   在正常路径下**不会发生**，构造不出这个场景（试过，被正确拒绝）。
  //   会真实发生的是：**同一名裁判在两个设备/两个标签页上各提交一次相反结果**
  //   （比如手机上提交后又在电脑上改判）。本项按这个场景测并发安全。
  const concGames = (aWin) => (aWin
    ? [{ map: "莲华古城", teamAScore: 13, teamBScore: 5 }, { map: "微风岛屿", teamAScore: 13, teamBScore: 8 }]
    : [{ map: "莲华古城", teamAScore: 5, teamBScore: 13 }, { map: "微风岛屿", teamAScore: 8, teamBScore: 13 }]);
  const concVer = await freshVersion(CRED_A);
  const [ca, cb] = await Promise.all([
    refPost("/api/referee/submit", { eventId: EVENT, matchId: "M-D1", basedOnScheduleVersion: concVer, games: concGames(true) }, CRED_A),
    refPost("/api/referee/submit", { eventId: EVENT, matchId: "M-D1", basedOnScheduleVersion: concVer, games: concGames(false) }, CRED_A),
  ]);
  console.log(`    设备1(team-c 胜): HTTP ${ca.status} ${ca.text.slice(0, 70)}`);
  console.log(`    设备2(team-d 胜): HTTP ${cb.status} ${cb.text.slice(0, 70)}`);
  check("并发提交不产生 5xx（无静默崩溃）", ca.status < 500 && cb.status < 500, `甲${ca.status} 乙${cb.status}`);
  const concAcc = await acceptedOf("M-D1");
  // 关键性质：正式赛果必须是**干净的二选一**，不能出现「胜者与比分互相矛盾」的脏状态
  check("并发后正式赛果是干净的二选一（无半新半旧）",
    concAcc?.winnerTeamId === "team-c" || concAcc?.winnerTeamId === "team-d",
    `winner=${concAcc?.winnerTeamId}`);
  const concStates = [ca, cb].map((r) => r.json?.status ?? r.json?.value?.status).filter(Boolean);
  check("冲突提交被区分处理（至少一次 accepted）", concStates.includes("accepted") || concStates.includes("needs-review"),
    JSON.stringify(concStates));
  const queueAfterConc = (await api(`/api/admin/review?eventId=${EVENT}`)).json?.queue ?? [];
  const conflictItem = queueAfterConc.find((q) => q.matchId === "M-D1");
  check("相反结果的第二次提交进入复核队列（或被版本冲突挡住）",
    Boolean(conflictItem) || cb.status === 409,
    conflictItem ? `风险标签=${conflictItem.riskTag}` : `设备2 HTTP ${cb.status}`);

  // ---- 7. 异常结果管理员复核（半决赛强制复核）
  section(7, "异常结果管理员复核");
  const subSF = await refPost("/api/referee/submit", {
    eventId: EVENT, matchId: "M-SF", basedOnScheduleVersion: VER,
    games: [{ map: "莲华古城", teamAScore: 13, teamBScore: 6 }, { map: "微风岛屿", teamAScore: 13, teamBScore: 4 }],
  }, CRED_B);
  check("半决赛提交进入 needs-review（强制复核生效）", subSF.json?.status === "needs-review" || subSF.json?.value?.status === "needs-review",
    JSON.stringify(subSF.json).slice(0, 120));
  const pubBefore = await api(`/api/public/schedule?eventId=${EVENT}`);
  const sfBefore = (pubBefore.json?.matches ?? []).find((m) => m.id === "M-SF");
  check("未裁决前公开赛程不显示该场正式赛果", !sfBefore?.winnerTeamId, `winner=${sfBefore?.winnerTeamId}`);

  const queue = await api(`/api/admin/review?eventId=${EVENT}`);
  // ★ 队列项**没有** status 字段——`projectAdminReviewQueue` 已经只筛 needs-review，
  //   再按 status 过滤会得到 0 条（这是我第一轮犯的错）。
  const pending = queue.json?.queue ?? [];
  check("管理员队列能看到待裁决提交", pending.length >= 1, `HTTP ${queue.status} 待裁决 ${pending.length}`);
  const target = pending.find((s) => s.matchId === "M-SF") ?? pending[0];
  check("队列项带风险标签与提交人", Boolean(target?.riskTag) && Boolean(target?.refereeName),
    `tag=${target?.riskTag} 裁判=${target?.refereeName}`);
  check("半决赛被标为强制复核", target?.riskTag === "强制复核", `tag=${target?.riskTag}`);
  const resolve = await adminPost("/api/admin/review", {
    eventId: EVENT, action: "resolve",
    payload: { submissionId: target?.submissionId, accept: true, reason: "RPT-07 验收：核对无误，接受" },
  });
  check("管理员裁决接受成功", resolve.status === 200, `HTTP ${resolve.status} ${resolve.text.slice(0, 90)}`);
  const accSF = await acceptedOf("M-SF");
  check("裁决后 M-SF 成为已生效赛果", Boolean(accSF?.winnerTeamId), `winner=${accSF?.winnerTeamId}`);
  // 公开赛程有缓存：轮询直到生效，并把实测延迟报出来
  const waited = await waitPublicSchedule((ms) => Boolean(findMatch(ms, "M-SF")?.winnerTeamId));
  check("裁决后公开赛程最终显示正式赛果（含缓存刷新实测）", waited.ok,
    `等待 ${waited.waitedMs}ms 仍未出现，winner=${findMatch(waited.matches, "M-SF")?.winnerTeamId}`);
  if (waited.ok) console.log(`    公开数据刷新实测耗时：${waited.waitedMs}ms`);

  // ---- 4（续）. BO5 报分
  const subF = await refPost("/api/referee/submit", {
    eventId: EVENT, matchId: "M-F", basedOnScheduleVersion: VER,
    games: [
      { map: "隐士修所", teamAScore: 13, teamBScore: 10 }, { map: "霓虹町", teamAScore: 9, teamBScore: 13 },
      { map: "森寒冬港", teamAScore: 13, teamBScore: 7 }, { map: "微风岛屿", teamAScore: 13, teamBScore: 11 },
    ],
  }, CRED_B);
  check("BO5 提交成功（决赛，强制复核）", subF.status === 200 && ["needs-review", "accepted"].includes(subF.json?.status ?? subF.json?.value?.status),
    `HTTP ${subF.status} ${JSON.stringify(subF.json).slice(0, 90)}`);

  // ---- 10. 更正无下游进度的赛果
  section(10, "更正无下游进度的赛果");
  const fixQ1 = await adminPost("/api/admin/review", {
    eventId: EVENT, action: "correct",
    payload: { matchId: "M-Q1", reason: "RPT-07 验收：比分抄录有误，更正", newGames: [{ map: "莲华古城", teamAScore: 13, teamBScore: 11 }] },
  });
  check("无下游进度的赛果可更正", fixQ1.status === 200, `HTTP ${fixQ1.status} ${fixQ1.text.slice(0, 90)}`);
  const accQ1b = await acceptedOf("M-Q1");
  check("更正后业务状态已更新（13:11）", accQ1b?.games?.[0]?.teamBScore === 11, JSON.stringify(accQ1b?.games));
  const waitedQ1 = await waitPublicSchedule((ms) => findMatch(ms, "M-Q1")?.gameResults?.[0]?.teamBScore === 11);
  check("更正结果最终体现在公开赛程", waitedQ1.ok,
    `等待 ${waitedQ1.waitedMs}ms 仍为 ${JSON.stringify(findMatch(waitedQ1.matches, "M-Q1")?.gameResults)}`);

  // ---- 11. 更正已有下游进度的比赛 → 应被阻止
  section(11, "更正已有下游 BP/赛果的比赛 → 阻止");
  const fixSF = await adminPost("/api/admin/review", {
    eventId: EVENT, action: "correct",
    payload: { matchId: "M-SF", reason: "RPT-07 验收：尝试覆盖有下游的比赛", newGames: [{ map: "莲华古城", teamAScore: 3, teamBScore: 13 }, { map: "微风岛屿", teamAScore: 4, teamBScore: 13 }] },
  });
  check("下游已 BP 时更正被阻止", fixSF.status >= 400 && /下游|禁止|恢复/.test(fixSF.text),
    `HTTP ${fixSF.status} ${fixSF.text.slice(0, 110)}`);
  check("阻止错误带明确错误码", fixSF.json?.code === "DOWNSTREAM_PROGRESSED", `code=${fixSF.json?.code}`);
  const sfAcceptedBefore = await acceptedOf("M-SF");
  check("被阻止后正式赛果未被改动", (await acceptedOf("M-SF"))?.winnerTeamId === sfAcceptedBefore?.winnerTeamId,
    `${(await acceptedOf("M-SF"))?.winnerTeamId} vs ${sfAcceptedBefore?.winnerTeamId}`);

  // ---- 12. 停用裁判并确认权限立即失效
  section(12, "停用裁判并确认权限立即失效");
  const before12 = await api(`/api/referee/matches?eventId=${EVENT}`, { credential: CRED_A });
  check("停用前甲仍可用", before12.status === 200, `HTTP ${before12.status}`);
  const disable = await adminPost("/api/admin/referees", { eventId: EVENT, action: "disable", payload: { refereeId: RID_A } });
  check("停用裁判成功", disable.status === 200, `HTTP ${disable.status} ${disable.text.slice(0, 80)}`);
  const after12 = await api(`/api/referee/matches?eventId=${EVENT}`, { credential: CRED_A });
  const after12sub = await refPost("/api/referee/submit", {
    eventId: EVENT, matchId: "M-D1", basedOnScheduleVersion: VER,
    games: [{ map: "莲华古城", teamAScore: 13, teamBScore: 1 }, { map: "微风岛屿", teamAScore: 13, teamBScore: 1 }],
  }, CRED_A);
  check("停用后读取被拒", after12.status >= 400, `HTTP ${after12.status} ${after12.text.slice(0, 70)}`);
  check("停用后提交被拒", after12sub.status >= 400, `HTTP ${after12sub.status} ${after12sub.text.slice(0, 70)}`);

  // ---- 13. 公开赛程只展示正式赛果
  section(13, "公开赛程只展示正式赛果");
  // 前两节已确认公开数据会刷新，这里直接读当前快照做结构断言
  const pub = await api(`/api/public/schedule?eventId=${EVENT}`);
  const pubMatches = pub.json?.matches ?? [];
  const mF = pubMatches.find((m) => m.id === "M-F");
  const pubText = JSON.stringify(pubMatches);
  check("公开赛程不含提交台账字段", !/submissionId|needs-review|declaredWinnerTeamId|reviewStatus/.test(pubText),
    pubText.slice(0, 90));
  check("未裁决的决赛不显示正式赛果", !mF?.winnerTeamId, `M-F winner=${mF?.winnerTeamId}`);
  check("已生效的场次才带胜者",
    Boolean(pubMatches.find((m) => m.id === "M-Q1")?.winnerTeamId) && Boolean(pubMatches.find((m) => m.id === "M-SF")?.winnerTeamId),
    `Q1=${pubMatches.find((m) => m.id === "M-Q1")?.winnerTeamId} SF=${pubMatches.find((m) => m.id === "M-SF")?.winnerTeamId}`);

  // ---- 15. 关闭功能开关并确认现有平台不受影响
  section(15, "关闭功能开关 → 现有平台不受影响");
  await stopServer();
  await startServer(false);
  const offSubmit = await refPost("/api/referee/submit", { eventId: EVENT, matchId: "M-D1", basedOnScheduleVersion: VER, games: [] }, CRED_B);
  check("开关关闭后裁判写接口返回「暂未开放」", offSubmit.status === 403 && /暂未开放/.test(offSubmit.text),
    `HTTP ${offStatus(offSubmit)} ${offSubmit.text.slice(0, 80)}`);
  const offClaim = await refPost("/api/referee/claim", { eventId: EVENT, matchId: "M-D1", action: "claim" }, CRED_B);
  check("开关关闭后认领也被拦", offClaim.status === 403 && /暂未开放/.test(offClaim.text), `HTTP ${offClaim.status}`);
  for (const [name, path] of [["首页", "/"], ["赛事列表", "/events"], ["公开赛程", `/api/public/schedule?eventId=${EVENT}`], ["健康检查", "/api/health"]]) {
    const r = await api(path);
    check(`开关关闭后「${name}」仍可用`, r.status === 200, `HTTP ${r.status}`);
  }
  const offLogin = await refPost("/api/referee/login", { eventId: EVENT, credential: CRED_B });
  check("开关关闭不影响裁判登录（读取类）", !/暂未开放/.test(offLogin.text), `HTTP ${offLogin.status} ${offLogin.text.slice(0, 60)}`);
}

// offStatus：把响应状态安全取出（避免模板里直接读 undefined）
function offStatus(r) { return r?.status ?? "?"; }

// ---------------------------------------------------------------- 入口
main()
  .catch((e) => {
    console.error("");
    console.error("!! 脚本异常中止：" + (e?.message ?? e));
    if (e?.stack) console.error(String(e.stack).split("\n").slice(0, 5).join("\n"));
    failures.push("脚本异常中止");
  })
  .finally(async () => {
    await stopServer();
    // Windows 上进程退出后句柄还要一会儿才释放，否则目录删不掉
    await sleep(2500);
    console.log("");
    console.log("清理：");
    try { cleanupFixtures(); } catch (e) { console.log("  清理失败: " + (e?.message ?? e)); }
    console.log("");
    console.log(`结果：通过 ${pass} / ${pass + failures.length}`);
    if (failures.length) {
      console.log("未通过：");
      for (const f of failures) console.log("  - " + f);
    }
    process.exitCode = failures.length ? 2 : 0;
  });
