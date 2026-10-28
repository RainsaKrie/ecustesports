// =====================
// JSX 文本泄漏守卫（2026-10-28）
//
// 起因：拆 `RegistrationTeamGrid` 时，把原三元表达式整段贴进新组件，
// 外层又套了一层 `<div>` —— 三元头变成 **JSX 文本节点**，页面上直接显示
// `state.teams.length === 0 ? (`。
//
// 为什么必须靠这道守卫：**JSX 里的纯文本是合法 TypeScript**，
// typecheck / lint / CI 全部绿灯。只有人眼或静态扫描能发现。
//
// 判据：用 TypeScript 语法树找 `JsxText` 节点，看它的文字里是否含代码符号
// （`===`、`!==`、`? (`、`) : (`）。按行扫描会误报 —— 括号跨行时看不出来，
// 所以这里走语法树：**只有真的落在 JSX 文本里的**才报。
// =====================

import ts from "typescript";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

/** JSX 文本里出现这些符号，几乎不可能是想写给人看的文案。 */
const SUSPICIOUS = [/[=!]==/, /\?\s*\(/, /\)\s*:\s*\(/, /\)\s*:\s*\($/, /=>/];

type Hit = { file: string; line: number; text: string };

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** 扫描一段源码里的 JSX 文本泄漏。file 只用于定位。 */
export function findLeaks(source: string, fileName = "inline.tsx"): Hit[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits: Hit[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      const text = node.text.trim();
      if (text && SUSPICIOUS.some((re) => re.test(text))) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        hits.push({ file: fileName, line: line + 1, text: text.slice(0, 90) });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return hits;
}

function selfTest(): void {
  // 正例：这就是线上出问题的那段形状
  const broken = `
export function Demo() {
  return (
    <div className="grid">
      state.teams.length === 0
        ? (
          <span>空</span>
        )
        : (
          <span>有</span>
        )
    </div>
  );
}`;
  const brokenHits = findLeaks(broken, "broken.tsx");
  if (brokenHits.length === 0) {
    console.error("  ✗ 自检失败：应当检出泄漏样本，但没有检出");
    process.exit(1);
  }

  // 反例：正常的 JSX 文本、正常的条件渲染都不该报
  const clean = `
export function Demo({ n }: { n: number }) {
  return (
    <div className={n === 0 ? "a" : "b"}>
      {n === 0 ? <span>空</span> : <span>有</span>}
      <p>这里是一句普通文案，没有任何表达式符号。</p>
    </div>
  );
}`;
  const cleanHits = findLeaks(clean, "clean.tsx");
  if (cleanHits.length !== 0) {
    console.error("  ✗ 自检失败：正常代码被误报", cleanHits);
    process.exit(1);
  }

  console.log("  ✓ 自检通过（坏样本能检出、好样本不误报）");
}

function main(): void {
  console.log("== JSX 文本泄漏守卫 ==");
  selfTest();

  const files = walk(SRC);
  const all: Hit[] = [];
  for (const file of files) all.push(...findLeaks(readFileSync(file, "utf8"), relative(ROOT, file)));

  console.log(`\n== 扫描 ${files.length} 个 .tsx ==`);

  if (all.length === 0) {
    console.log("  ✓ 没有发现被当成文本的表达式片段");
    return;
  }

  for (const hit of all) {
    console.log(`  ✗ ${hit.file}:${hit.line}`);
    console.log(`      ${hit.text}`);
  }
  console.log(`\n共 ${all.length} 处。这些片段会被**当成文字直接渲染到页面上**，`);
  console.log("把该行包进 {} 或改写成条件表达式即可。");
  process.exitCode = 1;
}

main();
