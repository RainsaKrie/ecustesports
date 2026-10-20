// =====================
// 暗底对比度抽检（2026-10-20，P6）
// 运行：npm run audit:contrast
//
// 为什么单独一个脚本：
//   tools/ui/ui-guards.test.ts 的对比度检查只读 globals.css 里 4 个 `--adm-*` 的 **6 位 hex**
//   × 3 个底色 —— 公开面的 `--pub-*`、以及所有 rgba 令牌（text-soft / text-mute / line / red-soft…）
//   从来没被任何检查覆盖过。rgba 还会被 token() 的正则直接跳过，等于静默放行。
//
// 这个脚本把三份 CSS 的颜色令牌统一解析出来：
//   · #hex 直接用
//   · rgba() 按底色合成（例：62% 白叠在 #0a0b0d 上）
//   · var(--x) 别名解析一层（--adm-line: var(--ui-line)）
// 再按「页面上真实存在的配对」逐对算 WCAG 对比度。
//
// 判定：正文/次要文字 ≥4.5:1（AA）；红字/大字 ≥3:1；非文本（结构线/焦点环）只报告不判失败
// （WCAG 1.4.11 的 3:1 只约束"承载信息的边界"，装饰线不在其中）。
// =====================

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const FILES = ["src/app/globals.css", "src/app/pub-theme.css", "src/app/admin-theme.css"];

type RGBA = { r: number; g: number; b: number; a: number };

const hex = (value: string): RGBA | null => {
  const m = value.trim().match(/^#([0-9a-fA-F]{6})$/);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
};
const rgb = (value: string): RGBA | null => {
  const m = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/);
  if (!m) return null;
  return {
    r: Number(m[1]),
    g: Number(m[2]),
    b: Number(m[3]),
    a: m[4] === undefined ? 1 : Number(m[4]),
  };
};
const parseColor = (value: string): RGBA | null => hex(value) ?? rgb(value);

/** rgba 叠在 bg 上（bg 必须不透明） */
const composite = (fg: RGBA, bg: RGBA): RGBA => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
  a: 1,
});
const lum = (c: RGBA) => {
  const ch = [c.r, c.g, c.b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};
const ratio = (a: RGBA, b: RGBA) => {
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

// ---- 解析令牌 ----
const raw = new Map<string, string>();
for (const file of FILES) {
  const css = readFileSync(join(ROOT, file), "utf8");
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    if (!raw.has(m[1])) raw.set(m[1], m[2].trim());
  }
}
const resolve = (name: string, depth = 0): RGBA | null => {
  if (depth > 4) return null;
  const value = raw.get(name) ?? raw.get(`--${name}`);
  if (!value) return null;
  const alias = value.match(/^var\(\s*(--[a-z0-9-]+)\s*\)$/i);
  if (alias) return resolve(alias[1], depth + 1);
  return parseColor(value);
};

const PAGE_BG = resolve("--ui-bg");
if (!PAGE_BG) throw new Error("找不到 --ui-bg");
/** 玻璃卡 = 5% 白叠在页面底上（与 --ui-surface 的合成值一致，#161719） */
const CARD_BG = composite({ r: 255, g: 255, b: 255, a: 0.05 }, PAGE_BG);

const TOKENS = [
  ["--pub-txt", "--pub-txt"],
  ["--pub-txt-soft", "--pub-txt-soft"],
  ["--pub-txt-mute", "--pub-txt-mute"],
  ["--pub-red", "--pub-red"],
  ["--adm-text", "--adm-text"],
  ["--adm-text-soft", "--adm-text-soft"],
  ["--adm-text-mute", "--adm-text-mute"],
  ["--adm-red-text", "--adm-red-text"],
  ["--adm-ok-text", "--adm-ok-text"],
  ["--adm-warn-text", "--adm-warn-text"],
] as const;

type Row = { label: string; ratio: number; min: number; pass: boolean };
const rows: Row[] = [];
const push = (label: string, fg: RGBA, bg: RGBA, min: number) => {
  // ⚠️ rgba 必须**先叠在底色上**再算对比度：直接拿 RGB 当不透明会把 64% 白算成 17.73:1
  // （实测第一版就踩了这个坑，反而掩盖了"灰字是否够亮"这个真正要查的问题）。
  const solid = fg.a < 1 ? composite(fg, bg) : fg;
  const r = ratio(solid, bg);
  rows.push({ label, ratio: r, min, pass: r >= min });
};

for (const [label, name] of TOKENS) {
  const fg = resolve(name);
  if (!fg) continue;
  const big = label.includes("red") || label.includes("ok") || label.includes("warn");
  const min = big ? 3 : 4.5;
  push(`${label} on 页面底`, fg, PAGE_BG, min);
  push(`${label} on 玻璃卡`, fg, CARD_BG, min);
}

// 非文本（结构线 / 焦点环）——只报告
const info: string[] = [];
for (const name of ["--ui-line", "--ui-line-soft", "--ui-red"]) {
  const c = resolve(name);
  if (!c) continue;
  const composed = c.a < 1 ? composite(c, PAGE_BG) : c;
  info.push(`${name} 对页面底 = ${ratio(composed, PAGE_BG).toFixed(2)}:1`);
}

// ---- 输出 ----
const fails = rows.filter((r) => !r.pass);
console.log("暗底对比度抽检（AA：正文 4.5:1，红/大字 3:1）");
console.log("");
for (const r of rows) {
  console.log(`  ${r.pass ? "✓" : "✗"} ${r.label.padEnd(26)} ${r.ratio.toFixed(2)}:1  (≥${r.min})`);
}
console.log("");
console.log("非文本（仅供参考，装饰线不在 AA 约束内）：");
for (const line of info) console.log(`  · ${line}`);
console.log("");
console.log(`结果：通过 ${rows.length - fails.length} / ${rows.length}`);
if (fails.length > 0) {
  console.error(`\n${fails.length} 项未达 AA：`);
  for (const f of fails) console.error(`  ${f.label} = ${f.ratio.toFixed(2)}:1（门槛 ${f.min}）`);
  process.exit(1);
}
