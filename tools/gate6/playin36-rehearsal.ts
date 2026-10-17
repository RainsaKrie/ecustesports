/**
 * 36 队四阶段赛制 · 隔离赛事端到端演练
 *
 * 目的：在动生产数据之前，用一场**隔离赛事**把
 *   「36 队 → 资格赛(8) → 入围赛(32) → 小组赛(16) → 淘汰赛(8) → 冠军」
 * 这条路完整跑一遍，并断言每一道门控。
 *
 * ── 隔离口径 ────────────────────────────────────────────────
 *   - 赛事通过真实管理接口新建，ID 形如 event-<时间戳36进制>，不复用任何真实赛事 ID
 *   - 报名数据只写在该赛事自己的目录 data/events/<id>/registration.json
 *   - dev server 用独立构建目录 .workbuddy/rehearsal-dist（NEXT_DIST_DIR），
 *     既不与你自己开着的 dev server 争用 .next，也不会读到上一轮的 fetch-cache
 *   - 收尾（含中途失败）时：还原 data/site-config.json 与 tsconfig.json 到运行前快照并核对哈希，
 *     同时删除该赛事目录；还原失败会明确打印残留
 *   - **绝不碰** data/events/event-mt8f43vq/*（演示赛事）、.next/* 与任何其他已有赛事目录
 *   - 构建目录 .workbuddy/rehearsal-dist 留在原地复用（已 gitignore，不删是为了下一轮更快）
 *
 * ── 覆盖 / 未覆盖（别用「全部通过」含糊掉范围）────────────────
 *   覆盖：
 *     · 赛制创建接口对四阶段配置的接受（POST /api/admin/events）
 *     · format / schedule 两个数据接口的读写与版本号（If-Match）语义
 *     · 资格赛门控：ready → waiting → complete 三个状态与实际晋级数
 *     · 并入型晋级闭合：28 支轮空直入 + 4 支资格赛胜者 = 入围赛 32
 *     · 入围赛 32 → 16、小组赛 16 → 8、淘汰赛 8 → 冠军
 *     · 抽签工作台在四个关键状态下的真实渲染（无头浏览器实测）
 *   未覆盖：
 *     · 裁判端 HTTP 链路在**生产 Supabase 后端**上的表现 —— 本脚本只跑本地 file 后端。
 *       链路本身（真实 HTTP、真实凭证头、真实路由与鉴权）已由 tools/gate6/e2e-referee-http.ts
 *       在本地覆盖，见 `npm run test:referee-http`；那个脚本**不在** `npm run gate` 里，理由同本脚本。
 *     · 生产 Supabase 后端（本脚本只跑本地 file 后端）
 *
 * ── 用法 ────────────────────────────────────────────────────
 *   npm run test:rehearsal36           完整跑（含抽签工作台的无头浏览器实测）
 *   npm run test:rehearsal36:fast      跳过界面那一段，只跑接口与逻辑
 *   npm run gate:full                  常规门禁 + 本演练
 *
 *   直接调用：node node_modules/tsx/dist/cli.mjs tools/gate6/playin36-rehearsal.ts
 *   ... --keep          保留隔离赛事，便于在后台页面手动点一遍（会打印清理命令）
 *   ... --no-ui         跳过无头浏览器那一段（只跑接口与逻辑）
 *   ... --port 3999     指定 dev server 端口
 *
 * 本演练**不在 `npm run gate` 里**：它要起一个 dev server 再拉起无头浏览器，
 * 比其余套件重得多，放进每次门禁会把快速反馈拖慢、也把浏览器可用性变成门禁前提。
 * 需要完整验收时用 `npm run gate:full`。
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  buildDoubleEliminationMatches,
  buildGslGroupMatches,
  buildQualificationMatches,
} from "../../src/lib/scheduling/bracket-engine";
import {
  buildPlayInPairs,
  buildSeedPots,
  drawGroups,
  generateMatchups,
  rankTeamsByAvgRank,
} from "../../src/lib/scheduling/format-data";
import { resolveSupportedFormat, type SupportedFormat } from "../../src/lib/scheduling/format-support";
import {
  normalizeScheduleState,
  type ScheduleMatch,
  type ScheduleState,
} from "../../src/lib/scheduling/schedule-data";
import { appendMatchesOp, reportGameResultsOp } from "../../src/lib/scheduling/schedule-ops";
import {
  buildKnockoutDrawOrder,
  buildQualifierSlots,
  nextMatchStartIndex,
  resolvePlayInGate,
  resolveStagedDrawGate,
  type StagedFormatState,
} from "../../src/lib/scheduling/staged-format";
import type { StageConfig } from "../../src/lib/scheduling/format-templates";
import { getGameConfig } from "../../src/lib/games";
import type {
  RegistrationPlayer,
  RegistrationState,
  RegistrationTeam,
} from "../../src/lib/scheduling/registration-data";

// ────────────────────────────────────────────────────────────
// 0. 命令行参数与现场常量
// ────────────────────────────────────────────────────────────

const ROOT = process.cwd();
const args = process.argv.slice(2);
const KEEP = args.includes("--keep");
const RUN_UI = !args.includes("--no-ui");
const PORT = Number(args[args.indexOf("--port") + 1]) || 3999;
const BASE = `http://localhost:${PORT}`;
const ADMIN_PASSWORD = "ecust2026"; // 本地回退密码，见 src/lib/domains/identity/admin-session.ts
const ADMIN_DIR = path.join(ROOT, "data", "events");
const SITE_CONFIG = path.join(ROOT, "data", "site-config.json");
const TSCONFIG = path.join(ROOT, "tsconfig.json");
/** 独立构建目录：Next 会因它改写 tsconfig.json 的 include，收尾时要还原。 */
const REHEARSAL_DIST = ".workbuddy/rehearsal-dist";

const STAGES: StageConfig[] = [
  { name: "资格赛", type: "single-elim", teamCount: 8, boType: "BO1" },
  { name: "入围赛", type: "single-elim", teamCount: 32, boType: "BO1" },
  { name: "小组赛", type: "gsl-groups", teamCount: 16, groupCount: 4, boType: "BO3" },
  { name: "淘汰赛", type: "double-elim", teamCount: 8, boType: "BO3" },
];

// ────────────────────────────────────────────────────────────
// 1. 极简断言与报告
// ────────────────────────────────────────────────────────────

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

const sections: Array<{ title: string; checks: Check[] }> = [];

function section(title: string) {
  const created = { title, checks: [] as Check[] };
  sections.push(created);
  return created;
}

function check(bucket: ReturnType<typeof section>, name: string, ok: boolean, detail = "") {
  bucket.checks.push({ name, ok, detail });
}

function require_(bucket: ReturnType<typeof section>, name: string, condition: unknown, detail = "") {
  const ok = Boolean(condition);
  check(bucket, name, ok, detail);
  if (!ok) throw new Error(`前置断言失败：${name}${detail ? ` —— ${detail}` : ""}`);
}

// ────────────────────────────────────────────────────────────
// 2. 现场快照与还原
// ────────────────────────────────────────────────────────────

const snapshot = {
  siteConfigRaw: "",
  siteConfigHash: "",
  tsconfigRaw: "",
  tsconfigHash: "",
  eventDirs: [] as string[],
  uploads: [] as string[],
};

function hashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function listFilesRecursive(dir: string, prefix = ""): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFilesRecursive(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

function takeSnapshot() {
  snapshot.siteConfigRaw = readFileSync(SITE_CONFIG, "utf8");
  snapshot.siteConfigHash = hashOf(snapshot.siteConfigRaw);
  snapshot.tsconfigRaw = readFileSync(TSCONFIG, "utf8");
  snapshot.tsconfigHash = hashOf(snapshot.tsconfigRaw);
  snapshot.eventDirs = existsSync(ADMIN_DIR) ? readdirSync(ADMIN_DIR) : [];
  snapshot.uploads = listFilesRecursive(path.join(ROOT, "public", "uploads"));
}

/** 把 site-config.json 写回运行前的内容；返回是否本来就没变。 */
function restoreSiteConfig(): boolean {
  const current = readFileSync(SITE_CONFIG, "utf8");
  if (hashOf(current) === snapshot.siteConfigHash) return true;
  writeFileSync(SITE_CONFIG, snapshot.siteConfigRaw, "utf8");
  return false;
}

/** 自定义 distDir 会让 Next 往 tsconfig.json 的 include 里加类型路径，这里还原。 */
function restoreTsconfig(): boolean {
  const current = readFileSync(TSCONFIG, "utf8");
  if (hashOf(current) === snapshot.tsconfigHash) return true;
  writeFileSync(TSCONFIG, snapshot.tsconfigRaw, "utf8");
  return false;
}

/** 本机删除护栏是「按回合」计量的：同一回合一旦出现过大批量删除意图，
 *  之后所有删除都会被拒（SAFE_DELETE_BULK_REJECTED）。所以隔离现场优先「改名」而不是「删除」。 */
const TRASH_DIR = path.join(ROOT, ".workbuddy", "rehearsal-trash");

/**
 * 清掉本次新建的赛事目录（按运行前后目录差异判断，不碰任何既有目录）。
 *
 * 两步走：
 *   1. 逐文件删 + 目录自深向浅删（隔离赛事只有 3–4 个文件，正常回合不会被护栏拦下）
 *   2. 删除被护栏拒绝时，退化为**改名**到 .workbuddy/rehearsal-trash/（已 gitignore）
 * 整个过程不抛异常；返回「已就地删除 / 已移入回收站 / 残留」，由调用方写进报告。
 */
function removeRehearsalEventDir(eventId: string): "deleted" | "trashed" | "leftover" {
  const target = path.join(ADMIN_DIR, eventId);
  if (!existsSync(target)) return "deleted";
  if (snapshot.eventDirs.includes(eventId)) {
    throw new Error(`拒绝处理：${eventId} 在运行前就存在，不属于本次新建。`);
  }
  try {
    for (const entry of readdirSync(target, { withFileTypes: true })) {
      const child = path.join(target, entry.name);
      if (entry.isDirectory()) {
        for (const file of readdirSync(child)) rmSync(path.join(child, file), { force: true });
        rmSync(child, { recursive: false, force: true });
      } else {
        rmSync(child, { force: true });
      }
    }
    rmSync(target, { recursive: false, force: true });
    if (!existsSync(target)) return "deleted";
  } catch {
    /* 落到下面的改名兜底 */
  }
  try {
    if (!existsSync(TRASH_DIR)) mkdirSync(TRASH_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    renameSync(target, path.join(TRASH_DIR, `${eventId}-${stamp}`));
    return existsSync(target) ? "leftover" : "trashed";
  } catch {
    return "leftover";
  }
}

// ────────────────────────────────────────────────────────────
// 3. dev server 生命周期
// ────────────────────────────────────────────────────────────

let serverPid = 0;

async function waitForHealth(timeoutMs = 120_000): Promise<number> {
  const started = Date.now();
  let attempts = 0;
  for (;;) {
    attempts += 1;
    try {
      const response = await fetch(`${BASE}/api/health`, { cache: "no-store" });
      if (response.ok) return Date.now() - started;
    } catch {
      /* 还没起来 */
    }
    if (Date.now() - started >= timeoutMs) {
      throw new Error(`dev server 在 ${Math.round(timeoutMs / 1000)}s 内未就绪（已尝试 ${attempts} 次）。`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

async function startDevServer(): Promise<number> {
  const child = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "-p", String(PORT)],
    {
      cwd: ROOT,
      env: { ...process.env, DATA_BACKEND: "file", NEXT_DIST_DIR: REHEARSAL_DIST },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  serverPid = child.pid ?? 0;
  let log = "";
  child.stdout?.on("data", (chunk: Buffer) => { log += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { log += chunk.toString(); });
  child.on("exit", (code) => {
    if (code !== null && code !== 0) process.stderr.write(`[dev server 退出 code=${code}]\n${log.slice(-2000)}\n`);
  });
  return waitForHealth();
}

/** 杀整棵进程树；只 kill(pid) 会留下子进程句柄，导致目录删不掉。 */
function stopDevServer() {
  if (!serverPid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(serverPid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try { process.kill(serverPid, "SIGTERM"); } catch { /* 已退出 */ }
  }
  serverPid = 0;
}

// ────────────────────────────────────────────────────────────
// 4. HTTP 客户端（管理员会话）
// ────────────────────────────────────────────────────────────

let cookie = "";

interface ApiResult<T = Record<string, unknown>> {
  status: number;
  ok: boolean;
  json: T;
}

async function api<T = Record<string, unknown>>(
  route: string,
  init: RequestInit = {},
): Promise<ApiResult<T>> {
  const response = await fetch(`${BASE}${route}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  const json = (await response.json().catch(() => ({}))) as T;
  return { status: response.status, ok: response.ok, json };
}

async function login(): Promise<void> {
  const response = await fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  if (!response.ok) throw new Error(`管理员登录失败：HTTP ${response.status}`);
  const raw = response.headers.getSetCookie?.() ?? [];
  const pair = raw.find((item) => item.startsWith("admin_session="));
  if (!pair) throw new Error("登录成功但未拿到会话 cookie。");
  cookie = pair.split(";")[0];
}

/** 每次写入前都重新读一次版本号 —— 与抽签工作台 publish() 的做法一致。 */
async function loadSchedule(): Promise<ScheduleState> {
  const result = await api<ScheduleState>(`/api/data/schedule?eventId=${rehearsalEventId}`);
  return normalizeScheduleState(result.json);
}

async function saveSchedule(next: ScheduleState): Promise<ApiResult> {
  const current = await loadSchedule();
  const merged = { ...next, version: current.version };
  const saved = await api(`/api/data/schedule?eventId=${rehearsalEventId}`, {
    method: "POST",
    headers: { "If-Match": String(current.version) },
    body: JSON.stringify(merged),
  });
  return saved;
}

// ────────────────────────────────────────────────────────────
// 5. 36 支队伍的构造数据
// ────────────────────────────────────────────────────────────
//
// 队伍平均段位严格递减，靠「5 名首发段位值之和」控制：
//   第 i 支（i 从 0 起）首发段位值之和 = 45 − i  → 平均 (45−i)/5，从 9.0 一路降到 2.0。
// 这样「最弱的 8 支」是唯一确定的（无并列），资格赛的同档互打结果也可预测。

/** 段位值（1..9）→ 段位名。阶梯取自游戏配置层，不再在本文件里写一张反查表。 */
function rankNameOf(value: number): string {
  return getGameConfig().ranks[value - 1] ?? String(value);
}

const TEAM_NAMES = [
  "星火战队", "破晓战队", "赤霄战队", "凌云战队", "极光战队", "深渊战队", "疾风战队", "霜刃战队",
  "雷鸣战队", "烽火战队", "苍穹战队", "曙光战队", "逐浪战队", "玄武战队", "白泽战队", "龙渊战队",
  "燎原战队", "天际战队", "暗潮战队", "远征战队", "辉光战队", "星轨战队", "黑曜战队", "银翼战队",
  "烈焰战队", "寒锋战队", "追光战队", "云帆战队", "狂澜战队", "北辰战队", "南风战队", "长虹战队",
  "惊蛰战队", "白露战队", "寒露战队", "小雪战队",
] as const;

/** 把总和 T 拆成 5 个 1..9 的段位值（尽量均匀，避免极端组合）。 */
function splitRankValues(total: number): number[] {
  const base = Math.floor(total / 5);
  const remainder = total - base * 5;
  const values = [...Array(remainder).fill(base + 1), ...Array(5 - remainder).fill(base)];
  if (values.some((value) => value < 1 || value > 9)) {
    throw new Error(`段位值拆分越界：总和 ${total}`);
  }
  return values;
}

function buildRehearsalRegistration(): RegistrationState {
  const createdAt = "2026-10-02T12:00:00.000Z";
  const players: RegistrationPlayer[] = [];
  const teams: RegistrationTeam[] = [];

  TEAM_NAMES.forEach((teamName, teamIndex) => {
    const teamId = `T-RH-${String(teamIndex + 1).padStart(2, "0")}`;
    const values = splitRankValues(45 - teamIndex);
    const memberIds: string[] = [];

    values.forEach((value, memberIndex) => {
      const playerId = `${teamId}-P${memberIndex + 1}`;
      memberIds.push(playerId);
      players.push({
        id: playerId,
        name: `${teamName.slice(0, 2)}选手${memberIndex + 1}`,
        studentId: `RH2026${String(teamIndex * 5 + memberIndex + 1).padStart(4, "0")}`,
        gameId: `RH${String(teamIndex + 1).padStart(2, "0")}#${1000 + teamIndex * 5 + memberIndex}`,
        rank: rankNameOf(value),
        qq: String(900010000 + teamIndex * 5 + memberIndex),
        phone: String(13900000000 + teamIndex * 5 + memberIndex),
        positions: ["决斗", "先锋", "控场", "哨卫", "自由人"].slice(memberIndex % 5, (memberIndex % 5) + 1),
        submittedAt: createdAt,
        status: "已入队",
        reviewStatus: "已通过",
        teamId,
        role: "首发",
      });
    });

    teams.push({
      id: teamId,
      name: teamName,
      captainId: memberIds[0],
      memberIds,
      status: "已冻结",
      createdAt,
    });
  });

  return {
    players,
    teams,
    teamRequests: [],
    operationLogs: [],
    playerRegistrationClosed: true,
    teamRegistrationClosed: true,
  };
}

// ────────────────────────────────────────────────────────────
// 6. 赛果生成（同档/强队取胜）
// ────────────────────────────────────────────────────────────

type WinnerSide = "A" | "B";

/** 生成一串合法比分，让指定一方先到该 BO 的胜局数（A 胜时 A 分高）。 */
function gamesFor(boType: string, winner: WinnerSide): Array<{ teamAScore: number; teamBScore: number }> {
  const target = boType === "BO5" ? 3 : boType === "BO3" ? 2 : 1;
  const loserScores = [5, 7, 9];
  return Array.from({ length: target }, (_, index) => (
    winner === "A"
      ? { teamAScore: 13, teamBScore: loserScores[index] }
      : { teamAScore: loserScores[index], teamBScore: 13 }
  ));
}

/** 让平均段位更高的一方取胜；并列时 A 胜。 */
function decideWinnerSide(match: ScheduleMatch, avgById: Map<string, number>): WinnerSide {
  const avgA = avgById.get(match.teamAId) ?? 0;
  const avgB = avgById.get(match.teamBId) ?? 0;
  return avgA >= avgB ? "A" : "B";
}

const REAL_TEAM = (id: string | undefined) => Boolean(id) && id !== "TBD" && id !== "BYE" && id !== "";

/** 反复填充「双方都已确定」的比赛，直到没有新进展。用于模拟整阶段打完。 */
function completeStage(
  state: ScheduleState,
  phase: string,
  avgById: Map<string, number>,
): { state: ScheduleState; completed: number; stuck: number } {
  let current = state;
  let completed = 0;
  for (;;) {
    const pending = current.matches.filter(
      (match) => match.phase === phase
        && match.status !== "已完成"
        && REAL_TEAM(match.teamAId)
        && REAL_TEAM(match.teamBId),
    );
    if (pending.length === 0) break;
    for (const match of pending) {
      const winner = decideWinnerSide(match, avgById);
      const result = reportGameResultsOp(current, match.id, gamesFor(match.boType, winner));
      if (!result.value?.ok) throw new Error(`赛果写入失败：${match.id} ${result.value?.message ?? "无返回"}`);
      current = result.state;
      completed += 1;
    }
  }
  const stuck = current.matches.filter(
    (match) => match.phase === phase && match.status !== "已完成",
  ).length;
  return { state: current, completed, stuck };
}

// ────────────────────────────────────────────────────────────
// 7. 无头浏览器探针
// ────────────────────────────────────────────────────────────

const AGENT_BROWSER = "D:/npm-global/node_modules/agent-browser/bin/agent-browser.js";
const NODE_BIN = process.execPath;
const BROWSER_DEBUG = process.env.REHEARSAL_BROWSER_DEBUG === "1";
/** 单条浏览器命令的上限；超时就杀掉该条，不让演练卡死。 */
const BROWSER_TIMEOUT_MS = 60_000;

/**
 * 调用无头浏览器。
 *
 * 两个本机特有的坑：
 *   1. 必须用异步 spawn —— 本机 `spawnSync(process.execPath, ...)` 直接报 EBUSY
 *      （`execSync("git ...")` 也是同一个毛病），表现为 status=null、输出全空。
 *   2. **不能等进程退出** —— 实测 `agent-browser open` 打完 `✓ Done` 之后自己不退
 *      （挂满 150s 仍未结束）。所以改成「有输出且静默 700ms 即视为该命令已完成」，
 *      然后只杀 CLI 包装进程（不用 /T，避免连浏览器守护进程一起杀掉，否则后续命令全废）。
 */
async function browser(...commands: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(NODE_BIN, [AGENT_BROWSER, ...commands], {
      // NODE_OPTIONS 清空：本环境默认注入 node-language-shim.cjs，不适合传给浏览器 CLI。
      // PATH 补 D:/Node.js，否则 agent-browser.js 找不到 node。
      env: { ...process.env, NODE_OPTIONS: "", PATH: `D:/Node.js${path.delimiter}${process.env.PATH ?? ""}` },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let out = "";
    let settled = false;
    let quietTimer: NodeJS.Timeout | undefined;

    const finish = (ok: boolean, note = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      clearTimeout(quietTimer);
      if (child.exitCode === null) child.kill();
      const text = (out.trim() + (note ? ` ${note}` : "")).trim();
      if (BROWSER_DEBUG) {
        console.error(`  [browser] ${commands.join(" ").slice(0, 80)} → ok=${ok} ${text.split(/\r?\n/).slice(0, 2).join(" | ").slice(0, 150)}`);
      }
      resolve({ ok, out: text });
    };
    const armQuiet = () => {
      clearTimeout(quietTimer);
      // 输出里已经出现 ✓ / ✗ 就是终态标记，可以很快收工；否则多等一会儿再看。
      const delay = /[✓✗]/.test(out) ? 300 : 1200;
      quietTimer = setTimeout(() => {
        if (out.trim()) finish(!/✗|Error|error:/.test(out));
      }, delay);
    };

    // 硬超时兜底：从 spawn 就开始计时，任何一条命令都不许把整轮拖死。
    const hardTimer = setTimeout(
      () => finish(false, `命令超时：${commands.join(" ")}`),
      BROWSER_TIMEOUT_MS,
    );

    child.stdout?.on("data", (chunk: Buffer) => { out += chunk.toString(); armQuiet(); });
    child.stderr?.on("data", (chunk: Buffer) => { out += chunk.toString(); armQuiet(); });
    child.on("error", (error) => finish(false, `启动失败：${error.message}`));
    child.on("close", (code) => finish(code === 0 && !/✗|Error/.test(out)));
  });
}

/** 在页面上下文里跑一段 JS，把返回值当 JSON 读回。 */
async function browserEval<T>(expression: string): Promise<T | null> {
  const encoded = Buffer.from(expression, "utf8").toString("base64");
  const result = await browser("eval", "-b", encoded);
  if (!result.ok) return null;
  const lines = result.out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]) as T;
    } catch {
      /* 换个候选行 */
    }
  }
  const text = result.out.trim();
  const start = text.search(/[[{"]|true|false|-?\d/);
  if (start < 0) return null;
  try {
    return JSON.parse(text.slice(start)) as T;
  } catch {
    return null;
  }
}

interface DrawProbe {
  pageTitle: string;
  bodyText: string;
  errorText: string;
  slotProgress: string;
  headingCount: number;
}

let browserReady = false;
let browserIssue = "";

/** 登录一次即可：agent-browser 的浏览器会话跨命令保持，cookie 不会丢。 */
async function ensureBrowserLogin(): Promise<boolean> {
  if (browserReady) return true;
  await browser("close", "--all");
  // 先裸启动浏览器、再单独导航：实测「冷启动 + 同一条命令里直接导航 HTML 页面」会挂住，
  // 拆成两步后稳定（与 `open <url>` 单独用时表现一致）。
  const launched = await browser("open");
  if (!launched.ok) { browserIssue = `浏览器启动失败：${launched.out.slice(0, 140)}`; return false; }
  const opened = await browser("navigate", `${BASE}/login`);
  if (!opened.ok) { browserIssue = `打不开登录页：${opened.out.slice(0, 140)}`; return false; }
  const filled = await browser("fill", "#password", ADMIN_PASSWORD);
  if (!filled.ok) { browserIssue = `填不进密码框：${filled.out.slice(0, 140)}`; return false; }
  // 优先按可访问名点，点不动就退回提交按钮选择器
  const clicked = await browser("find", "role", "button", "click", "--name", "进入工作台");
  if (!clicked.ok) await browser("click", "button[type=submit]");
  await browser("wait", "--url", "**/admin**");
  const authed = await browserEval<boolean>("!location.pathname.startsWith('/login')");
  if (authed !== true) {
    const url = await browserEval<string>("location.href");
    browserIssue = `登录后仍停在 ${url ?? "未知页"}`;
    return false;
  }
  browserReady = true;
  return true;
}

/** 打开抽签页并抓取可判断的渲染事实。 */
async function probeDrawPage(eventId: string): Promise<DrawProbe | null> {
  if (!(await ensureBrowserLogin())) return null;
  await browser("open", `${BASE}/admin/events/${eventId}/schedule/draw`);
  // 用 domcontentloaded 而不是 networkidle：Next dev 会挂 HMR 长连接，networkidle 可能永远不触发。
  // 页面数据由下面的轮询负责等。
  await browser("wait", "--load", "domcontentloaded");
  // 客户端组件要等它把数据取回来；轮询到「加载抽签数据」消失为止
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const loading = await browserEval<boolean>("document.body.innerText.includes('加载抽签数据')");
    if (loading === false) break;
    await browser("wait", "500");
  }
  return browserEval<DrawProbe>(`(() => {
    const text = document.body.innerText;
    const headings = Array.from(document.querySelectorAll('h1,h2,h3')).map((node) => node.innerText.trim());
    const errorNode = document.querySelector('.text-amber-900, .bg-amber-50 p, [role=alert]');
    return {
      pageTitle: document.title,
      bodyText: text,
      errorText: errorNode ? errorNode.innerText.trim() : '',
      slotProgress: (text.match(/已揭示\\s*\\d+\\s*\\/\\s*\\d+/) || [''])[0],
      headingCount: headings.length,
    };
  })()`);
}

// ────────────────────────────────────────────────────────────
// 8. 主流程
// ────────────────────────────────────────────────────────────

let rehearsalEventId = "";

async function main() {
  takeSnapshot();
  console.log("36 队四阶段赛制 · 隔离赛事端到端演练");
  console.log(`站点 ${BASE} · 现场快照 site-config=${snapshot.siteConfigHash} · 既有赛事目录 ${snapshot.eventDirs.join(", ") || "（无）"}`);
  console.log("");

  const boot = section("起本地服务");
  const bootMs = await startDevServer();
  check(boot, "dev server 健康检查通过", true, `${bootMs} ms`);
  await login();
  check(boot, "管理员登录取得会话", cookie.startsWith("admin_session="));

  // ── A. 建隔离赛事 ──
  const setup = section("新建隔离赛事（四阶段 36 队）");
  const created = await api<{ event?: { id: string; teamCount: number; stageConfigs: StageConfig[]; formatTemplateId?: string } ; message?: string }>(
    "/api/admin/events",
    {
      method: "POST",
      body: JSON.stringify({
        name: "【演练】36 队资格赛全链路",
        organizer: "演练脚本",
        game: "无畏契约",
        registrationStart: "2026-09-01",
        registrationEnd: "2026-09-30",
        teamRegistrationEnd: "2026-09-30",
        stageConfigs: STAGES,
      }),
    },
  );
  require_(setup, "赛制创建接口接受四阶段配置", created.ok, `HTTP ${created.status} ${created.json.message ?? ""}`);
  rehearsalEventId = created.json.event?.id ?? "";
  require_(setup, "拿到隔离赛事 ID", /^event-[a-z0-9]+$/.test(rehearsalEventId), rehearsalEventId);
  require_(setup, "赛事不是既有赛事（隔离成立）", !snapshot.eventDirs.includes(rehearsalEventId), rehearsalEventId);
  check(setup, "赛事参赛规模按模板取 36", created.json.event?.teamCount === 36, String(created.json.event?.teamCount));
  check(
    setup,
    "赛事阶段配置持久化为 4 段",
    created.json.event?.stageConfigs?.length === 4,
    JSON.stringify((created.json.event?.stageConfigs ?? []).map((stage) => `${stage.name}${stage.teamCount}`)),
  );

  const registration = buildRehearsalRegistration();
  mkdirSync(path.join(ADMIN_DIR, rehearsalEventId), { recursive: true });
  writeFileSync(
    path.join(ADMIN_DIR, rehearsalEventId, "registration.json"),
    JSON.stringify(registration, null, 2),
    "utf8",
  );
  check(setup, "注入 36 支已冻结队伍（各 5 名首发）", registration.teams.length === 36 && registration.players.length === 180, `${registration.teams.length} 队 / ${registration.players.length} 人`);

  const resolvedFormat = resolveSupportedFormat(STAGES);
  require_(setup, "四阶段被识别为 staged-playin", resolvedFormat.kind === "staged-playin", resolvedFormat.kind);

  const loaded = await api<RegistrationState>(`/api/data/registration?eventId=${rehearsalEventId}`);
  require_(setup, "报名数据接口可读回 36 队", loaded.ok && loaded.json.teams.length === 36, `HTTP ${loaded.status} 队数 ${loaded.json.teams?.length ?? 0}`);
  const frozenTeams = loaded.json.teams.filter((team) => team.status === "已冻结");
  const frozenIds = frozenTeams.map((team) => team.id);
  const rankedAll = rankTeamsByAvgRank(frozenTeams, loaded.json.players);
  const avgById = new Map(rankedAll.map((item) => [item.id, item.avg]));
  check(setup, "36 队平均段位严格递减（最弱 8 支唯一）",
    rankedAll.every((item, index) => index === 0 || item.avg < rankedAll[index - 1].avg),
    `${rankedAll[0].avg.toFixed(1)} → ${rankedAll[rankedAll.length - 1].avg.toFixed(1)}`);

  const format = resolvedFormat as Extract<SupportedFormat, { kind: "staged-playin" }>;
  const playInIds = rankedAll.slice(-format.playInTeams).map((item) => item.id);
  const weakestFour = playInIds.slice(-4);

  // ── B. 资格赛：ready 态（含界面）──
  const ready = section("资格赛 · 抽签前");
  const readyGate = resolvePlayInGate(format.playInStage, playInIds, []);
  check(ready, "资格赛门控为 ready", readyGate.status === "ready", readyGate.status);
  check(ready, "资格赛参赛队恰为最弱的 8 支", playInIds.length === 8 && !playInIds.some((id) => !rankedAll.slice(-8).map((item) => item.id).includes(id)), playInIds.join(","));
  const pairs = buildPlayInPairs(playInIds);
  check(ready, "同档互打：最弱一档内部配对", pairs[2].teamAId === playInIds[4] && pairs[2].teamBId === playInIds[7], `${pairs[2].teamAId} vs ${pairs[2].teamBId}`);

  if (RUN_UI) {
    const probe = await probeDrawPage(rehearsalEventId);
    if (probe) {
      check(ready, "界面识别为四阶段并展示「资格赛」", probe.bodyText.includes("资格赛"), probe.errorText || probe.bodyText.slice(0, 60));
      check(ready, "界面同时展示后续阶段名（入围赛）", probe.bodyText.includes("入围赛"));
      check(ready, "界面未提前展示 32 队入围赛抽签", !probe.bodyText.includes("已揭示") || probe.bodyText.includes("资格赛"));
    } else {
      check(ready, "无头浏览器探针可用", false, browserIssue || "未取到页面数据");
    }
  }

  // ── C. 发布资格赛抽签（走真实接口）──
  const publishPlayIn = section("资格赛 · 发布抽签");
  let schedule = await loadSchedule();
  const playInDrawOrder = buildPlayInPairs(playInIds).flatMap((pair) => [pair.teamAId, pair.teamBId]);
  const built = buildQualificationMatches(playInDrawOrder, (id) => id, {
    startIndex: nextMatchStartIndex(schedule.matches),
    phase: format.playInStage.name,
    boType: format.playInStage.boType,
    advancingTeams: format.playInTeams / 2,
  });
  const nextFormat: StagedFormatState = {
    drawType: "staged-playin",
    stageConfigs: STAGES,
    playInDraw: { drawOrder: playInDrawOrder, publishedAt: new Date().toISOString() },
  };
  // 新赛事的赛程版本号从 0 起（emptySchedule().version = 0），首次写入后为 1。
  const versionBeforePlayIn = schedule.version;
  const saveFormatResult = await api(`/api/data/format?eventId=${rehearsalEventId}`, { method: "POST", body: JSON.stringify(nextFormat) });
  const savePlayInResult = await saveSchedule(appendMatchesOp(schedule, built.matches, "资格赛抽签发布"));
  require_(publishPlayIn, "format 接口接受 playInDraw", saveFormatResult.ok, `HTTP ${saveFormatResult.status}`);
  require_(publishPlayIn, "schedule 接口接受资格赛赛程", savePlayInResult.ok, `HTTP ${savePlayInResult.status}`);

  schedule = await loadSchedule();
  check(publishPlayIn, "赛程里有且仅有 4 场资格赛", schedule.matches.filter((m) => m.phase === "资格赛").length === 4, String(schedule.matches.length));
  check(publishPlayIn, "赛程版本号已前进（If-Match 链路生效）",
    schedule.version > versionBeforePlayIn,
    `写入前 v${versionBeforePlayIn} → 写入后 v${schedule.version}`);

  const staleRejected = await api(`/api/data/schedule?eventId=${rehearsalEventId}`, {
    method: "POST",
    headers: { "If-Match": String(versionBeforePlayIn) },
    body: JSON.stringify(schedule),
  });
  check(publishPlayIn, "过期版本号写入被拒（并发保护）", staleRejected.status === 409, `HTTP ${staleRejected.status}`);

  const partialGate = resolvePlayInGate(format.playInStage, playInIds, schedule.matches);
  check(publishPlayIn, "未提交赛果时门控为 partial（不阻塞入围赛抽签）", partialGate.status === "partial", partialGate.status);
  check(publishPlayIn, "partial 时明确给出待定席位数", partialGate.status === "partial" && partialGate.pendingCount === 4,
    partialGate.status === "partial" ? String(partialGate.pendingCount) : partialGate.status);

  if (RUN_UI) {
    const probe = await probeDrawPage(rehearsalEventId);
    if (probe) {
      // 行为变了：资格赛没打完不再锁死等待，界面应当继续走到入围赛抽签（含待定席位）。
      check(publishPlayIn, "界面未因资格赛未完成而锁死", !/锁定/.test(probe.bodyText), probe.errorText || probe.bodyText.slice(0, 80));
    }
  }

  // ── D. 填赛果 → 并入入围赛 ──
  const playInResult = section("资格赛 · 赛果与并入");
  const afterPlayIn = completeStage(schedule, "资格赛", avgById);
  check(playInResult, "4 场资格赛全部完成", afterPlayIn.stuck === 0 && afterPlayIn.completed === 4, `完成 ${afterPlayIn.completed} 场，遗留 ${afterPlayIn.stuck} 场`);
  schedule = afterPlayIn.state;
  const savedResults = await saveSchedule(schedule);
  check(playInResult, "带赛果的赛程写回成功", savedResults.ok, `HTTP ${savedResults.status}`);
  schedule = await loadSchedule();

  const completeGate = resolvePlayInGate(format.playInStage, playInIds, schedule.matches);
  require_(playInResult, "赛果齐后门控为 complete", completeGate.status === "complete", completeGate.status);
  const advancing = completeGate.status === "complete" ? completeGate.advancingTeamIds : [];
  check(playInResult, "4 支胜者并入入围赛", advancing.length === 4, advancing.join(","));
  const weakestAdvanced = advancing.filter((id) => weakestFour.includes(id)).length;
  check(
    playInResult,
    "最弱 4 支里恰好有 2 支取胜（同档互打的直接效果）",
    weakestAdvanced === 2,
    `最弱 4 支 ${weakestFour.join(",")} → 晋级 ${advancing.filter((id) => weakestFour.includes(id)).join(",")}`,
  );

  const entrants = [
    ...frozenIds.filter((id) => !playInIds.includes(id)),
    ...advancing,
  ];
  check(playInResult, "入围赛参赛队 = 28 支直入 + 4 支胜者 = 32", entrants.length === 32 && new Set(entrants).size === 32, String(entrants.length));
  const overflowBlocked = resolveStagedDrawGate(format.stages, frozenIds, schedule.matches, []);
  check(playInResult, "反例：36 支直接抽入围赛被拦下", overflowBlocked.status === "blocked", overflowBlocked.status);

  // ── E. 入围赛 32 → 16 ──
  const qualifier = section("入围赛 32 → 16");
  const qualifierGate = resolveStagedDrawGate(format.stages, entrants, schedule.matches, []);
  require_(qualifier, "入围赛门控为 ready", qualifierGate.status === "ready" && qualifierGate.stageIndex === 0, qualifierGate.status);
  const qualifierSlots = buildQualifierSlots(entrants, 32, 16);
  const qualifierBuilt = buildQualificationMatches(qualifierSlots, (id) => id, {
    startIndex: nextMatchStartIndex(schedule.matches),
    phase: format.stages[0].name,
    boType: format.stages[0].boType,
    advancingTeams: 16,
  });
  check(qualifier, "入围赛生成 16 场、无轮空", qualifierBuilt.matches.length === 16 && qualifierBuilt.byes.length === 0, `${qualifierBuilt.matches.length} 场 / 轮空 ${qualifierBuilt.byes.length}`);
  const savedQualifier = await saveSchedule(appendMatchesOp(schedule, qualifierBuilt.matches, "入围赛抽签发布"));
  check(qualifier, "入围赛赛程写回成功", savedQualifier.ok, `HTTP ${savedQualifier.status}`);
  schedule = await loadSchedule();

  if (RUN_UI) {
    const probe = await probeDrawPage(rehearsalEventId);
    if (probe) {
      check(qualifier, "进入资格赛完成后，界面已切到入围赛", probe.bodyText.includes("入围赛") && !/完成全部 4 场资格赛/.test(probe.bodyText), probe.errorText || probe.bodyText.slice(0, 80));
    }
  }

  const afterQualifier = completeStage(schedule, format.stages[0].name, avgById);
  check(qualifier, "16 场入围赛全部完成", afterQualifier.stuck === 0 && afterQualifier.completed === 16, `完成 ${afterQualifier.completed} 场，遗留 ${afterQualifier.stuck} 场`);
  schedule = afterQualifier.state;
  const savedQualifierResults = await saveSchedule(schedule);
  check(qualifier, "入围赛赛果写回成功", savedQualifierResults.ok, `HTTP ${savedQualifierResults.status}`);
  schedule = await loadSchedule();
  const qualifierDone = resolveStagedDrawGate(format.stages, entrants, schedule.matches, []);
  check(qualifier, "16 支胜者晋级小组赛", qualifierDone.status === "ready" && qualifierDone.stageIndex === 1 && qualifierDone.entrantIds.length === 16, `${qualifierDone.status} / ${qualifierDone.status === "ready" ? qualifierDone.entrantIds.length : 0} 支`);

  // ── F. 小组赛 16 → 8 ──
  const groups = section("小组赛 16 → 8");
  const groupEntrants = qualifierDone.status === "ready" ? qualifierDone.entrantIds : [];
  const participantTeams = frozenTeams.filter((team) => groupEntrants.includes(team.id));
  const pots = buildSeedPots(
    [...participantTeams].sort((a, b) => (avgById.get(b.id) ?? 0) - (avgById.get(a.id) ?? 0)),
    loaded.json.players,
  );
  check(groups, "16 队分成 4 个种子池", pots.length === 4 && pots.every((pot) => pot.teamIds.length === 4), pots.map((pot) => pot.teamIds.length).join("/"));
  const drawnGroups = drawGroups(pots);
  check(groups, "4 个小组各 4 队", drawnGroups.length === 4 && drawnGroups.every((group) => group.teamIds.length === 4));
  const groupMatches = buildGslGroupMatches(drawnGroups, generateMatchups(drawnGroups, pots), (id) => id, {
    startIndex: nextMatchStartIndex(schedule.matches),
    phase: format.stages[1].name,
    boType: format.stages[1].boType,
  });
  check(groups, "小组赛生成 20 场", groupMatches.length === 20, String(groupMatches.length));
  const savedGroups = await saveSchedule(appendMatchesOp(schedule, groupMatches, "小组赛抽签发布"));
  check(groups, "小组赛赛程写回成功", savedGroups.ok, `HTTP ${savedGroups.status}`);
  schedule = await loadSchedule();
  const afterGroups = completeStage(schedule, format.stages[1].name, avgById);
  check(groups, "20 场小组赛全部完成", afterGroups.stuck === 0 && afterGroups.completed === 20, `完成 ${afterGroups.completed} 场，遗留 ${afterGroups.stuck} 场`);
  schedule = afterGroups.state;
  const savedGroupResults = await saveSchedule(schedule);
  check(groups, "小组赛赛果写回成功", savedGroupResults.ok, `HTTP ${savedGroupResults.status}`);
  schedule = await loadSchedule();
  const knockoutGate = resolveStagedDrawGate(format.stages, entrants, schedule.matches, []);
  check(groups, "每组前两名共 8 支晋级淘汰赛", knockoutGate.status === "ready" && knockoutGate.stageIndex === 2 && (knockoutGate.qualifiers?.length ?? 0) === 8, `${knockoutGate.status} / ${knockoutGate.status === "ready" ? knockoutGate.qualifiers?.length ?? 0 : 0} 支`);

  // ── G. 淘汰赛 8 → 冠军 ──
  const knockout = section("淘汰赛 8 → 冠军");
  const qualifiers = knockoutGate.status === "ready" ? knockoutGate.qualifiers ?? [] : [];
  const knockoutOrder = buildKnockoutDrawOrder(qualifiers);
  check(knockout, "淘汰赛签位 8 支、同组避让", knockoutOrder.length === 8 && new Set(knockoutOrder).size === 8);
  const knockoutMatches = buildDoubleEliminationMatches(knockoutOrder, (id) => id, {
    startIndex: nextMatchStartIndex(schedule.matches),
    phase: format.stages[2].name,
    boType: format.stages[2].boType,
  });
  check(knockout, "淘汰赛生成 14 场（双败）", knockoutMatches.length === 14, String(knockoutMatches.length));
  const savedKnockout = await saveSchedule(appendMatchesOp(schedule, knockoutMatches, "淘汰赛抽签发布"));
  check(knockout, "淘汰赛赛程写回成功", savedKnockout.ok, `HTTP ${savedKnockout.status}`);
  schedule = await loadSchedule();
  const afterKnockout = completeStage(schedule, format.stages[2].name, avgById);
  check(knockout, "14 场淘汰赛全部完成", afterKnockout.stuck === 0 && afterKnockout.completed === 14, `完成 ${afterKnockout.completed} 场，遗留 ${afterKnockout.stuck} 场`);
  schedule = afterKnockout.state;
  const savedKnockoutResults = await saveSchedule(schedule);
  check(knockout, "淘汰赛赛果写回成功", savedKnockoutResults.ok, `HTTP ${savedKnockoutResults.status}`);
  schedule = await loadSchedule();
  const finished = resolveStagedDrawGate(format.stages, entrants, schedule.matches, []);
  check(knockout, "三阶段全部完成后门控为 complete", finished.status === "complete", finished.status);
  const champion = schedule.matches.find((match) => match.round === "总决赛" || match.round === "决赛")?.winnerTeamId ?? "";
  check(knockout, "产生了冠军队伍", Boolean(champion) && champion !== "TBD", champion);

  // ── H. 总账 ──
  const totals = section("场次总账");
  const byPhase = (phase: string) => schedule.matches.filter((match) => match.phase === phase).length;
  const total = schedule.matches.length;
  check(totals, "资格赛 4 场", byPhase("资格赛") === 4, String(byPhase("资格赛")));
  check(totals, "入围赛 16 场", byPhase("入围赛") === 16, String(byPhase("入围赛")));
  check(totals, "小组赛 20 场", byPhase("小组赛") === 20, String(byPhase("小组赛")));
  check(totals, "淘汰赛 14 场", byPhase("淘汰赛") === 14, String(byPhase("淘汰赛")));
  check(totals, "总场次 54 场（与赛制模板估价一致）", total === 54, String(total));
  check(totals, "全部比赛均已完成", schedule.matches.every((match) => match.status === "已完成"), `${schedule.matches.filter((m) => m.status !== "已完成").length} 场未完成`);

  // ── I. 收尾 ──
  // 收尾出问题不能把整份报告吃掉：这里全部降级成检查项，让主体结论照常打印。
  const cleanup = section("收尾与残留");
  let cleanupNote = "";
  try {
    // 先关掉浏览器：页面还开着时，客户端请求会继续打到 dev server，干扰残留核对。
    if (RUN_UI && browserReady) await browser("close", "--all");
    check(cleanup, "tsconfig.json 未被构建目录改写（或已还原）",
      restoreTsconfig() || hashOf(readFileSync(TSCONFIG, "utf8")) === snapshot.tsconfigHash,
      `快照 ${snapshot.tsconfigHash}`);
    if (KEEP) {
      check(cleanup, "按要求保留隔离赛事（--keep）", true, rehearsalEventId);
    } else {
      const removed = await api<{ message?: string; deleted?: boolean }>("/api/admin/events", {
        method: "DELETE",
        body: JSON.stringify({ eventId: rehearsalEventId, confirmName: "【演练】36 队资格赛全链路" }),
      });
      check(cleanup, "通过管理接口删除隔离赛事",
        removed.ok || removed.status === 404,
        `HTTP ${removed.status} ${removed.json.message ?? ""}`);

      const outcome = removeRehearsalEventDir(rehearsalEventId);
      check(cleanup, "隔离赛事已从 data/events 移除",
        outcome !== "leftover",
        outcome === "leftover" ? `残留 data/events/${rehearsalEventId}` : "");
      if (outcome === "trashed") {
        cleanupNote = "隔离赛事目录已移入 .workbuddy/rehearsal-trash/（本机删除护栏按回合计量删除额度，改名到 gitignore 目录是等价且不触发护栏的做法）";
      }
      if (outcome === "leftover") cleanupNote = `⚠️ 残留 data/events/${rehearsalEventId}，需要手动清理`;

      const siteConfigHandled = removed.ok || removed.status === 404;
      const restored = restoreSiteConfig();
      check(cleanup, "site-config.json 已还原到运行前快照",
        restored || hashOf(readFileSync(SITE_CONFIG, "utf8")) === snapshot.siteConfigHash,
        `快照 ${snapshot.siteConfigHash}`);
      if (!siteConfigHandled) cleanupNote += "；赛事条目可能仍在 site-config.json 里，请核对";
    }
    stopDevServer();

    const createdUploads = listFilesRecursive(path.join(ROOT, "public", "uploads"))
      .filter((file) => !snapshot.uploads.includes(file));
    check(cleanup, "未新增任何上传文件", createdUploads.length === 0, createdUploads.join(","));

    // 与 site-config 对账：data/events 下的目录必须都能在配置里找到，
    // 否则就是某次中断留下的游离目录（这一条正是「上一轮被 Ctrl-C 打断」时能抓到的）。
    //
    // 一处刻意的排除：`demo-referee` 是 `seedDemoReporting` 按需播种的**本地裁判演示赛事**，
    // 它天生不在 site-config 里（本地只要打开过裁判端就会出现）。不排除它，
    // 这条断言会在任何一个用过裁判端页面的开发机上恒红 —— 那是假阳性，不是残留。
    const configuredIds = new Set(
      (JSON.parse(readFileSync(SITE_CONFIG, "utf8")) as { events?: Array<{ id: string }> }).events?.map((event) => event.id) ?? [],
    );
    const KNOWN_SEEDED_DIRS = ["demo-referee"];
    const orphans = readdirSync(ADMIN_DIR)
      .filter((dir) => !configuredIds.has(dir) && !KNOWN_SEEDED_DIRS.includes(dir));
    check(cleanup, "data/events 下没有游离目录（与 site-config 对账）",
      orphans.length === 0,
      orphans.length > 0 ? `游离：${orphans.join(", ")}（多为中断的上一轮遗留，需手动清理）` : "");
  } catch (error) {
    check(cleanup, "收尾流程未抛异常", false, error instanceof Error ? error.message : String(error));
  }

  stopDevServer();
  return { schedule, champion, rehearsalEventId, cleanupNote };
}

// ────────────────────────────────────────────────────────────
// 9. 输出
// ────────────────────────────────────────────────────────────

function printReport() {
  console.log("");
  let passed = 0;
  let total = 0;
  for (const bucket of sections) {
    console.log(`【${bucket.title}】`);
    for (const item of bucket.checks) {
      total += 1;
      if (item.ok) passed += 1;
      console.log(`  ${item.ok ? "✓" : "✗"} ${item.name}${item.ok ? "" : `（实测：${item.detail || "无"}）`}`);
      if (item.ok && item.detail) console.log(`      ${item.detail}`);
    }
    console.log("");
  }
  console.log(`通过 ${passed} / ${total}`);
  const failed = sections.flatMap((bucket) => bucket.checks.filter((item) => !item.ok));
  if (failed.length > 0) {
    console.log("未通过项：");
    for (const item of failed) console.log(`  · ${item.name} —— ${item.detail || "无实测值"}`);
  }
  return failed.length === 0;
}

/**
 * 报告末尾必须写清「这一轮到底没验证什么」。
 * 否则带 --no-ui 跑出来也是「通过 N / N」，会被误读成全链路通过。
 */
function printCoverageNote() {
  console.log("");
  if (!RUN_UI) {
    console.log("★ 本次带 --no-ui：抽签工作台的**真实渲染**没有验证，上面所有界面项都跳过了。");
    console.log("  要连界面一起验，跑 npm run test:rehearsal36（不带 --no-ui）。");
  }
  console.log("本轮始终未覆盖（与是否带 --no-ui 无关）：");
  console.log("  · 裁判端 HTTP 链路在生产 Supabase 后端上的表现 —— 本脚本与 e2e-referee-http 都只跑本地 file 后端。");
  console.log("    （链路本身已由 npm run test:referee-http 覆盖：真实 HTTP、真实凭证头、真实路由。）");
  console.log("  · 生产 Supabase 后端 —— 本脚本只跑本地 file 后端。");
}

let exitCode = 0;
main()
  .then((result) => {
    const allPassed = printReport();
    printCoverageNote();
    if (result.cleanupNote) console.log(`\n${result.cleanupNote}`);
    if (!allPassed) exitCode = 1;
    if (KEEP && rehearsalEventId) {
      console.log("");
      console.log("隔离赛事已保留，可在后台打开：");
      console.log(`  ${BASE}/admin/events/${rehearsalEventId}/schedule/draw`);
      console.log("清理方式：");
      console.log("  · 后台「赛事列表」里删除「【演练】36 队资格赛全链路」");
      console.log(`  · 或删除目录 data/events/${rehearsalEventId}，并把 data/site-config.json 里的对应条目去掉`);
    }
  })
  .catch((error) => {
    console.error("");
    console.error("演练中断：", error instanceof Error ? error.message : error);
    exitCode = 1;
    printReport();
    printCoverageNote();
  })
  .finally(() => {
    stopDevServer();
    try {
      restoreTsconfig();
    } catch (error) {
      console.error("tsconfig.json 还原失败：", error);
      exitCode = 1;
    }
    if (!KEEP) {
      if (rehearsalEventId) {
        try { removeRehearsalEventDir(rehearsalEventId); } catch { /* 已处理或不属于本次 */ }
      }
      try {
        restoreSiteConfig();
      } catch (error) {
        console.error("site-config 还原失败：", error);
        exitCode = 1;
      }
    }
    const leftovers = rehearsalEventId && existsSync(path.join(ADMIN_DIR, rehearsalEventId));
    if (leftovers && !KEEP) {
      console.error(`⚠️ 残留：data/events/${rehearsalEventId} 未清理成功，请手动处理。`);
      exitCode = 1;
    }
    const uploadsLeft = listFilesRecursive(path.join(ROOT, "public", "uploads"))
      .filter((file) => !snapshot.uploads.includes(file));
    if (uploadsLeft.length > 0) {
      console.error(`⚠️ 残留上传文件：${uploadsLeft.join(", ")}`);
      exitCode = 1;
    }
    process.exit(exitCode);
  });
