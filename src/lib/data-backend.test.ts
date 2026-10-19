// =====================
// 数据后端选择：行为断言 + 单一来源守卫（2026-10-12）
// 运行：npm run test:data-backend
//
// 为什么需要它：「用哪个后端」原先在 4 个文件里各写了一份
// （data-store / asset-store / evidence-store / rate-limit），**行为还不一致** ——
// data-store 那份遇到无法识别的值会抛错，另外三份静默退回 file。
// 而「两套数据后端」是本仓库最容易踩的坑（本地 file / 生产 supabase）。
//
// 所以这里钉两件事：
//   1. **逐档行为**：三种取值各自的结果，尤其「无法识别的值必须抛错、不许静默降级」；
//   2. **只有一处读 `DATA_BACKEND`**：否则第五份拷贝会带着自己的语义悄悄长出来。
//
// ★ 第 1 组比源码扫描更重要 —— 扫描只能证明「没有第二份」，
//   第 1 组才能证明「这一份算得对」。两者都要。
// =====================

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { resolveDataBackend } from "./data-backend";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.log(`  ✗ ${name}${detail ? `（${detail}）` : ""}`); }
}
function group(title: string) {
  console.log("");
  console.log(`== ${title} ==`);
}

// ── 环境变量的存与还原（测试必须自清理）─────────────────────

const SAVED = {
  DATA_BACKEND: process.env.DATA_BACKEND,
  VERCEL_ENV: process.env.VERCEL_ENV,
  REQUIRE_PRODUCTION_SECRETS: process.env.REQUIRE_PRODUCTION_SECRETS,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(SAVED)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/** 把环境摆成「本地开发」：三个变量都不设 */
function asLocal() {
  delete process.env.DATA_BACKEND;
  delete process.env.VERCEL_ENV;
  delete process.env.REQUIRE_PRODUCTION_SECRETS;
}

/** 把环境摆成「托管运行」 */
function asHosted() {
  delete process.env.REQUIRE_PRODUCTION_SECRETS;
  process.env.VERCEL_ENV = "production";
}

/** 记下抛出的消息；没抛就返回 null */
function throwsWith(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

// ── 组1 · 逐档行为 ────────────────────────────────────────

group("组1 · 三种取值各自的结果（改环境变量真跑，不是读源码）");

asLocal();
check("本地未设置 → file", resolveDataBackend() === "file");

process.env.DATA_BACKEND = "supabase";
check("显式 supabase → supabase", resolveDataBackend() === "supabase");

process.env.DATA_BACKEND = "file";
check("显式 file → file", resolveDataBackend() === "file");

// 运维手册里让人手抄环境变量，大小写与多余空格是真实会发生的
process.env.DATA_BACKEND = "  Supabase  ";
check("首尾空白 + 大小写混写仍认得出来", resolveDataBackend() === "supabase");

// ★ 这一条是本次收口的核心：写错一个字母必须当场暴露，不许静默退回 file
process.env.DATA_BACKEND = "supabse";
const typoMessage = throwsWith(() => resolveDataBackend());
check(
  "拼错的值 → 抛错（不静默降级）",
  typoMessage !== null && typoMessage.includes("不支持的数据后端") && typoMessage.includes("supabse"),
  `实际：${typoMessage ?? "（没有抛错 —— 这就是原先那三份拷贝的行为）"}`,
);
process.env.DATA_BACKEND = "postgres";
check("另一种未登记的值 → 同样抛错", throwsWith(() => resolveDataBackend()) !== null);

asHosted();
delete process.env.DATA_BACKEND;
const hostedMessage = throwsWith(() => resolveDataBackend());
check(
  "托管环境未设置 → 抛错并说明该设什么",
  hostedMessage !== null && hostedMessage.includes("DATA_BACKEND=supabase"),
  `实际：${hostedMessage ?? "（没有抛错）"}`,
);

process.env.DATA_BACKEND = "file";
check("托管环境**显式**选 file → 允许（这是刻意的选择，不是漏配）", resolveDataBackend() === "file");

restoreEnv();

// ── 组2 · 全仓库只有一处读 DATA_BACKEND ───────────────────

group("组2 · `process.env.DATA_BACKEND` 全仓库只有一处读");

const ROOT = process.cwd();
const CANONICAL = "src/lib/data-backend.ts";
/** 收口时必须同步的消费方 —— 少一个都说明有人又自己判断了一遍。 */
const CONSUMERS = [
  "src/lib/data-store.ts",
  "src/lib/asset-store.ts",
  "src/lib/domains/result/evidence-store.ts",
  "src/lib/rate-limit.ts",
];

const files: string[] = [];
const walk = (dir: string) => {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      walk(full);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      files.push(full);
    }
  }
};
walk(join(ROOT, "src"));

const rel = (full: string) => relative(ROOT, full).split(sep).join("/");
const cache = new Map<string, string>();
const sourceOf = (file: string) => {
  const hit = cache.get(file);
  if (hit !== undefined) return hit;
  const text = readFileSync(file, "utf8");
  cache.set(file, text);
  return text;
};

check("扫描确实覆盖到源码（否则本组恒真）", files.length >= 40, `实际 ${files.length} 个文件`);

const readers = files.filter((f) => /process\.env\.DATA_BACKEND/.test(sourceOf(f))).map(rel).sort();
check(
  "读 `process.env.DATA_BACKEND` 的只有规范文件",
  JSON.stringify(readers) === JSON.stringify([CANONICAL]),
  `实际 ${JSON.stringify(readers)}；唯一读处应当是 ${CANONICAL}，别处请 import resolveDataBackend()`,
);

const missingConsumers = CONSUMERS.filter(
  (file) => !/resolveDataBackend\s*\(/.test(sourceOf(join(ROOT, file))),
);
check(
  `四类存储都改走 resolveDataBackend：${CONSUMERS.length} 个消费方全部命中`,
  missingConsumers.length === 0,
  `没命中：${JSON.stringify(missingConsumers)}`,
);

restoreEnv();

console.log("");
console.log(`结果：通过 ${pass} / ${pass + fail}`);
if (fail > 0) {
  console.error(`${fail} 项未通过`);
  process.exit(1);
}
