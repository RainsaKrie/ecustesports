// =====================
// 场次校验护栏（2026-10-25）
//
// 为什么加：2026-10-22 那次连环报错，根因之一是「赛制说 N 场 ⇒ 必须正好 N 场」这个判据
// 被复制到 8 处。改一处、下一处立刻拦住你，最后靠人工 grep 才找齐。
//
// 这条护栏不检查逻辑对错，只**禁止继续复制**：
//   src/lib 下除白名单外，不得出现 `xxx.length !== <expected 类变量>` 的写法。
// 正确写法是 `>`（多于才报警），或调用统一的 expectedMatches()。
// =====================

import { readdirSync, readFileSync, statSync } from "fs";
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
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) acc.push(full);
  }
  return acc;
}

// 白名单：这些是"真的必须相等"的判定（不是场次校验），写在这里等于显式声明
const ALLOWED = [
  "identity/admin-session.ts",      // 计时比较，防时序攻击
  "registration/format.ts",         // 种子池要求恰好 16 队
  "bracket-engine.ts",              // 构造时校验入参
  "registration-admin-ops.ts",      // 名单必须恰好 N 名首发
  "schedule-ops.ts",                // 版本号必须相等（乐观锁）
  "stage-chain-rules.ts",           // 赛制配置自身的入口/晋级守恒
  "result-vision.ts",               // 识别结果分组数量
];

console.log("场次校验护栏");

const files = walk(join(process.cwd(), "src/lib"));
const offenders: string[] = [];

for (const file of files) {
  const rel = file.replace(/\\/g, "/").split("src/lib/")[1] ?? file;
  if (ALLOWED.some((a) => rel.endsWith(a))) continue;
  const text = readFileSync(file, "utf8");
  text.split("\n").forEach((line, i) => {
    // 命中形如 `something.length !== expectedXxx` / `!== xxxExpected` 的写法
    if (/\.length\s*!==\s*\w*[Ee]xpected\w*/.test(line)) {
      offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 80)}`);
    }
  });
}

check("src/lib 下没有新增「场次必须正好 N」的判据", offenders.length === 0, offenders.join("\n      "));

console.log(`\n结果：通过 ${passed} / ${failed + passed}`);
if (failed > 0) process.exit(1);
