// =====================
// 架构守卫（阶段 0，2026-10-17）
// 运行：npm run test:arch-guards
//
// 三条守卫 + 基线棘轮：
//   · 当前仓库已经有一批违反项（8129 行的 scheduling 目录、4 个 hooks 住在 lib 里…），
//     如果守卫一上线就全红，CI 立刻不可用 → 所以用**基线**：把现状记下来，
//     **只允许减少、不允许新增**。每搬完一批，基线跟着缩短，守卫自动收紧。
//
//   ① 行数：单文件 >400 / 单页面 >300
//   ② hooks 位置：src/lib/** 下不许 export useXxx
//   ③ 跨层：界面层（app/ + components/）不许直接 import 内核层的数据访问模块
//
// 生成/更新基线：npm run test:arch-guards -- --write-baseline
// =====================

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const BASELINE_FILE = join(ROOT, "tools/arch/arch-baseline.json");
const FILE_LIMIT = 400;
const PAGE_LIMIT = 300;
/** 内核层里「界面不许直接碰」的模块 —— 不是全部内核，只挑数据访问与缓存这几个入口 */
const KERNEL_ENTRIES = ["data-store", "supabase-data-store", "supabase-config", "public-data-cache"];

function walk(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|css)$/.test(name)) out.push(full);
  }
  return out;
}

const isPage = (file: string) => /src[\\/]app[\\/].*[\\/]page\.tsx$/.test(file);
const isTest = (file: string) => /\.test\.(ts|tsx)$/.test(file);
const read = (file: string) => readFileSync(file, "utf8");

interface Baseline {
  longFiles: string[];
  hooksInLib: string[];
  deepImports: string[];
  /** 领域层直连基础设施（2026-10-19 补） */
  domainToInfra: string[];
  /** 领域之间互相引用（2026-10-19 补） */
  crossDomain: string[];
}

function scan(): Baseline {
  const all = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "tools"))].filter((f) => !isTest(f));

  const longFiles = all
    .map((file) => ({ file: relative(ROOT, file).replace(/\\/g, "/"), lines: read(file).split("\n").length }))
    .filter((item) => item.lines > (isPage(join(ROOT, item.file)) ? PAGE_LIMIT : FILE_LIMIT))
    .map((item) => `${item.file} (${item.lines} 行)`)
    .sort();

  const hooksInLib = walk(join(ROOT, "src/lib"))
    .filter((file) => !isTest(file))
    .filter((file) => /export\s+(?:function|const)\s+use[A-Z]\w*/.test(read(file)))
    .map((file) => relative(ROOT, file).replace(/\\/g, "/"))
    .sort();

  const deepImports = [...walk(join(ROOT, "src/app")), ...walk(join(ROOT, "src/components"))]
    .filter((file) => !isTest(file))
    .filter((file) => {
      const src = read(file);
      return KERNEL_ENTRIES.some((entry) => new RegExp(`from\\s+["']@/lib/${entry}["']`).test(src));
    })
    .map((file) => relative(ROOT, file).replace(/\\/g, "/"))
    .sort();

  // ④ 领域层不许直连基础设施：domains/** 里 import 内核的数据访问入口
  const domainToInfra = walk(join(ROOT, "src/lib/domains"))
    .filter((file) => !isTest(file))
    .filter((file) => {
      const src = read(file);
      return KERNEL_ENTRIES.some((entry) => new RegExp(`from\\s+["']@/lib/${entry}["']`).test(src));
    })
    .map((file) => relative(ROOT, file).replace(/\\/g, "/"))
    .sort();

  // ⑤ 领域之间不许互相引用（跨域编排只允许在 application 层）
  const domainName = (rel: string) => rel.split("/")[3] ?? "";
  const crossDomain = walk(join(ROOT, "src/lib/domains"))
    .filter((file) => !isTest(file))
    .filter((file) => {
      const self = domainName(relative(ROOT, file).replace(/\\/g, "/"));
      const src = read(file);
      const targets = [...src.matchAll(/from\s+["'](?:@\/lib\/domains\/|\.\.\/[^"']*)/g)].length;
      if (targets === 0) return false;
      // 别名形式：@/lib/domains/<other>/
      const aliased = [...src.matchAll(/from\s+["']@\/lib\/domains\/([^/"']+)/g)].map((m) => m[1]);
      return aliased.some((target) => target !== self);
    })
    .map((file) => relative(ROOT, file).replace(/\\/g, "/"))
    .sort();

  return { longFiles, hooksInLib, deepImports, domainToInfra, crossDomain };
}

const current = scan();
const writeBaseline = process.argv.includes("--write-baseline");

if (writeBaseline) {
  writeFileSync(BASELINE_FILE, JSON.stringify(current, null, 2) + "\n", "utf8");
  console.log(`基线已写入 ${relative(ROOT, BASELINE_FILE)}`);
  console.log(`  超限文件 ${current.longFiles.length} 个 / lib 里的 hooks ${current.hooksInLib.length} 个 / 跨层 import ${current.deepImports.length} 个`);
  process.exit(0);
}

if (!existsSync(BASELINE_FILE)) {
  console.error("缺少基线文件。先跑：npm run test:arch-guards -- --write-baseline");
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE_FILE, "utf8")) as Baseline;
let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.log(`  ✗ ${name}${detail ? `\n${detail}` : ""}`); }
};

/** 基线条目形如 `path (123 行)`；比较时只认路径 —— 行数会随正常改动变化，比它等于自找假红 */
const pathOf = (entry: string) => entry.replace(/\s*\(\d+ 行\)$/, "");

const diff = (now: string[], base: string[]) => ({
  added: now.filter((item) => !base.some((prev) => pathOf(prev) === pathOf(item))),
  removed: base.filter((item) => !now.some((cur) => pathOf(cur) === pathOf(item))),
});

console.log(`基线：超限文件 ${baseline.longFiles.length} / hooks ${baseline.hooksInLib.length} / 跨层 ${baseline.deepImports.length}`);
console.log("");

const longDiff = diff(current.longFiles, baseline.longFiles);
check(
  "① 没有新增的「文件 >400 行 / 页面 >300 行」",
  longDiff.added.length === 0,
  longDiff.added.map((item) => `    + ${item}`).join("\n"),
);

// ①b 已在基线里的文件**只能变短、不能变长**（2026-10-19 补）。
// 原先只比路径不比行数，于是同一个文件可以无限增长 —— FormatDrawWorkspace 从 948 涨到 975 仍然绿。
// 改成"只允许减少"，才是真正的棘轮：不逼你改现有文件，但不许它们继续变胖。
const lineCountOf = (entry: string) => Number(entry.match(/\((\d+) 行\)/)?.[1] ?? 0);
const grown = current.longFiles
  .map((cur) => {
    const prev = baseline.longFiles.find((entry) => pathOf(entry) === pathOf(cur));
    return prev && lineCountOf(cur) > lineCountOf(prev)
      ? `${pathOf(cur)}：${lineCountOf(prev)} → ${lineCountOf(cur)} 行`
      : null;
  })
  .filter((item): item is string => item !== null);
check(
  "①b 已在基线里的超限文件没有继续变长",
  grown.length === 0,
  grown.map((item) => `    ↑ ${item}`).join("\n"),
);
if (longDiff.removed.length > 0) console.log(`    ↓ 已达标：${longDiff.removed.join("、")}`);

const hookDiff = diff(current.hooksInLib, baseline.hooksInLib);
check(
  "② src/lib 下没有新增的 hooks 导出",
  hookDiff.added.length === 0,
  hookDiff.added.map((item) => `    + ${item}`).join("\n"),
);
if (hookDiff.removed.length > 0) console.log(`    ↓ 已迁出：${hookDiff.removed.join("、")}`);

const deepDiff = diff(current.deepImports, baseline.deepImports);
check(
  "③ 界面层没有新增的跨层 import（直连数据访问/缓存）",
  deepDiff.added.length === 0,
  deepDiff.added.map((item) => `    + ${item}`).join("\n"),
);
if (deepDiff.removed.length > 0) console.log(`    ↓ 已收敛：${deepDiff.removed.join("、")}`);

// ④ / ⑤（2026-10-19 补）：两个此前完全没查的方向
const d2iDiff = diff(current.domainToInfra, baseline.domainToInfra);
check(
  "④ 领域层没有新增的「直连基础设施」",
  d2iDiff.added.length === 0,
  d2iDiff.added.map((item) => `    + ${item}`).join("\n"),
);
if (d2iDiff.removed.length > 0) console.log(`    ↓ 已收敛：${d2iDiff.removed.join("、")}`);

const crossDiff = diff(current.crossDomain, baseline.crossDomain);
check(
  "⑤ 领域之间没有新增的互相引用（跨域编排只允许在 application）",
  crossDiff.added.length === 0,
  crossDiff.added.map((item) => `    + ${item}`).join("\n"),
);
if (crossDiff.removed.length > 0) console.log(`    ↓ 已收敛：${crossDiff.removed.join("、")}`);

console.log("");
console.log(`当前待还：超限文件 ${current.longFiles.length} 个（含 .css）、lib 内 hooks ${current.hooksInLib.length} 个、跨层 import ${current.deepImports.length} 个、领域直连基础设施 ${current.domainToInfra.length} 个、跨域引用 ${current.crossDomain.length} 个`);
console.log("");
console.log(`结果：通过 ${pass} / ${pass + fail}`);
if (fail > 0) {
  console.error(`${fail} 项未通过 —— 新增的违规请改掉；若确属基线遗漏，用 --write-baseline 显式承认（会在提交里留痕）`);
  process.exit(1);
}
