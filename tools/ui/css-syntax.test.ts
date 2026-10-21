// =====================
// CSS 语法与重复规则检查（2026-10-21）
//
// 为什么加：`next build` 用的解析器**容忍** CSS 语法错误。
// 本阶段有两处 `@media` / `@supports` 的规则体被脚本吞掉、只剩悬空选择器，
// **构建一直是绿的**，两天没人发现 —— 移动端的毛玻璃降级因此完全没生效。
//
// 两条检查：
//   ① 语法：三个 CSS 文件必须能被标准 postcss 解析；
//   ② 重复：同一选择器在同一文件里出现超过阈值就报警（层叠累积会让"最终值"难以确定）。
// =====================

import { readFileSync } from "fs";
import { join } from "path";
import postcss from "postcss";

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? "：" + detail : ""}`); }
}

const FILES = ["src/app/globals.css", "src/app/pub-theme.css", "src/app/admin-theme.css"];
const DUP_LIMIT = 3;

for (const file of FILES) {
  const src = readFileSync(join(process.cwd(), file), "utf8");

  // ① 语法
  let parsed = true;
  let reason = "";
  try {
    postcss.parse(src);
  } catch (error) {
    parsed = false;
    reason = String((error as Error).message).split("\n")[0];
  }
  check(`${file} 语法合法`, parsed, reason);

  // ② 重复选择器（只看顶层规则，@media 里的按上下文另算）
  if (parsed) {
    const counter = new Map<string, number>();
    postcss.parse(src).walkRules((rule) => {
      if (rule.parent?.type !== "root") return;
      const sel = rule.selector.trim().replace(/\s+/g, " ");
      counter.set(sel, (counter.get(sel) ?? 0) + 1);
    });
    const dupes = [...counter.entries()].filter(([, n]) => n > DUP_LIMIT);
    check(
      `${file} 无选择器重复超过 ${DUP_LIMIT} 次`,
      dupes.length === 0,
      dupes.map(([s, n]) => `${s} ×${n}`).join("；"),
    );
  }
}

console.log(`\n结果：通过 ${passed} / ${failed + passed}`);
if (failed > 0) process.exit(1);
