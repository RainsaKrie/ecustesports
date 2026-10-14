// =====================
// 换赛制 +「小组赛组内单败」隔离演练（2026-10-14）
// 运行：npm run test:format-switch   （起一个自己的 dev server，约 30 秒）
//
// 为什么需要它：这两件事都在**改真实赛事配置**的路径上，单元测试证明不了端到端：
//   ① 放宽后的换赛制守卫：允许「改还没开打的阶段」，仍拒绝「动已打完的阶段」；
//   ② 新阶段类型 `single-elim-groups` 写进 site-config 之后**读回来还是它** ——
//      类型白名单漏一种会被**静默改写成兜底值**（加这个类型时就踩到过），
//      这种「写进去、读回来变了样」只有走一遍真实读写才验得到。
//
// 隔离做法：临时造一个自己的赛事（site-config 条目 + 赛程文件），
// 跑完删掉它、并按 sha256 还原 site-config，确认工作区无残留。
//
// ★ 不放进 `npm run gate`：它要起 dev server，会把「本机没有别的 dev server 在跑」
//   变成门禁前提（dev server 占着 data/events/ 的句柄）。照 `test:referee-http` 的做法挂在 `gate:full`。
// =====================

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
// ⚠️ 必须是**相对**路径：这台机器的 fs 垫片会把它拼到工作目录后面，
// 传绝对路径会变成 `...\项目\D://Projects//...//.next-x//dev` 而 mkdir 失败（实测踩过）。
const E2E_DIST = ".workbuddy/format-switch-dist";
const args = process.argv.slice(2);
const PORT = Number(args[args.indexOf("--port") + 1]) || 3997;
const BASE = `http://localhost:${PORT}`;
const EVENT_ID = "event-format-switch-e2e";

const CONFIG_FILE = path.join(ROOT, "data", "site-config.json");
const EVENT_DIR = path.join(ROOT, "data", "events", EVENT_ID);
const AUDIT_FILE = path.join(ROOT, "data", "operation-audit.json");
// Next 会因自定义 distDir 改写 tsconfig.json 的 include 与格式，收尾必须还原（现成 e2e 脚本同样如此）。
const TSCONFIG = path.join(ROOT, "tsconfig.json");

/** 新模板与原来那套（用于来回切换） */
const NEXT_TEMPLATE = "val-36playin-32qual-16seg-8de";
const ORIGINAL_TEMPLATE = "val-36playin-32qual-16gsl-8de";
/** 只有一个阶段的模板：会让已打过的资格赛/入围赛变成孤儿，必须被拒 */
const ORPHAN_TEMPLATE = "val-32ko";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.log(`  ✗ ${name}${detail ? `（${detail}）` : ""}`); }
}

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

// ────────────────────────────────────────────────────────────
// 1. 现场快照（跑完必须原样还回去）
// ────────────────────────────────────────────────────────────

if (!existsSync(CONFIG_FILE)) throw new Error("找不到 data/site-config.json");
const configBefore = readFileSync(CONFIG_FILE);
const configSha = sha256(configBefore);
const auditBefore = existsSync(AUDIT_FILE) ? readFileSync(AUDIT_FILE) : null;
const tsconfigBefore = readFileSync(TSCONFIG);
const tsconfigSha = sha256(tsconfigBefore);
const config = JSON.parse(configBefore.toString("utf8")) as {
  events: Array<Record<string, unknown>>;
  currentEventId: string;
};

const source = config.events[0];
if (!source) throw new Error("本地 site-config 里没有赛事，无法克隆夹具");

/** 赛程夹具：资格赛 4 场 + 入围赛 16 场，全部已完成（= 本届的真实形态） */
function fixtureMatches() {
  const make = (phase: string, count: number, prefix: string) =>
    Array.from({ length: count }, (_, index) => ({
      id: `${prefix}${String(index + 1).padStart(2, "0")}`,
      phase,
      round: phase,
      boType: "BO1",
      teamAId: `${prefix}-${index}-a`,
      teamBId: `${prefix}-${index}-b`,
      teamAName: `甲${index}`,
      teamBName: `乙${index}`,
      startTime: "",
      endTime: "",
      status: "已完成",
      frozen: false,
      winnerTeamId: `${prefix}-${index}-a`,
    }));
  return [...make("资格赛", 4, "Q"), ...make("入围赛", 16, "P")];
}

function writeFixtures() {
  // 克隆一个自己的赛事：状态 ongoing、赛制用「原模板」（GSL 小组赛）
  const fixture = {
    ...source,
    id: EVENT_ID,
    name: "换赛制演练（临时，跑完删除）",
    status: "ongoing",
    visibility: "public",
    stageConfigs: [
      { name: "资格赛", type: "single-elim", teamCount: 8, boType: "BO1" },
      { name: "入围赛", type: "single-elim", teamCount: 32, boType: "BO1" },
      { name: "小组赛", type: "gsl-groups", teamCount: 16, groupCount: 4, boType: "BO3" },
      { name: "淘汰赛", type: "double-elim", teamCount: 8, boType: "BO3" },
    ],
  };
  writeFileSync(CONFIG_FILE, `${JSON.stringify({ ...config, events: [...config.events, fixture] }, null, 2)}\n`, "utf8");

  mkdirSync(EVENT_DIR, { recursive: true });
  writeFileSync(
    path.join(EVENT_DIR, "schedule.json"),
    `${JSON.stringify({ config: null, configConfirmed: false, version: 1, matches: fixtureMatches(), versions: [], requests: [], notifications: [] }, null, 2)}\n`,
    "utf8",
  );
}

function restore() {
  writeFileSync(TSCONFIG, tsconfigBefore);
  writeFileSync(CONFIG_FILE, configBefore);
  if (auditBefore) writeFileSync(AUDIT_FILE, auditBefore);
  else if (existsSync(AUDIT_FILE)) rmSync(AUDIT_FILE, { force: true });
  rmSync(EVENT_DIR, { recursive: true, force: true });
  rmSync(path.join(ROOT, E2E_DIST), { recursive: true, force: true });
}

function verifyClean() {
  const restored = sha256(readFileSync(CONFIG_FILE)) === configSha;
  check("site-config 已按 sha256 原样还原", restored);
  check("临时赛事目录已清理", !existsSync(EVENT_DIR));
  check("tsconfig.json 已还原到运行前（Next 会改写它）", sha256(readFileSync(TSCONFIG)) === tsconfigSha);
}

// ────────────────────────────────────────────────────────────
// 2. dev server 生命周期（照 e2e-referee-http 的写法）
// ────────────────────────────────────────────────────────────

let server: ChildProcess | null = null;
let serverPid = 0;

async function startServer(): Promise<boolean> {
  const bin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
  server = spawn(process.execPath, [bin, "dev", "-p", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, DATA_BACKEND: "file", NEXT_DIST_DIR: E2E_DIST },
    stdio: "ignore",
    detached: process.platform !== "win32",
  });
  serverPid = server.pid ?? 0;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/api/health`, { cache: "no-store", signal: AbortSignal.timeout(5_000) });
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
    return;
  }
  try {
    process.kill(-serverPid, "SIGKILL");
  } catch {
    try { child.kill("SIGKILL"); } catch { /* 已经没了 */ }
  }
}

// ────────────────────────────────────────────────────────────
// 3. 演练主体
// ────────────────────────────────────────────────────────────

async function main() {
  console.log("== 0. 造隔离夹具（临时赛事 + 20 场已完成的资格赛/入围赛）==");
  writeFixtures();
  check("夹具已写入（赛事 + 赛程文件）", existsSync(path.join(EVENT_DIR, "schedule.json")));

  if (!(await startServer())) throw new Error("dev server 没能起来");

  const login = await fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "ecust2026" }),
  });
  const cookie = (login.headers.getSetCookie?.() ?? []).map((item) => item.split(";")[0]).join("; ");

  const switchFormat = async (templateId: string) => {
    const response = await fetch(`${BASE}/api/admin/events/format`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ eventId: EVENT_ID, templateId }),
    });
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    return { status: response.status, message: body.message ?? "" };
  };
  const readStages = async () => {
    const response = await fetch(`${BASE}/api/admin/site-config`, { cache: "no-store" });
    const body = (await response.json()) as { events?: Array<{ id: string; stageConfigs?: Array<{ name: string; type: string }> }> };
    return body.events?.find((item) => item.id === EVENT_ID)?.stageConfigs ?? [];
  };

  console.log("\n== 1. 放宽后的守卫：已打完的赛段不动、未开打的赛段可改 ==");
  check("登录拿到管理端会话", cookie.length > 0);

  const swapped = await switchFormat(NEXT_TEMPLATE);
  check(
    "★ 已有 20 场赛程时，把小组赛 GSL → 组内单败：**放行**（旧守卫会一律拒绝）",
    swapped.status === 200,
    `status=${swapped.status} message=${swapped.message}`,
  );

  const stagesAfter = await readStages();
  const groupStage = stagesAfter.find((stage) => stage.name === "小组赛");
  check(
    "★ 新阶段类型写进去、读回来仍是 single-elim-groups（类型白名单没把它改写成兜底值）",
    groupStage?.type === "single-elim-groups",
    JSON.stringify(stagesAfter.map((stage) => [stage.name, stage.type])),
  );
  check(
    "已打完的两个赛段配置没被动（资格赛/入围赛仍是单败 8/32）",
    stagesAfter[0]?.name === "资格赛" && stagesAfter[1]?.name === "入围赛",
    JSON.stringify(stagesAfter.map((stage) => stage.name)),
  );

  console.log("\n== 2. 该拒的仍然要拒 ==");
  const orphan = await switchFormat(ORPHAN_TEMPLATE);
  check(
    "换成只有「入围赛」的赛制 → 拒绝，并点出已有比赛的阶段成了孤儿",
    orphan.status === 400 && orphan.message.includes("已经有比赛"),
    `status=${orphan.status} message=${orphan.message}`,
  );
  const stagesAfterReject = await readStages();
  check(
    "被拒之后赛制没被改动（还是组内单败）",
    stagesAfterReject.find((stage) => stage.name === "小组赛")?.type === "single-elim-groups",
  );

  console.log("\n== 3. 换回去也要能换（不是单向的）==");
  const back = await switchFormat(ORIGINAL_TEMPLATE);
  check("换回原模板（GSL 小组赛）→ 放行", back.status === 200, `status=${back.status} message=${back.message}`);
  const stagesBack = await readStages();
  check(
    "小组赛类型回到 gsl-groups",
    stagesBack.find((stage) => stage.name === "小组赛")?.type === "gsl-groups",
    JSON.stringify(stagesBack.map((stage) => [stage.name, stage.type])),
  );

  console.log("");
  console.log(`结果：通过 ${pass} / ${pass + fail}`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("演练失败：", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    stopServer();
    restore();
    verifyClean();
    if (fail > 0 || process.exitCode === 1) console.error(`${fail} 项未通过`);
  });
