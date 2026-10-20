// =====================
// 架构守卫（阶段 0，2026-10-17；2026-10-20 抽到 tools/guards/kit.ts 公共骨架）
// 运行：npm run test:arch-guards
//
// 三条守卫 + 基线棘轮：
//   · 当前仓库已经有一批违反项（8129 行的 scheduling 目录、hooks 住在 lib 里…），
//     如果守卫一上线就全红，CI 立刻不可用 → 所以用**基线**：把现状记下来，
//     **只允许减少、不允许新增**。每搬完一批，基线跟着缩短，守卫自动收紧。
//
//   ① 行数：单文件 >400 / 单页面 >300
//   ② hooks 位置：src/lib/** 下不许 export useXxx
//   ③ 跨层：界面层（app/ + components/）不许直接 import 内核层的数据访问模块
//   ④ 领域层不许直连基础设施（2026-10-19 补）
//   ⑤ 领域之间不许互相引用，跨域编排只允许在 application 层（2026-10-19 补）
//
// 生成/更新基线：npm run test:arch-guards -- --write-baseline
// =====================

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT, relPath, walkSources, isTestFile, createReport, writeBaseline, readBaseline, diffByKey,
} from "../guards/kit";

const BASELINE_FILE = "tools/arch/arch-baseline.json";
const FILE_LIMIT = 400;
const PAGE_LIMIT = 300;
/** 内核层里「界面不许直接碰」的模块 —— 不是全部内核，只挑数据访问与缓存这几个入口 */
const KERNEL_ENTRIES = ["data-store", "supabase-data-store", "supabase-config", "public-data-cache"];

const isPage = (file: string) => /src[\\/]app[\\/].*[\\/]page\.tsx$/.test(file);
const read = (file: string) => readFileSync(file, "utf8");
const hasKernelImport = (src: string) =>
  KERNEL_ENTRIES.some((entry) => new RegExp(`from\\s+["']@/lib/${entry}["']`).test(src));

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
  const all = [...walkSources(join(ROOT, "src"), /\.(ts|tsx|css)$/), ...walkSources(join(ROOT, "tools"), /\.(ts|tsx|css)$/)]
    .filter((f) => !isTestFile(f));

  const longFiles = all
    .map((file) => ({ file: relPath(file), lines: read(file).split("\n").length }))
    .filter((item) => item.lines > (isPage(join(ROOT, item.file)) ? PAGE_LIMIT : FILE_LIMIT))
    .map((item) => `${item.file} (${item.lines} 行)`)
    .sort();

  const hooksInLib = walkSources(join(ROOT, "src/lib"), /\.(ts|tsx|css)$/)
    .filter((file) => !isTestFile(file))
    .filter((file) => /export\s+(?:function|const)\s+use[A-Z]\w*/.test(read(file)))
    .map(relPath)
    .sort();

  const deepImports = [...walkSources(join(ROOT, "src/app"), /\.(ts|tsx|css)$/), ...walkSources(join(ROOT, "src/components"), /\.(ts|tsx|css)$/)]
    .filter((file) => !isTestFile(file))
    .filter((file) => hasKernelImport(read(file)))
    .map(relPath)
    .sort();

  // ④ 领域层不许直连基础设施：domains/** 里 import 内核的数据访问入口
  const domainToInfra = walkSources(join(ROOT, "src/lib/domains"), /\.(ts|tsx|css)$/)
    .filter((file) => !isTestFile(file))
    .filter((file) => hasKernelImport(read(file)))
    .map(relPath)
    .sort();

  // ⑤ 领域之间不许互相引用（跨域编排只允许在 application 层）
  const domainName = (rel: string) => rel.split("/")[3] ?? "";
  const crossDomain = walkSources(join(ROOT, "src/lib/domains"), /\.(ts|tsx|css)$/)
    .filter((file) => !isTestFile(file))
    .filter((file) => {
      const self = domainName(relPath(file));
      const src = read(file);
      const targets = [...src.matchAll(/from\s+["'](?:@\/lib\/domains\/|\.\.\/[^"']*)/g)].length;
      if (targets === 0) return false;
      // 别名形式：@/lib/domains/<other>/
      const aliased = [...src.matchAll(/from\s+["']@\/lib\/domains\/([^/"']+)/g)].map((m) => m[1]);
      return aliased.some((target) => target !== self);
    })
    .map(relPath)
    .sort();

  return { longFiles, hooksInLib, deepImports, domainToInfra, crossDomain };
}

const current = scan();

if (process.argv.includes("--write-baseline")) {
  writeBaseline(BASELINE_FILE, current);
  console.log(`基线已写入 ${BASELINE_FILE}`);
  console.log(`  超限文件 ${current.longFiles.length} 个 / lib 里的 hooks ${current.hooksInLib.length} 个 / 跨层 import ${current.deepImports.length} 个`);
  process.exit(0);
}

const baseline = readBaseline<Baseline>(BASELINE_FILE, "npm run test:arch-guards -- --write-baseline");
const { check, finish, failCount } = createReport();

/** 基线条目形如 `path (123 行)`；比较时只认路径 —— 行数会随正常改动变化，比它等于自找假红 */
const pathOf = (entry: string) => entry.replace(/\s*\(\d+ 行\)$/, "");
const lineCountOf = (entry: string) => Number(entry.match(/\((\d+) 行\)/)?.[1] ?? 0);

console.log(`基线：超限文件 ${baseline.longFiles.length} / hooks ${baseline.hooksInLib.length} / 跨层 ${baseline.deepImports.length}`);
console.log("");

const longDiff = diffByKey(current.longFiles, baseline.longFiles, pathOf);
check(
  "① 没有新增的「文件 >400 行 / 页面 >300 行」",
  longDiff.added.length === 0,
  longDiff.added.map((item) => `    + ${item}`).join("\n"),
);

// ①b 已在基线里的文件**只能变短、不能变长**（2026-10-19 补）。
// 原先只比路径不比行数，于是同一个文件可以无限增长 —— FormatDrawWorkspace 从 948 涨到 975 仍然绿。
// 改成"只允许减少"，才是真正的棘轮：不逼你改现有文件，但不许它们继续变胖。
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

const hookDiff = diffByKey(current.hooksInLib, baseline.hooksInLib);
check(
  "② src/lib 下没有新增的 hooks 导出",
  hookDiff.added.length === 0,
  hookDiff.added.map((item) => `    + ${item}`).join("\n"),
);
if (hookDiff.removed.length > 0) console.log(`    ↓ 已迁出：${hookDiff.removed.join("、")}`);

const deepDiff = diffByKey(current.deepImports, baseline.deepImports);
check(
  "③ 界面层没有新增的跨层 import（直连数据访问/缓存）",
  deepDiff.added.length === 0,
  deepDiff.added.map((item) => `    + ${item}`).join("\n"),
);
if (deepDiff.removed.length > 0) console.log(`    ↓ 已收敛：${deepDiff.removed.join("、")}`);

// ④ / ⑤（2026-10-19 补）：两个此前完全没查的方向
const d2iDiff = diffByKey(current.domainToInfra, baseline.domainToInfra);
check(
  "④ 领域层没有新增的「直连基础设施」",
  d2iDiff.added.length === 0,
  d2iDiff.added.map((item) => `    + ${item}`).join("\n"),
);
if (d2iDiff.removed.length > 0) console.log(`    ↓ 已收敛：${d2iDiff.removed.join("、")}`);

const crossDiff = diffByKey(current.crossDomain, baseline.crossDomain);
check(
  "⑤ 领域之间没有新增的互相引用（跨域编排只允许在 application）",
  crossDiff.added.length === 0,
  crossDiff.added.map((item) => `    + ${item}`).join("\n"),
);
if (crossDiff.removed.length > 0) console.log(`    ↓ 已收敛：${crossDiff.removed.join("、")}`);

console.log("");
console.log(`当前待还：超限文件 ${current.longFiles.length} 个（含 .css）、lib 内 hooks ${current.hooksInLib.length} 个、跨层 import ${current.deepImports.length} 个、领域直连基础设施 ${current.domainToInfra.length} 个、跨域引用 ${current.crossDomain.length} 个`);

finish(`${failCount()} 项未通过 —— 新增的违规请改掉；若确属基线遗漏，用 --write-baseline 显式承认（会在提交里留痕）`);
