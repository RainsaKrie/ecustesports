// =====================
// UI 守卫（U1，2026-10-18；2026-10-20 抽到 tools/guards/kit.ts 公共骨架）
// 运行：npm run test:ui-guards ｜ 生成基线：--write-baseline
//
// 四条：
//   ① 对比度：文本令牌与底色的组合必须 ≥4.5:1（大字/非文本 ≥3:1）—— 不通过即红，**没有基线**；
//   ② 非 transform 动画：不许对 height/width/top/left/margin 做过渡（会触发重排）
//   ③ 焦点样式缺失：Button 与管理端按钮必须带 focus-visible；输入控件必须有全局焦点规则
//   ④ 裸间距：页面里手写的 size 值（`p-[13px]` 这类）—— 存量记基线，只减不增
// =====================

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT, relPath, walkSources, isTestFile, createReport, writeBaseline, readBaseline,
} from "../guards/kit";

const BASELINE = "tools/ui/ui-baseline.json";
const CSS = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");

const { check, finish, failCount } = createReport();

// 判据用的对比度工具留在本文件：色值解析口径（6 位 hex）本身就是这条守卫的知识
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

const files = walkSources(join(ROOT, "src"), /\.(ts|tsx|css)$/);

// ——— ① 对比度 ———
//
// ⚠️ 本条的**前提**：下面这几个令牌必须是 6 位 hex。一旦有人把它们改成 `var(--ui-x)`
// 或 `rgba(...)`，token() 就返回 null、列表被 filter 掉 —— 检查不会报错，而是**静默不再检查**
// （2026-10-20 P4 就发生过：--adm-text-soft / --adm-text-mute 改成 var() 后本条从 6×3 掉到 4×3）。
// 所以紧跟着补一条「前提检查」，把这种静默失效变成红。
// 注：rgba / var() 令牌（text-soft / text-mute / line / red-soft）由 `npm run test:contrast` 覆盖，
// 那个脚本会解析 var() 别名并按底色合成 rgba。
console.log("== ① 对比度（正文 ≥4.5:1，大字/非文本 ≥3:1）==");
const HEX_REQUIRED = ["--adm-surface", "--adm-surface-2", "--adm-surface-3", "--adm-text", "--adm-red-text"];
const notHex = HEX_REQUIRED.filter((n) => token(n) === null);
check("对比度检查的前提成立：底色与文字令牌仍是 6 位 hex", notHex.length === 0, notHex.map((n) => `    ${n} 不再是 hex（本条会静默失效）`).join("\n"));
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
const hardTransition = files.filter((f) => {
  const src = readFileSync(f, "utf8");
  // 只认「显式把布局属性写进过渡」的写法：
  //   CSS  transition: height 200ms / Tailwind  transition-[width]  / transition-all
  // 不看 `transition` 同行的定位类名（top-1/2、left-10 之类），那是误判（踩过）。
  return /transition\s*:\s*[^;}]*\b(height|width|top|left|margin|padding)\b/i.test(src)
    || /transition-\[[^\]]*\b(height|width|top|left|margin|padding)\b[^\]]*\]/i.test(src);
}).map(relPath);
check("没有对 height/width/top/left/margin/padding 做过渡（硬拦）", hardTransition.length === 0, hardTransition.map((f) => "    " + f).join("\n"));

// transition-all 属"宽泛但可接受"的存量：记基线，只减不增
const looseTransition = files
  .filter((f) => /transition-all\b/.test(readFileSync(f, "utf8")))
  .map(relPath)
  .sort();

// ——— ③ 焦点样式 ———
console.log("");
console.log("== ③ 焦点样式 ==");
// ⚠️ 断言前必须剥掉注释 —— 这个文件的注释里写着"必须含 focus-visible:outline-2"，
// 不剥的话**删掉真正的类名检查照样绿**（2026-10-20 变异检查当场抓到的：注入违规后没变红）。
const buttonSrc = readFileSync(join(ROOT, "src/components/ui/Button.tsx"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");
check("Button 组件带完整的焦点轮廓（outline-2 + outline-offset）", buttonSrc.includes("focus-visible:outline-2") && buttonSrc.includes("focus-visible:outline-offset"));
check("管理端按钮有 :focus-visible 规则", CSS.includes(".adm-btn:focus-visible"));
check("输入控件有全局 :focus-visible 规则", /input:focus-visible[\s\S]*?outline/.test(CSS));
check("存在减少动效兜底（prefers-reduced-motion）", CSS.includes("prefers-reduced-motion"));

// ——— ④ 裸间距（基线棘轮）———
console.log("");
console.log("== ④ 页面里手写的尺寸值（基线：只减不增）==");
const handwritten = files
  .filter((f) => /\.(tsx|ts)$/.test(f) && !isTestFile(f))
  .filter((f) => /(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr)-\[\d+px\]/.test(readFileSync(f, "utf8")))
  .map(relPath)
  .sort();

if (process.argv.includes("--write-baseline")) {
  writeBaseline(BASELINE, { handwritten, looseTransition });
  console.log(`基线已写入（手写尺寸 ${handwritten.length} 个文件 / transition-all ${looseTransition.length} 个文件）`);
  process.exit(0);
}
const baseline = readBaseline<{ handwritten: string[]; looseTransition?: string[] }>(BASELINE, "npm run test:ui-guards -- --write-baseline");
const added = handwritten.filter((f) => !baseline.handwritten.includes(f));
const removed = baseline.handwritten.filter((f) => !handwritten.includes(f));
check("没有新增手写尺寸的文件", added.length === 0, added.map((f) => "    + " + f).join("\n"));

const baseLoose = baseline.looseTransition ?? [];
const addedLoose = looseTransition.filter((f) => !baseLoose.includes(f));
check("没有新增 transition-all 的文件（宽泛过渡，基线只减不增）", addedLoose.length === 0, addedLoose.map((f) => "    + " + f).join("\n"));
if (removed.length) console.log(`    ↓ 已清理：${removed.join("、")}`);

finish(`${failCount()} 项未通过`);
