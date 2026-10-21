// =====================
// 文档与代码的一致性检查（2026-10-21）
//
// 为什么加：本阶段出现过"文档写 3 个按钮变体、代码实际 4 个"——
// 加了 `danger` 却没回写文档，后来者按文档改代码会漏掉它。
// 规范写在文档里、实现写在代码里，两者漂移时**没有任何东西会报警**。
//
// 现在把这类"数字型约定"固化成断言：文档改了或代码改了，只要对不上就红。
// =====================

import { readFileSync } from "fs";
import { join } from "path";

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? "：" + detail : ""}`); }
}

const root = process.cwd();
const doc = readFileSync(join(root, "docs/10-后续开发规划/33-视觉规范统一.md"), "utf8");
const button = readFileSync(join(root, "src/components/ui/Button.tsx"), "utf8");
const theme = readFileSync(join(root, "src/app/pub-theme.css"), "utf8");

// ① 按钮变体数
const codeVariants = (button.match(/^  (primary|secondary|ghost|danger):/gm) ?? []).length;
const docVariants = Number((doc.match(/按钮：(\d+) 变体/) ?? [])[1] ?? 0);
check("按钮变体数：文档 = 代码", docVariants === codeVariants,
  `文档 ${docVariants} / 代码 ${codeVariants}`);

// ② 按钮尺寸数
const codeSizes = (button.match(/^  (md|lg):/gm) ?? []).length;
const docSizes = Number((doc.match(/× (\d+) 尺寸/) ?? [])[1] ?? 0);
check("按钮尺寸数：文档 = 代码", docSizes === codeSizes,
  `文档 ${docSizes} / 代码 ${codeSizes}`);

// ③ 字号档位：文档表格里的四档值与 CSS 令牌逐一比对
const tokenPairs = [...doc.matchAll(/\| `(--pub-fs-[a-z]+)` \| (\d+)px \|/g)].map((m) => [m[1], m[2]]);
check("文档写明了字号档位", tokenPairs.length > 0, `解析到 ${tokenPairs.length} 档`);
for (const [token, px] of tokenPairs) {
  const inCss = new RegExp(`${token}:\\s*${px}px`).test(theme);
  check(`${token} 文档 ${px}px = CSS 实际值`, inCss);
}

console.log(`\n结果：通过 ${passed} / ${failed + passed}`);
if (failed > 0) process.exit(1);
