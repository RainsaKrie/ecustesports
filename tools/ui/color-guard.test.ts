// =====================
// 颜色守卫（2026-10-18）
// 运行：npm run test:color-guard ｜ 生成基线：--write-baseline
//
// 为什么单独一个文件：上一次把这条检查塞进 ui-guards 时连坏四次
// （变量声明顺序 / 两处写基线 / 上一段的 process.exit 抢跑）。**基线只能有一个写入点。**
//
// 检查两件事（"颜色统一"的两个大头）：
//   ① 十六进制色值必须在色板之内（色板 = globals.css 里所有 --xxx: #hex）；
//   ② 不许出现 Tailwind 命名色（text-slate-500 / bg-gray-50 这类）—— 这套是另一套色板。
// 存量记基线，只减不增。
// =====================

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const BASELINE = join(ROOT, "tools/ui/color-baseline.json");
const CSS = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");
/** 公开面的深色世界另有一套值，也算进色板（否则 BP/裁判端会全线报红） */
const PUBLIC_EXTRA = [
  "#ffffff", "#000000",
  "#e2e6ec", "#c3c9d2", "#98a1ad", "#d8dde4",
  "#1e2228", "#2a2f36", "#3a4048",
  "#ff8177", "#4ade80", "#22a06b", "#f5b544", "#5a2a00",
];

function walk(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const palette = new Set([
  ...[...CSS.matchAll(/--[a-z0-9-]+\s*:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1].toLowerCase()),
  ...PUBLIC_EXTRA,
]);

const NAMED = /\b(?:bg|text|border)-(?:slate|gray|zinc|neutral|red|orange|amber|yellow|green|emerald|teal|cyan|blue|indigo|purple|pink|rose)-\d{2,3}\b/g;

const offenders: Record<string, { hex: number; named: number }> = {};
for (const file of walk(join(ROOT, "src"))) {
  if (/\.test\./.test(file)) continue;
  const src = readFileSync(file, "utf8");
  const hex = [...src.matchAll(/#[0-9a-fA-F]{6}/g)]
    .map((m) => m[0].toLowerCase())
    .filter((c) => !palette.has(c)).length;
  const named = (src.match(NAMED) ?? []).length;
  if (hex + named > 0) offenders[relative(ROOT, file).replace(/\\/g, "/")] = { hex, named };
}

const totalHex = Object.values(offenders).reduce((a, b) => a + b.hex, 0);
const totalNamed = Object.values(offenders).reduce((a, b) => a + b.named, 0);

if (process.argv.includes("--write-baseline")) {
  writeFileSync(BASELINE, JSON.stringify({ offenders }, null, 2) + "\n", "utf8");
  console.log(`基线已写入：${Object.keys(offenders).length} 个文件 / 十六进制 ${totalHex} 处 / 命名色 ${totalNamed} 处`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error("缺少基线。先跑：npm run test:color-guard -- --write-baseline");
  process.exit(1);
}

const base = (JSON.parse(readFileSync(BASELINE, "utf8")) as { offenders: Record<string, { hex: number; named: number }> }).offenders;
let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `\n${detail}` : ""}`); }
};

const files = Object.keys(offenders);
const baseFiles = Object.keys(base);
const added = files.filter((f) => !(f in base));
const worse = files.filter((f) => f in base && (offenders[f].hex + offenders[f].named) > (base[f].hex + base[f].named));
const fixed = baseFiles.filter((f) => !(f in offenders));

console.log(`色板 ${palette.size} 色｜当前：${files.length} 个文件 / 十六进制 ${totalHex} / 命名色 ${totalNamed}`);
check(
  "没有新增或加重的「色板外颜色」",
  added.length === 0 && worse.length === 0,
  [...added.map((f) => `    + ${f}（hex ${offenders[f].hex}、命名 ${offenders[f].named}）`),
   ...worse.map((f) => `    ↑ ${f} ${base[f].hex + base[f].named} → ${offenders[f].hex + offenders[f].named}`)].join("\n"),
);
check("命名色（Tailwind 色板）已清零", totalNamed === 0, totalNamed > 0 ? `    还剩 ${totalNamed} 处：${files.filter((f) => offenders[f].named > 0).slice(0, 5).map((f) => `${f}(${offenders[f].named})`).join("、")}` : "");
if (fixed.length > 0) console.log(`    ↓ 已清理：${fixed.length} 个文件`);

console.log("");
console.log(`结果：通过 ${pass} / ${pass + fail}`);
if (fail > 0) process.exit(1);
