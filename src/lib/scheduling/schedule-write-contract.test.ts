// =====================
// 赛程文档写入契约的守卫测试（2026-10-12）
// 运行：npx tsx src/lib/scheduling/schedule-write-contract.test.ts
//
// 契约：任何改动 `schedule` 文档内容的写入路径，都必须让 `schedule.version` 单调 +1
//       （统一递增入口 `schedule-ops.ts` 的 `stampScheduleVersion`）。
//
// 为什么需要单独的守卫：那次数据丢失（裁判已报的赛果被管理端旧快照静默覆盖）的根因
// 就是「某条写入路径没有递增 version」，而 `version` 是管理端判断「我这份快照还新不新」
// 的唯一依据。少一条路径，那条路径写的成果就对护栏完全不可见。
//
// 这类缺失的恶劣之处在于**它不会让任何测试变红**，只会让护栏静默失效。
// 所以这里用源码断言把它钉住两件事：
//   1. 全仓库写入 `schedule` 的位置必须与冻结清单一致 —— 新增写入点立刻失败，强制登记；
//   2. 每个非豁免的写入文件必须真的调用递增入口 —— 重构时把调用掉了也会失败。
// 另外把「裁判提交不再比对整份版本号」也钉住，防止有人把它改回去。
// =====================

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SRC = join(process.cwd(), "src");

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `（${detail}）` : ""}`); }
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    // 测试文件自己会写 schedule 来造夹具，不算生产写入路径
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function rel(full: string): string {
  return relative(SRC, full).split(sep).join("/");
}

/**
 * 该文件里**真的调用了**某个函数（而不只是 import 了它）。
 *
 * 必须剥掉 import：只判断 `source.includes(name)` 会被 import 行蒙混过关 ——
 * 变异验证时发现过（把调用删掉、import 留着，断言照样绿），那种检查等于没有。
 */
function usesCall(source: string, name: string): boolean {
  const withoutImports = source.replace(/^[ \t]*import[\s\S]*?from\s+["'][^"']+["'];?[ \t]*$/gm, "");
  return withoutImports.includes(`${name}(`);
}

/** 写入 `schedule` 文档的调用点：`writeEventData` / `updateEventData` 且文档名是字面量 "schedule"。 */
const WRITE_SITE = /(?:updateEventData|writeEventData)(?:<[^>]*>)?\(\s*[^,()]+,\s*"schedule"/g;

/**
 * 冻结的写入点清单。
 *
 * ★ **新增任何写入 `schedule` 文档的位置，本测试都会失败** —— 这是故意的：
 *   它迫使作者先想清楚「这条新路径要不要递增 version」，而不是漏掉它。
 *
 * `stamp` 是「如何满足契约」：
 *   · 一个调用名 —— 该文件必须出现这个调用；
 *   · `"exempt"`  —— 豁免，必须在 `reason` 里写明为什么不需要递增。
 */
const WRITERS: Array<{ file: string; stamp: string; reason: string }> = [
  {
    file: "app/api/data/schedule/route.ts",
    stamp: "applyScheduleSave",
    reason: "管理端整份保存：裁决函数内部统一递增",
  },
  {
    file: "app/api/data/bp/route.ts",
    stamp: "stampScheduleVersion",
    reason: "BP 完成写入选图与通知",
  },
  {
    file: "app/api/public/schedule/request/route.ts",
    stamp: "stampScheduleVersion",
    reason: "队长提交约赛申请、对手队长确认 / 拒绝",
  },
  {
    file: "lib/referee/reporting-data.ts",
    stamp: "stampScheduleVersion",
    reason: "裁判报分、管理员裁决与受控更正（走 updateEventDataBatch，文档名是间接引用）",
  },
  {
    file: "app/api/admin/events/route.ts",
    stamp: "exempt",
    reason: "新建赛事时一次性写入空赛程（version 0），不改动已有赛程",
  },
];

console.log("== 组1 · 写入点全量清点 ==");

const discovered = new Map<string, number>();
for (const file of walk(SRC)) {
  const hits = readFileSync(file, "utf8").match(WRITE_SITE);
  if (hits && hits.length > 0) discovered.set(rel(file), hits.length);
}

const discoveredFiles = [...discovered.keys()].sort();
const registeredFiles = WRITERS.map((w) => w.file).sort();

console.log(`  发现的写入点：${discoveredFiles.map((f) => `${f}×${discovered.get(f)}`).join("、") || "（无）"}`);

check(
  "写入点清单与冻结清单一致（新增/删除写入点都必须先改这里）",
  JSON.stringify(discoveredFiles) === JSON.stringify(registeredFiles),
  `发现 ${JSON.stringify(discoveredFiles)}，登记 ${JSON.stringify(registeredFiles)}`,
);

// reporting-data.ts 里同时有两种写入：一条是本文件能扫到的 `writeEventData(..., "schedule", ...)`
// （本地演示 seed），另一条是 `updateEventDataBatch` 走 `REPORTING_DOCUMENTS` 的间接写入 ——
// 后者的文档名不在调用行上，**扫描在原理上就看不见它**，所以清单里是手工登记的。
// 这里顺手确认那条间接写入确实带着递增入口，否则「登记了但没递增」会蒙混过关。
const reportingData = readFileSync(join(SRC, "lib/referee/reporting-data.ts"), "utf8");
check(
  "reporting-data 的间接写入（updateEventDataBatch）确实带上了递增入口",
  reportingData.includes("updateEventDataBatch") && usesCall(reportingData, "stampScheduleVersion"),
);

console.log("\n== 组2 · 每个非豁免写入点都真的递增 version ==");

for (const writer of WRITERS) {
  const source = readFileSync(join(SRC, writer.file), "utf8");
  if (writer.stamp === "exempt") {
    check(`${writer.file}：豁免（${writer.reason}）`, true);
    continue;
  }
  check(
    `${writer.file}：调用 ${writer.stamp}`,
    usesCall(source, writer.stamp),
    `没找到 ${writer.stamp}(...) 的调用 —— 这条路径的写入会对版本护栏不可见`,
  );
}

// 豁免也必须写明理由，避免「顺手豁免」变成默认选项
check(
  "每个豁免项都写明了理由",
  WRITERS.filter((w) => w.stamp === "exempt").every((w) => w.reason.trim().length > 10),
);

console.log("\n== 组3 · 裁判提交不得再比对整份文档版本号 ==");

const resultOps = readFileSync(join(SRC, "lib/scheduling/result-ops.ts"), "utf8");
check(
  "submitResultOp 不再返回 VERSION_CONFLICT",
  !resultOps.includes("VERSION_CONFLICT"),
  "整份版本号是全局量，改回去会让两名裁判同时报不同场次时互相拒掉",
);
check("改用逐场前置条件 MATCH_CHANGED", resultOps.includes("MATCH_CHANGED"));

const stampHelper = readFileSync(join(SRC, "lib/scheduling/schedule-ops.ts"), "utf8");
check("统一递增入口 stampScheduleVersion 仍在", /export function stampScheduleVersion\(/.test(stampHelper));
check(
  "递增口径是 before.version + 1（单调）",
  /version:\s*before\.version\s*\+\s*1/.test(stampHelper),
);

console.log(`\n${pass} 通过 / ${fail} 未通过`);
if (fail > 0) process.exitCode = 1;
