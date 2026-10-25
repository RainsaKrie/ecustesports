// =====================
// 阶段名硬编码护栏（2026-10-25，审查 P2-6 的防复发部分）
//
// 背景：阶段名是**配置项**（用户可改），但被当常量硬编码了 52 处。
// 改名 = 全站静默失效。彻底改造要动大量调用点（留给赛后），
// 这里先做一件事：**禁止继续新增**。
//
// 机制与 `arch-guards` 的行数棘轮相同 —— 现有数量记进基线，只许减少不许增加。
// =====================

import { readdirSync, readFileSync } from "fs";
import { join } from "path";

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? "：" + detail : ""}`); }
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) acc.push(full);
  }
  return acc;
}

// 基线：当前硬编码数量（2026-10-25 实测 16 处，已排除四处允许位置）。**只许减少**。
// 减少后请同步下调这个数字 —— 它是棘轮，不是上限。
const BASELINE = 16;

// 阶段名清单：这几个词出现在代码里就说明在用名字判断逻辑。
const STAGE_NAMES = ["资格赛", "入围赛", "小组赛", "淘汰赛"];
// 允许出现的地方：配置模板（本来就是定义阶段名）、测试、以及给用户看的文案常量
const ALLOWED_PATHS = [
  "schedule/format-templates.ts",   // 赛制模板：阶段名的定义处
  "schedule/stage-role.ts",         // 角色兜底关键词（唯一出处）
  "schedule/staged-format.ts",      // 阶段门控的提示文案
  "schedule/bracket-engine.ts",     // 生成的轮次名
];

const files = walk(join(process.cwd(), "src"));
let count = 0;
const hits: string[] = [];

for (const file of files) {
  const rel = file.replace(/\\/g, "/").split("src/")[1] ?? file;
  if (ALLOWED_PATHS.some((a) => rel.endsWith(a))) continue;
  const text = readFileSync(file, "utf8");
  text.split("\n").forEach((line, i) => {
    for (const name of STAGE_NAMES) {
      if (line.includes(`"${name}"`) || line.includes(`'${name}'`)) {
        count++;
        if (hits.length < 8) hits.push(`${rel}:${i + 1}  ${name}`);
        break;
      }
    }
  });
}

console.log("阶段名硬编码");
console.log(`  当前 ${count} 处 / 基线 ${BASELINE} 处`);

check(
  `阶段名硬编码没有增加（${count} ≤ ${BASELINE}）`,
  count <= BASELINE,
  `超出 ${count - BASELINE} 处，新增的位置：\n      ${hits.join("\n      ")}`,
);
check(
  "基线没有被悄悄放松（若确实减少了，应同步下调 BASELINE）",
  count >= BASELINE - 5,
  `当前 ${count} 比基线少 ${BASELINE - count} 处，请把 BASELINE 改成 ${count}`,
);

console.log(`\n结果：通过 ${passed} / ${failed + passed}`);
if (failed > 0) process.exit(1);
