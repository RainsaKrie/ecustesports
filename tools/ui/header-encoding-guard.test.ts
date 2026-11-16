// =====================
// 响应头编码守卫（2026-11-16）
//
// 起因：报名导出接口把中文文件名直接写进 `Content-Disposition`：
//   `attachment; filename="报名名单-event-1.csv"`
// HTTP 头只接受 ByteString，Node 当场抛
//   TypeError: Cannot convert argument to a ByteString because the character at index 22
//   has a value of 25253 which is greater than 255
// 结果：这个导出接口**每次请求都 500**，按钮点了没反应，而类型检查、lint、CI 全绿。
//
// 判据：route.ts 里凡是给 `Content-Disposition` 赋字符串，其值不得含非 ASCII 字符；
// 中文名必须走 RFC 5987 的 `filename*=UTF-8''<百分号编码>`。
// =====================

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = process.cwd();
const API_ROOT = join(ROOT, "src", "app", "api");

/** 头值里出现这些字符就不安全（非 ASCII 一律视为危险）。 */
const NON_ASCII = /[^\x20-\x7E]/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** 从一行里取出 Content-Disposition 的头值；不是这类行就返回 null。 */
export function dispositionValue(line: string): string | null {
  const match = line.match(/["']Content-Disposition["']\s*:\s*(.+?),?\s*$/);
  if (!match) return null;
  return match[1];
}

/** 值是否不安全（含非 ASCII，且不是 encodeURIComponent 的产物）。 */
export function unsafeDisposition(value: string): boolean {
  // encodeURIComponent(...) 的部分是安全的，先剔掉再看剩下的字面量
  const stripped = value.replace(/encodeURIComponent\([^)]*\)/g, "");
  return NON_ASCII.test(stripped);
}

function selfTest(): void {
  const bad = `"Content-Disposition": \`attachment; filename="报名名单-event-1.csv"\`,`;
  const good = `"Content-Disposition": \`attachment; filename="roster.csv"; filename*=UTF-8''\${encodeURIComponent(fileName)}\`,`;

  const badValue = dispositionValue(bad);
  const goodValue = dispositionValue(good);
  if (!badValue || !unsafeDisposition(badValue)) {
    console.error("  ✗ 自检失败：中文直写的头值应当被判为不安全");
    process.exit(1);
  }
  if (!goodValue || unsafeDisposition(goodValue)) {
    console.error("  ✗ 自检失败：encodeURIComponent 的写法被误判");
    process.exit(1);
  }
  console.log("  ✓ 自检通过（中文直写能检出、RFC 5987 写法不误报）");
}

function main(): void {
  console.log("== 响应头编码守卫 ==");
  selfTest();

  const files = walk(API_ROOT);
  const hits: string[] = [];

  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      const value = dispositionValue(line);
      if (value && unsafeDisposition(value)) {
        hits.push(`${relative(ROOT, file)}:${index + 1}  ${line.trim().slice(0, 90)}`);
      }
    });
  }

  console.log(`\n== 扫描 ${files.length} 个 API 文件 ==`);
  if (hits.length === 0) {
    console.log("  ✓ 没有把非 ASCII 写进响应头");
    return;
  }
  for (const hit of hits) console.log(`  ✗ ${hit}`);
  console.log("\nHTTP 头只接受 ByteString，中文必须用 filename*=UTF-8''<encodeURIComponent(名字)>。");
  process.exitCode = 1;
}

main();
