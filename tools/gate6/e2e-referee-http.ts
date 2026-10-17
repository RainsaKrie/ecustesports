// =====================
// 裁判端 HTTP 链路 · 本地端到端验收
//
// 为什么需要它。36 队演练脚本自己记着一条「始终未覆盖」：
//   「裁判端提交赛果的 HTTP 链路 —— 需要裁判账号。赛果是用裁判端同一个函数生成的，
//     但没走登录与鉴权。」
// 而 staging 那两个 e2e（e2e-submit-verify / e2e-evidence-upload）是冲着真实 Supabase 写的：
// 要生产密钥、直接读库、断言事务与私有桶 —— 本地门禁与 CI 都跑不到。
//
// 本脚本补同一件事的**本地版**：真实 HTTP、真实凭证头、真实路由与领域层，只换后端（file）。
// 于是「凭证 → 身份 → 分配 → 报分 → 四份文档落盘」这条链在没有生产凭证的情况下也能验。
//
// ── 第一轮就抓到的一处真问题（本脚本第 1 节锁住它）────────────────
//   六个裁判接口在「凭证无效」时表现不一致：claim / upload / matches 回 401 且提示是中文，
//   而 submit 回 **400**，并把内部码 `INVALID_CREDENTIAL` **原样当成提示文案**。
//   裁判屏幕上看到的是一串大写英文，不知道要重新登录；负责人也无从判断该不该重置凭证。
//   现已统一走 `src/lib/referee/failure-response.ts`（状态码与文案成对产生）。
//
// ── 覆盖 ────────────────────────────────────────────────────
//   · 鉴权一致性：七个调用点（六个接口）用无效凭证打一遍，一律 401 + 同一句可照做的中文
//   · 正常链路：登录 → 我的比赛 → 上传凭证 → 提交报分
//   · 落盘与关联：schedule / referee-ledger / result-ledger / evidence-ledger 四份文档
//     互相咬合（赛果写进赛程、凭证挂到提交、版本递增），凭证落私有目录而非 public/uploads
//   · 边界：未分配 → 401、自助认领、BO3 局数不足 → 400、缺赛事 ID → 400、
//     对阵已变更 → 409、重复提交幂等（不新增台账、不递增版本）
//   · ★ 管理端建账号 → 那个一次性凭证立刻能用，且新账号看不到别人被分配的比赛。
//     这是上线时负责人真正会点的那条路（文档里「RPT-07 只差账号」说的就是它），
//     而它原先完全没被自动化覆盖过 —— 前面几节用的都是播种好的演示裁判。
//
// ── 不覆盖（别用「全部通过」含糊掉范围）──────────────────────
//   · 生产 Supabase 后端（本脚本只跑本地 file 后端）
//   · 视觉模型识图（/referee/recognize 只验鉴权那一层，不发模型请求）
//   · 浏览器里的裁判工作台界面
//   · 管理端「裁判管理」页面的界面本身（这里只打它的 API）
//
// ── 现场隔离 ────────────────────────────────────────────────
//   用到本地演示赛事 `demo-referee`（由 seedDemoReporting 播种，代码里禁止在托管环境播种）。
//   夹具必须是**新鲜**的：播种是幂等的，若上一轮的 referee-ledger 还在，M-R1 会带着
//   「已完成」的赛果进入本轮，断言就不再确定。所以运行前把演示赛事目录与凭证目录
//   **改名挪进隔离区**，运行后把本轮产物也挪走、再还原运行前那一份。
//   全程只用「改名」，不删除（本机删除护栏按回合计量，一旦被拒同回合后续删除全被拒）。
//
// ── 前置 ────────────────────────────────────────────────────
//   先停掉你自己的 `npm run dev`。它会占着 data/events/ 的文件句柄，改名会 EPERM
//   —— 这是本项目已知结论，不是脚本缺陷。脚本会在改名失败时直接说明这一点。
//
// ── 为什么不在 `npm run gate` 里 ──────────────────────────────
//   与 36 队演练同理：它要起一个 dev server，比其余套件重得多，且把「本机没有别的
//   dev server 在跑」变成门禁前提。需要完整验收时用 `npm run gate:full`。
//
// ── 用法 ────────────────────────────────────────────────────
//   npm run test:referee-http              跑一遍
//   ... --keep                             保留本轮演示赛事，便于手动点一遍
//   ... --port 3998                        指定 dev server 端口
//   直接调用：node node_modules/tsx/dist/cli.mjs tools/gate6/e2e-referee-http.ts
// =====================

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

// ────────────────────────────────────────────────────────────
// 0. 参数与现场常量
// ────────────────────────────────────────────────────────────

const ROOT = process.cwd();
const args = process.argv.slice(2);
const KEEP = args.includes("--keep");
const PORT = Number(args[args.indexOf("--port") + 1]) || 3998;
const BASE = `http://localhost:${PORT}`;

const EVENT = "demo-referee";
/** 与 src/lib/referee/reporting-data.ts 的 DEMO_CREDENTIAL 一致 */
const CREDENTIAL = "referee-demo-credential-2026-09";
/** 无效凭证：长度足够（须 ≥20），但不在台账里 */
const WRONG_CREDENTIAL = "invalid-credential-0000000000";

/** 独立构建目录：Next 会因自定义 distDir 改写 tsconfig.json 的 include，收尾要还原。 */
const E2E_DIST = ".workbuddy/referee-e2e-dist";
/** 隔离区（已 gitignore）：运行前的那一份与本轮的产物都放这里，只改名不删除。 */
const ISOLATION = path.join(ROOT, ".workbuddy", "referee-e2e-isolation");

const EVENT_DIR = path.join(ROOT, "data", "events", EVENT);
const EVIDENCE_DIR = path.join(ROOT, "data", "evidence", EVENT);
const TSCONFIG = path.join(ROOT, "tsconfig.json");
const UPLOADS_DIR = path.join(ROOT, "public", "uploads");

// ────────────────────────────────────────────────────────────
// 1. 断言与报告
// ────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${detail ? `（${detail}）` : ""}`);
  }
}

/** 内部码的样子：全大写字母、数字与下划线。给裁判看的提示绝不能长这样。 */
const LOOKS_LIKE_INTERNAL_CODE = /^[A-Z][A-Z0-9_]*$/;

const hasChinese = (text: string) => /[\u4e00-\u9fa5]/.test(text);

// ────────────────────────────────────────────────────────────
// 2. 现场快照与隔离（只用改名，不删除）
// ────────────────────────────────────────────────────────────

interface Stashed {
  existed: boolean;
  stashPath: string | null;
}

interface Isolation {
  event: Stashed;
  evidence: Stashed;
}

/** 运行前的占位：main() 会覆盖，收尾读它。声明在 main 之前，避免暂时性死区。 */
const isolation: Isolation = {
  event: { existed: false, stashPath: null },
  evidence: { existed: false, stashPath: null },
};

const tsconfigBefore = { raw: readFileSync(TSCONFIG, "utf8"), hash: "" };
function hashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}
tsconfigBefore.hash = hashOf(tsconfigBefore.raw);

const uploadsBefore: string[] = existsSync(UPLOADS_DIR) ? readdirSync(UPLOADS_DIR) : [];

/**
 * 把一个目录改名挪进隔离区，返回它原本是否存在。
 *
 * 改名失败几乎只有一个原因：本机 dev server 正占着 data/events/ 的文件句柄
 * （Windows 上 rename 被打开的文件会 EPERM）。这种情况**不能吞掉** —— 否则后续
 * 断言会跑在一个不新鲜的夹具上，给出看似可信的错误结论。
 */
function stashDir(dir: string, tag: string): Stashed {
  if (!existsSync(dir)) return { existed: false, stashPath: null };
  const target = path.join(ISOLATION, tag);
  try {
    mkdirSync(ISOLATION, { recursive: true });
    renameSync(dir, target);
  } catch (error) {
    throw new Error(
      `无法隔离 ${path.relative(ROOT, dir)}（${error instanceof Error ? error.message : String(error)}）。`
      + "多半是本机 dev server 正占着 data/events/ 的文件句柄，"
      + "请先停掉 `npm run dev` 再跑本脚本。",
    );
  }
  return { existed: true, stashPath: target };
}

/** 收尾：把本轮跑出来的目录挪进隔离区，再按需还原运行前那一份。返回本轮产物去了哪里。 */
function unstashDir(dir: string, stashed: Stashed, runTag: string): "moved" | "none" | "leftover" {
  let moved: "moved" | "none" | "leftover" = "none";
  if (existsSync(dir)) {
    try {
      mkdirSync(ISOLATION, { recursive: true });
      renameSync(dir, path.join(ISOLATION, `${runTag}-${Date.now()}`));
      moved = existsSync(dir) ? "leftover" : "moved";
    } catch {
      moved = "leftover";
    }
  }
  if (stashed.existed && stashed.stashPath && !existsSync(dir)) {
    try {
      renameSync(stashed.stashPath, dir);
    } catch {
      /* 还原失败会在报告里体现为「原目录未回来」，下面单独断言 */
    }
  }
  return moved;
}

// ────────────────────────────────────────────────────────────
// 3. dev server 生命周期
// ────────────────────────────────────────────────────────────

let server: ChildProcess | null = null;
let serverPid = 0;

async function startServer(): Promise<boolean> {
  const bin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
  server = spawn(process.execPath, [bin, "dev", "-p", String(PORT)], {
    cwd: ROOT,
    env: {
      ...process.env,
      // 显式钉住 file 后端：本脚本只验本地，绝不碰 Supabase
      DATA_BACKEND: "file",
      NEXT_DIST_DIR: E2E_DIST,
      // 显式钉住写开关（本地默认即开；钉住是为了不被外层环境变量关掉而静默 403）
      REFEREE_REPORTING_ENABLED: "1",
    },
    stdio: "ignore",
    detached: process.platform !== "win32",
  });
  serverPid = server.pid ?? 0;

  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/api/health`, {
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) return true;
    } catch {
      /* 还没起来 */
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return false;
}

function stopServer() {
  const child = server;
  if (!serverPid || !child) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(serverPid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      // detached 起的 server 自成进程组，负号 PID 一次带走整组
      process.kill(-serverPid, "SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {
        /* 已经没了 */
      }
    }
  }
  server = null;
  serverPid = 0;
}

// ────────────────────────────────────────────────────────────
// 4. HTTP 小工具
// ────────────────────────────────────────────────────────────

interface Res {
  status: number;
  body: Record<string, unknown>;
  raw: string;
}

const REQUEST_TIMEOUT_MS = 60_000;

async function call(url: string, init: RequestInit = {}): Promise<Res> {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    ...init,
  });
  const raw = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    /* 非 JSON 也照样看 raw */
  }
  return { status: response.status, body, raw };
}

function postJson(pathname: string, payload: unknown, credential?: string): Promise<Res> {
  return call(`${BASE}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(credential ? { "x-referee-credential": credential } : {}),
    },
    body: JSON.stringify(payload),
  });
}

function getJson(pathname: string, credential?: string): Promise<Res> {
  return call(
    `${BASE}${pathname}`,
    credential ? { headers: { "x-referee-credential": credential } } : {},
  );
}

/**
 * 本地回退的管理端口令：**从代码里读，不在脚本里存第二份**。
 *
 * 存第二份的后果是它会悄悄漂移 —— 代码里换了值，脚本还拿旧值去登，
 * 报出来的却是「管理员登录失败」，看起来像登录坏了。这里直接读 `auth.ts` 里
 * `requiredHostedSecret("ADMIN_PASSWORD", "<本地回退值>", 12)` 的第二个参数，
 * 于是只有一处真源。
 */
function readLocalAdminPassword(): string {
  const source = readFileSync(path.join(ROOT, "src", "lib", "domains", "identity", "admin-session.ts"), "utf8");
  const match = source.match(/requiredHostedSecret\(\s*"ADMIN_PASSWORD"\s*,\s*"([^"]+)"/);
  if (!match) {
    throw new Error("没能从 src/lib/domains/identity/admin-session.ts 读到本地回退的管理端口令（那一段被改过？）");
  }
  return match[1];
}

/** 管理员登录，返回可以回放的会话 cookie。 */
async function adminLogin(password: string): Promise<string> {
  const response = await fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`管理员登录失败 HTTP ${response.status}`);
  // getSetCookie 在 Node 的 undici 上有、但类型定义不一定声明，故显式标注
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const raw = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : [response.headers.get("set-cookie") ?? ""];
  const session = raw.map((entry) => entry.split(";")[0]).find((entry) => entry.startsWith("admin_session="));
  if (!session) throw new Error("管理员登录返回成功，但没有下发会话 cookie");
  return session;
}

/** 带管理员会话调管理接口。 */
function postAdmin(pathname: string, payload: unknown, cookie: string): Promise<Res> {
  return call(`${BASE}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(payload),
  });
}

function getAdmin(pathname: string, cookie: string): Promise<Res> {
  return call(`${BASE}${pathname}`, { headers: { Cookie: cookie } });
}

/**
 * 在**全新的 ArrayBuffer** 上建 Uint8Array：这样类型是 Uint8Array<ArrayBuffer>，
 * 才能直接作为 fetch 的 body / BlobPart（Uint8Array<ArrayBufferLike> 不行）。
 */
function tinyPng(): Uint8Array<ArrayBuffer> {
  const decoded = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  const out = new Uint8Array(decoded.length);
  out.set(decoded);
  return out;
}

/** multipart 上传（upload 与 recognize 同形：file + eventId + matchId，凭证走头部）。 */
function postImage(
  pathname: string,
  body: { eventId: string | null; matchId: string; gameIndex?: number },
  credential?: string,
): Promise<Res> {
  const form = new FormData();
  form.append("file", new File([tinyPng()], "e2e.png", { type: "image/png" }));
  if (body.eventId !== null) form.append("eventId", body.eventId);
  form.append("matchId", body.matchId);
  if (body.gameIndex !== undefined) form.append("gameIndex", String(body.gameIndex));
  return call(`${BASE}${pathname}`, {
    method: "POST",
    headers: credential ? { "x-referee-credential": credential } : {},
    body: form,
  });
}

// ────────────────────────────────────────────────────────────
// 5. 本地文档读取（本地是裸 payload，没有 { payload, version } 包裹）
// ────────────────────────────────────────────────────────────

function readLocalDoc(name: string): Record<string, unknown> {
  const file = path.join(EVENT_DIR, `${name}.json`);
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

function matchesInDoc(doc: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(doc.matches) ? (doc.matches as Array<Record<string, unknown>>) : [];
}

// ────────────────────────────────────────────────────────────
// 6. 用例
// ────────────────────────────────────────────────────────────

/** 一场 BO3、2:0 结束的合法逐局比分（M-R1 的 BO 类型是 BO3） */
const TWO_WIN_GAMES = [
  { map: "莲华古城", teamAScore: 13, teamBScore: 7 },
  { map: "亚海悬城", teamAScore: 13, teamBScore: 10 },
];

/** BO3 只报一局：合法输入格式、但构不成完赛 */
const SHORT_BO_GAMES = [{ map: "莲华古城", teamAScore: 13, teamBScore: 7 }];

/**
 * 七个调用点（六个接口）用无效凭证各打一遍。
 *
 * 为什么连 GET 也要打：鉴权分支在读写两侧都有（claim 的 GET 走 refereeOpenMatches、
 * POST 走 refereeClaimMatch），只打一侧会漏掉另一个分支。
 */
function authProbes(): Array<{ name: string; run: () => Promise<Res> }> {
  const wrong = WRONG_CREDENTIAL;
  return [
    { name: "POST /referee/login", run: () => postJson("/api/referee/login", { eventId: EVENT, credential: wrong }) },
    { name: "GET  /referee/matches", run: () => getJson(`/api/referee/matches?eventId=${EVENT}`, wrong) },
    { name: "GET  /referee/claim", run: () => getJson(`/api/referee/claim?eventId=${EVENT}`, wrong) },
    { name: "POST /referee/claim", run: () => postJson("/api/referee/claim", { eventId: EVENT, matchId: "M-R2", action: "claim" }, wrong) },
    { name: "POST /referee/submit", run: () => postJson("/api/referee/submit", { eventId: EVENT, matchId: "M-R1", basedOnScheduleVersion: 1, games: TWO_WIN_GAMES }, wrong) },
    { name: "POST /referee/upload", run: () => postImage("/api/referee/upload", { eventId: EVENT, matchId: "M-R1" }, wrong) },
    { name: "POST /referee/recognize", run: () => postImage("/api/referee/recognize", { eventId: EVENT, matchId: "M-R1", gameIndex: 1 }, wrong) },
  ];
}

async function main() {
  console.log(`裁判端 HTTP 链路验收 · ${BASE} · 赛事 ${EVENT}`);
  console.log("");

  // 先把夹具挪走，保证本轮从「干净播种」开始（播种是幂等的，残留会让断言不确定）
  isolation.event = stashDir(EVENT_DIR, "pre-run-events");
  isolation.evidence = stashDir(EVIDENCE_DIR, "pre-run-evidence");
  console.log(
    `夹具隔离：演示赛事目录 ${isolation.event.existed ? "上一轮残留已挪入隔离区" : "本就不存在"}；`
    + `凭证目录 ${isolation.evidence.existed ? "上一轮残留已挪入隔离区" : "本就不存在"}`,
  );
  console.log("");

  if (!(await startServer())) throw new Error(`dev server 未能就绪（端口 ${PORT}）`);

  // ── 1. 鉴权一致性 ───────────────────────────────────────
  console.log("== 1. ★ 七个调用点 · 无效凭证一律 401，且提示是同一句可照做的中文 ==");
  const probeResults: Array<{ name: string; status: number; message: string }> = [];
  for (const probe of authProbes()) {
    const result = await probe.run();
    const message = typeof result.body.message === "string" ? result.body.message : "";
    probeResults.push({ name: probe.name, status: result.status, message });
    check(
      `${probe.name} → 401`,
      result.status === 401,
      `HTTP ${result.status} ${result.raw.slice(0, 80)}`,
    );
  }
  const badStatus = probeResults.filter((p) => p.status !== 401);
  check(
    "状态码完全一致（不会出现「同一种失败两种表现」）",
    badStatus.length === 0,
    badStatus.map((p) => `${p.name}=${p.status}`).join("、"),
  );

  const distinctMessages = [...new Set(probeResults.map((p) => p.message))];
  check("文案完全一致", distinctMessages.length === 1, distinctMessages.join(" | "));
  // 注意是「每一条」而不是「第一条」：只查第一条的话，只要有任意一个调用点漏改，
  // 而它恰好不是被比较的那条，就会漏报（本脚本的变异验证踩过这个坑）。
  check(
    "每一条文案都不是内部码（裁判看到的应是中文，不是 INVALID_CREDENTIAL）",
    distinctMessages.length > 0 && distinctMessages.every((m) => m.length > 0 && !LOOKS_LIKE_INTERNAL_CODE.test(m)),
    distinctMessages.join(" | "),
  );
  check(
    "每一条文案都给出了下一步",
    distinctMessages.length > 0 && distinctMessages.every((m) => /重新登录|联系负责人|确认赛事|分配/.test(m)),
    distinctMessages.join(" | "),
  );

  // ── 2. 正常链路 ─────────────────────────────────────────
  console.log("");
  console.log("== 2. 正常链路：登录 → 我的比赛 → 上传凭证 → 提交报分 ==");

  const login = await postJson("/api/referee/login", { eventId: EVENT, credential: CREDENTIAL });
  check("登录成功", login.status === 200 && login.body.ok === true, `HTTP ${login.status} ${login.raw.slice(0, 80)}`);

  const mine = await getJson(`/api/referee/matches?eventId=${EVENT}`, CREDENTIAL);
  check("我的比赛可读", mine.status === 200, `HTTP ${mine.status} ${mine.raw.slice(0, 80)}`);
  const scheduleVersion = mine.body.scheduleVersion;
  check("响应带数值型 scheduleVersion", typeof scheduleVersion === "number", String(scheduleVersion));
  const myMatchIds = ((mine.body.matches ?? []) as Array<{ matchId?: string }>)
    .map((m) => m.matchId ?? "?");
  check("播种分配的比赛 M-R1 在列表里", myMatchIds.includes("M-R1"), myMatchIds.join(", "));
  check("未被分配的 M-R2 不在列表里", !myMatchIds.includes("M-R2"), myMatchIds.join(", "));

  const uploaded = await postImage("/api/referee/upload", { eventId: EVENT, matchId: "M-R1" }, CREDENTIAL);
  const evidenceId = typeof uploaded.body.evidenceId === "string" ? uploaded.body.evidenceId : "";
  check("上传凭证成功并返回 evidenceId", uploaded.status === 200 && evidenceId.length > 0, `HTTP ${uploaded.status} ${uploaded.raw.slice(0, 100)}`);

  const submitted = await postJson("/api/referee/submit", {
    eventId: EVENT,
    matchId: "M-R1",
    basedOnScheduleVersion: scheduleVersion,
    games: TWO_WIN_GAMES,
    evidenceIds: evidenceId ? [evidenceId] : [],
  }, CREDENTIAL);
  const submissionId = typeof submitted.body.submissionId === "string" ? submitted.body.submissionId : "";
  check("提交报分成功", submitted.status === 200, `HTTP ${submitted.status} ${submitted.raw.slice(0, 140)}`);
  check("返回提交号与受理状态", submissionId.length > 0 && submitted.body.status === "accepted", submitted.raw.slice(0, 140));
  check("判定胜者由逐局比分推导（2:0 → team-a）", submitted.body.declaredWinnerTeamId === "team-a", String(submitted.body.declaredWinnerTeamId));

  // ── 3. 落盘与关联 ───────────────────────────────────────
  console.log("");
  console.log("== 3. ★ 四份文档落盘并互相咬合（走本地 data-store，不是直连库） ==");

  const schedule = readLocalDoc("schedule");
  const scheduleAfter = typeof schedule.version === "number" ? schedule.version : -1;
  check(
    "赛程版本被递增（管理端旧快照因此不可能静默覆盖裁判已报的赛果）",
    typeof scheduleVersion === "number" && scheduleAfter > scheduleVersion,
    `${String(scheduleVersion)} → ${String(scheduleAfter)}`,
  );

  const matchR1 = matchesInDoc(schedule).find((m) => m.id === "M-R1");
  check("赛程里 M-R1 变成已完成", matchR1?.status === "已完成", String(matchR1?.status));
  check("胜者写进了赛程", matchR1?.winnerTeamId === "team-a", String(matchR1?.winnerTeamId));
  check(
    "逐局比分写进了赛程",
    Array.isArray(matchR1?.gameResults) && (matchR1.gameResults as unknown[]).length === TWO_WIN_GAMES.length,
    JSON.stringify(matchR1?.gameResults),
  );

  const resultLedger = readLocalDoc("result-ledger");
  const submissions = (resultLedger.submissions ?? []) as Array<Record<string, unknown>>;
  const mySubmissions = submissions.filter((s) => s.matchId === "M-R1");
  check("赛果台账里恰好一条 M-R1 提交", mySubmissions.length === 1, `共 ${mySubmissions.length} 条`);
  check("台账里那条就是这次提交号", mySubmissions[0]?.id === submissionId, String(mySubmissions[0]?.id));
  check(
    "台账记下了携带的凭证",
    Array.isArray(mySubmissions[0]?.evidenceIds)
      && (mySubmissions[0].evidenceIds as string[]).includes(evidenceId),
    JSON.stringify(mySubmissions[0]?.evidenceIds),
  );

  const evidenceLedger = readLocalDoc("evidence-ledger");
  const evidenceRows = (evidenceLedger.evidence ?? []) as Array<Record<string, unknown>>;
  const myEvidence = evidenceRows.find((e) => e.id === evidenceId);
  check("凭证已登记进台账", Boolean(myEvidence), evidenceRows.map((e) => String(e.id)).join(", "));
  check(
    "凭证挂到了提交上（不是孤儿草稿）",
    myEvidence?.submissionId === submissionId,
    String(myEvidence?.submissionId),
  );

  const refereeLedger = readLocalDoc("referee-ledger");
  const assignments = (refereeLedger.assignments ?? []) as Array<Record<string, unknown>>;
  check(
    "裁判台账里 M-R1 仍是有效分配",
    assignments.some((a) => a.matchId === "M-R1" && a.status === "assigned"),
    JSON.stringify(assignments.map((a) => `${String(a.matchId)}:${String(a.status)}`)),
  );

  const evidenceFiles = existsSync(EVIDENCE_DIR) ? readdirSync(EVIDENCE_DIR) : [];
  check("凭证文件落在 data/evidence/<赛事>/", evidenceFiles.length > 0, evidenceFiles.join(", "));
  const uploadsMid = existsSync(UPLOADS_DIR) ? readdirSync(UPLOADS_DIR) : [];
  check("public/uploads 未被写入", uploadsMid.length === uploadsBefore.length, `${uploadsBefore.length} → ${uploadsMid.length}`);

  // ── 4. 边界 ─────────────────────────────────────────────
  console.log("");
  console.log("== 4. 边界：未分配 / 自助认领 / 局数不足 / 缺参数 / 对阵变更 / 重复提交 ==");

  const notMine = await postJson("/api/referee/submit", {
    eventId: EVENT,
    matchId: "M-R2",
    basedOnScheduleVersion: scheduleAfter,
    games: TWO_WIN_GAMES,
  }, CREDENTIAL);
  check("未分配的比赛被拒 → 401", notMine.status === 401, `HTTP ${notMine.status} ${notMine.raw.slice(0, 100)}`);
  check("并说明「没有分配给你」", /没有分配/.test(String(notMine.body.message ?? "")), String(notMine.body.message));

  const claimed = await postJson("/api/referee/claim", { eventId: EVENT, matchId: "M-R2", action: "claim" }, CREDENTIAL);
  check("自助认领未被占用的比赛成功", claimed.status === 200, `HTTP ${claimed.status} ${claimed.raw.slice(0, 100)}`);

  const shortBo = await postJson("/api/referee/submit", {
    eventId: EVENT,
    matchId: "M-R2",
    basedOnScheduleVersion: scheduleAfter,
    games: SHORT_BO_GAMES,
  }, CREDENTIAL);
  check("认领后 BO3 只报一局 → 被领域校验挡下（400，不是 500）", shortBo.status === 400, `HTTP ${shortBo.status} ${shortBo.raw.slice(0, 100)}`);
  check(
    "挡住的同时给了可读中文",
    hasChinese(String(shortBo.body.message ?? "")) && !LOOKS_LIKE_INTERNAL_CODE.test(String(shortBo.body.message ?? "")),
    String(shortBo.body.message),
  );

  const missingEvent = await postJson("/api/referee/submit", { matchId: "M-R1", games: TWO_WIN_GAMES }, CREDENTIAL);
  check("缺赛事 ID → 400", missingEvent.status === 400, `HTTP ${missingEvent.status} ${missingEvent.raw.slice(0, 100)}`);

  const changed = await postJson("/api/referee/submit", {
    eventId: EVENT,
    matchId: "M-R1",
    basedOnScheduleVersion: scheduleAfter,
    games: TWO_WIN_GAMES,
    expectedTeamAName: "已经换掉的队名",
    expectedTeamBName: "也已经换掉",
  }, CREDENTIAL);
  check("对阵已变更 → 409（与校验失败区分开，客户端才知道要刷新重看）", changed.status === 409, `HTTP ${changed.status} ${changed.raw.slice(0, 120)}`);
  check("并提示刷新后重新确认", /刷新/.test(String(changed.body.message ?? "")), String(changed.body.message));

  const versionBeforeDup = (readLocalDoc("schedule").version ?? -1) as number;
  const duplicate = await postJson("/api/referee/submit", {
    eventId: EVENT,
    matchId: "M-R1",
    basedOnScheduleVersion: scheduleVersion,
    games: TWO_WIN_GAMES,
    evidenceIds: evidenceId ? [evidenceId] : [],
  }, CREDENTIAL);
  check("重复提交同一份内容不报 500", duplicate.status === 200, `HTTP ${duplicate.status} ${duplicate.raw.slice(0, 120)}`);
  check("重复提交返回同一个提交号（幂等）", duplicate.body.submissionId === submissionId, String(duplicate.body.submissionId));
  const afterDup = ((readLocalDoc("result-ledger").submissions ?? []) as Array<Record<string, unknown>>)
    .filter((s) => s.matchId === "M-R1");
  check("重复提交没有多写一条台账", afterDup.length === 1, `共 ${afterDup.length} 条`);
  const versionAfterDup = (readLocalDoc("schedule").version ?? -1) as number;
  check("重复提交没有递增赛程版本（幂等命中不产生写入）", versionAfterDup === versionBeforeDup, `${versionBeforeDup} → ${versionAfterDup}`);

  // ── 5. 管理端建账号 → 裁判端立刻能用 ─────────────────────
  console.log("");
  console.log("== 5. ★ 管理端建账号 → 那个凭证立刻能用（上线时真正要走的路径） ==");
  console.log("   （前面几节用的是播种好的演示裁判。这一节走的是负责人真实会点的那条路：");
  console.log("     后台建账号、当场抄下只显示一次的凭证、交给裁判。）");

  const adminCookie = await adminLogin(readLocalAdminPassword());
  check("管理员登录成功", adminCookie.startsWith("admin_session="), adminCookie.slice(0, 20));

  const before = await getAdmin(`/api/admin/referees?eventId=${EVENT}`, adminCookie);
  const beforeCount = ((before.body.referees ?? []) as unknown[]).length;
  check("裁判列表可读", before.status === 200, `HTTP ${before.status} ${before.raw.slice(0, 100)}`);

  const created = await postAdmin("/api/admin/referees", {
    eventId: EVENT,
    action: "create",
    payload: { displayName: "端到端裁判" },
  }, adminCookie);
  const newRefereeId = typeof created.body.refereeId === "string" ? created.body.refereeId : "";
  const newCredential = typeof created.body.credential === "string" ? created.body.credential : "";
  check("建账号成功", created.status === 200 && newRefereeId.length > 0, `HTTP ${created.status} ${created.raw.slice(0, 120)}`);
  check(
    "返回了一次性凭证，且长度够（服务端要求 ≥20）",
    newCredential.length >= 20,
    `长度 ${newCredential.length}`,
  );
  check(
    "★ 这条凭证从不出现在台账里（台账只存哈希）",
    !readFileSync(path.join(EVENT_DIR, "referee-ledger.json"), "utf8").includes(newCredential),
  );

  const newLogin = await postJson("/api/referee/login", { eventId: EVENT, credential: newCredential });
  check("★ 刚建的凭证可以立刻登录", newLogin.status === 200 && newLogin.body.ok === true, `HTTP ${newLogin.status} ${newLogin.raw.slice(0, 100)}`);

  const newMine = await getJson(`/api/referee/matches?eventId=${EVENT}`, newCredential);
  const newMatchIds = ((newMine.body.matches ?? []) as Array<{ matchId?: string }>).map((m) => m.matchId ?? "?");
  check("新账号的「我的比赛」是空的", newMine.status === 200 && newMatchIds.length === 0, newMatchIds.join(", "));
  check(
    "★ 看不到别人被分配的比赛（M-R1 不属于它）",
    !newMatchIds.includes("M-R1"),
    newMatchIds.join(", "),
  );

  const assigned = await postAdmin("/api/admin/referees", {
    eventId: EVENT,
    action: "assign",
    payload: { refereeId: newRefereeId, matchId: "M-R3" },
  }, adminCookie);
  check("管理端指派一场给新账号", assigned.status === 200, `HTTP ${assigned.status} ${assigned.raw.slice(0, 120)}`);

  const afterAssign = await getJson(`/api/referee/matches?eventId=${EVENT}`, newCredential);
  const afterIds = ((afterAssign.body.matches ?? []) as Array<{ matchId?: string }>).map((m) => m.matchId ?? "?");
  check("指派的 M-R3 出现在它的列表里", afterIds.includes("M-R3"), afterIds.join(", "));
  check("仍然看不到 M-R1", !afterIds.includes("M-R1"), afterIds.join(", "));

  const listed = await getAdmin(`/api/admin/referees?eventId=${EVENT}`, adminCookie);
  const afterCount = ((listed.body.referees ?? []) as unknown[]).length;
  check("裁判列表里多了一个人", afterCount === beforeCount + 1, `${beforeCount} → ${afterCount}`);

  const unauthed = await call(`${BASE}/api/admin/referees?eventId=${EVENT}`);
  check("没带会话读裁判列表 → 401", unauthed.status === 401, `HTTP ${unauthed.status}`);
}

// ────────────────────────────────────────────────────────────
// 6. 收尾与现场还原
// ────────────────────────────────────────────────────────────

void main()
  .catch((error: unknown) => {
    fail += 1;
    console.error(`  ✗ 用例中断：${error instanceof Error ? error.message : String(error)}`);
  })
  .finally(() => {
    console.log("");
    console.log("== 6. 收尾与现场还原 ==");
    stopServer();

    // 先停 server 再还原 tsconfig：Next 启动时会往 include 里加构建目录的类型路径
    let tsconfigOk = hashOf(readFileSync(TSCONFIG, "utf8")) === tsconfigBefore.hash;
    if (!tsconfigOk) {
      try {
        writeFileSync(TSCONFIG, tsconfigBefore.raw, "utf8");
        tsconfigOk = hashOf(readFileSync(TSCONFIG, "utf8")) === tsconfigBefore.hash;
      } catch {
        /* 下面按失败报告 */
      }
    }
    check("tsconfig.json 已还原到运行前", tsconfigOk, `快照 ${tsconfigBefore.hash}`);

    const uploadsAfter = existsSync(UPLOADS_DIR) ? readdirSync(UPLOADS_DIR) : [];
    const strayUploads = uploadsAfter.filter((f) => !uploadsBefore.includes(f));
    check("public/uploads 无新增文件", strayUploads.length === 0, strayUploads.join(", "));

    if (KEEP) {
      console.log("  · --keep：保留本轮的演示赛事与凭证，便于手动查看");
      console.log(`    演示赛事：${path.relative(ROOT, EVENT_DIR)}`);
      console.log(`    凭证目录：${path.relative(ROOT, EVIDENCE_DIR)}`);
      if (isolation.event.stashPath) {
        console.log(`    运行前那一份仍在：${path.relative(ROOT, isolation.event.stashPath)}`);
      }
    } else {
      const movedEvent = unstashDir(EVENT_DIR, isolation.event, "run-events");
      const movedEvidence = unstashDir(EVIDENCE_DIR, isolation.evidence, "run-evidence");
      check("本轮的演示赛事目录已移出工作区", movedEvent !== "leftover", movedEvent);
      check("本轮的凭证目录已移出工作区", movedEvidence !== "leftover", movedEvidence);
      check(
        "运行前那一份已还原",
        isolation.event.existed ? existsSync(EVENT_DIR) : true,
        isolation.event.existed ? "原目录没回来" : "（运行前本就没有，无需还原）",
      );
      check(
        "运行前的凭证目录已还原",
        isolation.evidence.existed ? existsSync(EVIDENCE_DIR) : true,
        isolation.evidence.existed ? "原目录没回来" : "（运行前本就没有，无需还原）",
      );
      console.log(`  · 本轮产物与运行前的残留都在 ${path.relative(ROOT, ISOLATION)}/（已 gitignore，未删除）`);
    }

    console.log("");
    console.log(`结果：通过 ${pass} / ${pass + fail}`);
    if (fail > 0) console.error(`${fail} 项未通过`);
    process.exit(fail > 0 ? 1 : 0);
  });
