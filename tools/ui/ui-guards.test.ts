// =====================
// UI 守卫（U1，2026-10-18）
// 运行：npm run test:ui-guards ｜ 生成基线：--write-baseline
//
// 四条：
//   ① 对比度：文本令牌与底色的组合必须 ≥4.5:1（大字/非文本 ≥3:1）—— 不通过即红，**没有基线**；
//   ② 非 transform 动画：不许对 height/width/top/left/margin 做过渡（会触发重排）
//   ③ 焦点样式缺失：Button 与管理端按钮必须带 focus-visible；输入控件必须有全局焦点规则
//   ④ 裸间距：页面里手写的 size 值（`p-[13px]` 这类）—— 存量记基线，只减不增
// =====================

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const BASELINE = join(ROOT, "tools/ui/ui-baseline.json");
const CSS = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `\n${detail}` : ""}`); }
};

const token = (name: string): string | null => {
  const m = CSS.match(new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})`));
  return m ? m[1] : null;
};
const lum = (hex: string) => {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = ch.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

function walk(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|css)$/.test(name)) out.push(full);
  }
  return out;
}

// ——— ① 对比度 ———
console.log("== ① 对比度（正文 ≥4.5:1，大字/非文本 ≥3:1）==");
const surfaces = ["--adm-surface", "--adm-surface-2", "--adm-surface-3"].map((n) => ({ n, v: token(n) })).filter((x) => x.v);
const texts = ["--adm-text", "--adm-text-soft", "--adm-text-mute", "--adm-red-text", "--adm-ok-text", "--adm-warn-text"]
  .map((n) => ({ n, v: token(n) })).filter((x) => x.v);
const failures: string[] = [];
for (const t of texts) for (const s of surfaces) {
  const r = ratio(t.v!, s.v!);
  if (r < 4.5) failures.push(`${t.n} on ${s.n} = ${r.toFixed(2)}:1`);
}
check("所有正文级文字令牌在三种底色上都 ≥4.5:1", failures.length === 0, failures.map((f) => "    " + f).join("\n"));

// ——— ② 非 transform 动画 ———
console.log("");
console.log("== ② 过渡只动 transform / opacity / 颜色 ==");
const files = [...walk(join(ROOT, "src"))];
const hardTransition = files.filter((f) => {
  const src = readFileSync(f, "utf8");
  // 只认「显式把布局属性写进过渡」的写法：
  //   CSS  transition: height 200ms / Tailwind  transition-[width]  / transition-all
  // 不看 `transition` 同行的定位类名（top-1/2、left-10 之类），那是误判（踩过）。
  return /transition\s*:\s*[^;}]*\b(height|width|top|left|margin|padding)\b/i.test(src)
    || /transition-\[[^\]]*\b(height|width|top|left|margin|padding)\b[^\]]*\]/i.test(src);
}).map((f) => relative(ROOT, f).replace(/\\/g, "/"));
check("没有对 height/width/top/left/margin/padding 做过渡（硬拦）", hardTransition.length === 0, hardTransition.map((f) => "    " + f).join("\n"));

// transition-all 属"宽泛但可接受"的存量：记基线，只减不增
const looseTransition = files
  .filter((f) => /transition-all\b/.test(readFileSync(f, "utf8")))
  .map((f) => relative(ROOT, f).replace(/\\/g, "/"))
  .sort();

// ——— ③ 焦点样式 ———
console.log("");
console.log("== ③ 焦点样式 ==");
const buttonSrc = readFileSync(join(ROOT, "src/components/ui/Button.tsx"), "utf8");
check("Button 组件带完整的焦点轮廓（outline-2 + outline-offset）", buttonSrc.includes("focus-visible:outline-2") && buttonSrc.includes("focus-visible:outline-offset"));
check("管理端按钮有 :focus-visible 规则", CSS.includes(".adm-btn:focus-visible"));
check("输入控件有全局 :focus-visible 规则", /input:focus-visible[\s\S]*?outline/.test(CSS));
check("存在减少动效兜底（prefers-reduced-motion）", CSS.includes("prefers-reduced-motion"));

// ——— ④ 裸间距（基线棘轮）———
console.log("");
console.log("== ④ 页面里手写的尺寸值（基线：只减不增）==");
const handwritten = files
  .filter((f) => /\.(tsx|ts)$/.test(f) && !/\.test\./.test(f))
  .filter((f) => /(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr)-\[\d+px\]/.test(readFileSync(f, "utf8")))
  .map((f) => relative(ROOT, f).replace(/\\/g, "/"))
  .sort();

if (process.argv.includes("--write-baseline")) {
  writeFileSync(BASELINE, JSON.stringify({ handwritten, looseTransition }, null, 2) + "\n", "utf8");
  console.log(`基线已写入（手写尺寸 ${handwritten.length} 个文件 / transition-all ${looseTransition.length} 个文件）`);
  process.exit(0);
}
if (!existsSync(BASELINE)) { console.error("缺少基线，先跑 --write-baseline"); process.exit(1); }
const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as { handwritten: string[]; looseTransition?: string[] };
const added = handwritten.filter((f) => !baseline.handwritten.includes(f));
const removed = baseline.handwritten.filter((f) => !handwritten.includes(f));
check("没有新增手写尺寸的文件", added.length === 0, added.map((f) => "    + " + f).join("\n"));

const baseLoose = baseline.looseTransition ?? [];
const addedLoose = looseTransition.filter((f) => !baseLoose.includes(f));
check("没有新增 transition-all 的文件（宽泛过渡，基线只减不增）", addedLoose.length === 0, addedLoose.map((f) => "    + " + f).join("\n"));
if (removed.length) console.log(`    ↓ 已清理：${removed.join("、")}`);

console.log("");
console.log(`结果：通过 ${pass} / ${pass + fail}`);
if (fail > 0) { console.error(`${fail} 项未通过`); process.exit(1); }
