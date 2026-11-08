// =====================
// 赛程文档写入契约的守卫测试（2026-10-12）
// 运行：npx tsx src/lib/domains/schedule/schedule-write-contract.test.ts
//
// 契约：任何改动 `schedule` 文档内容的写入路径，都必须让 `schedule.version` 单调 +1
//       （统一递增入口 `schedule-ops.ts` 的 `stampScheduleVersion`）。
//
// 为什么需要单独的守卫：那次数据丢失（裁判已报的赛果被管理端旧快照静默覆盖）的根因
// 就是「某条写入路径没有递增 version」，而 `version` 是管理端判断「我这份快照还新不新」
// 的唯一依据。少一条路径，那条路径写的成果就对护栏完全不可见。
//
// 这类缺失的恶劣之处在于**它不会让任何测试变红**，只会让护栏静默失效。
// 所以这里用源码断言把它钉住四件事：
//   1. 全仓库写入 `schedule` 的文件必须与冻结清单一致 —— 新增写入点立刻失败，强制登记；
//   2. **每个文件里的写入条数也要一致** —— 往已登记的文件里再加一条路径同样失败
//      （2026-10-12 补：原先只比文件名，那样加第二条路径完全查不出来，已实测确认）；
//   3. 每个非豁免的写入文件必须真的调用递增入口 —— 重构时把调用掉了也会失败；
//   4. **递增调用的结果必须被用上**（`return` / `=` / `=>`）—— 调完就扔同样失败
//      （2026-10-12 补：原先只查「调用出现过」，`stampScheduleVersion(s, next); return s;`
//      这种「算出新版本却返回旧快照」照样全绿）。
//
// ★ 第 3、4 条是「存在 → 被调用 → 被用上」三层里的后两层。
//   同类教训在本仓库已出现三次（api-route-guards 组 5 与组 1、以及这里）：
//   **断言「用了某能力」时，要一路问到「那个结果真的生效了吗」。**
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

/**
 * 该文件里那个递增调用的**结果被用上了**（而不是调完就扔）。
 *
 * 2026-10-12 补：原来只查「调用出现过」，于是
 * `stampScheduleVersion(schedule, next); return schedule;`（算出新版本却把旧快照返回去）
 * 照样全绿 —— 变异实测确认。这与「鉴权只认调用存在」是同一个毛病：
 * **存在 ≠ 被用上**。所以这里要求它出现在「捕获结果」的位置：
 * `return <名>(` —— 直接返回；`= <名>(` —— 赋给变量或属性；`=> <名>(` —— 箭头函数直接返回。
 *
 * 若将来出现别的合理写法（例如包在别的函数参数里），就在这里显式补上，
 * 别改成「只要出现就算」——那等于把上面这个洞又打开。
 */
function capturesResult(source: string, name: string): boolean {
  const withoutImports = source.replace(/^[ \t]*import[\s\S]*?from\s+["'][^"']+["'];?[ \t]*$/gm, "");
  return new RegExp(`(?:return|=>|=)\\s*${name}\\s*\\(`).test(withoutImports);
}

/** 写入 `schedule` 文档的调用点：`writeEventData` / `updateEventData` 且文档名是字面量 "schedule"。 */
const WRITE_SITE = /(?:updateEventData|writeEventData)(?:<[^>]*>)?\(\s*[^,()]+,\s*"schedule"/g;

/**
 * 冻结的写入点清单。
 *
 * ★ **新增任何写入 `schedule` 文档的位置，本测试都会失败** —— 这是故意的：
 *   它迫使作者先想清楚「这条新路径要不要递增 version」，而不是漏掉它。
 *
 * ★ **`sites` 是「该文件里有几条写入路径」，必须精确。** 2026-10-12 补：
 *   原先只比对**文件名**，于是「往一个已登记的文件里再加一条写入路径」**完全查不出来**——
 *   变异实测：给 `app/api/data/bp/route.ts` 加第二条 `updateEventData(…, "schedule", …)`
 *   且不递增 version，守卫照样 12/12 通过（它甚至把那行 `bp/route.ts×2` 打了出来，却没拿去比较）。
 *   → 文件级粒度太粗；现在按**每个文件的条数**比对，多一条 / 少一条都必须先改这里。
 *
 * `stamp` 是「如何满足契约」：
 *   · 一个调用名 —— 该文件必须出现这个调用；
 *   · `"exempt"`  —— 豁免，必须在 `reason` 里写明为什么不需要递增。
 */
const WRITERS: Array<{ file: string; sites: number; stamp: string; reason: string }> = [
  {
    file: "app/api/data/schedule/route.ts",
    sites: 1,
    stamp: "applyScheduleSave",
    reason: "管理端整份保存：裁决函数内部统一递增",
  },
  {
    file: "app/api/data/bp/route.ts",
    sites: 1,
    stamp: "stampScheduleVersion",
    reason: "BP 完成写入选图与通知",
  },
  {
    // 2026-11-08：撤销赛果。不能走整份保存（会被丢失护栏判成覆盖冲突），
    // 所以服务端自己读赛程、清赛果、写回 —— 是第 7 个写入点，必须递增 version。
    file: "app/api/admin/schedule/revert/route.ts",
    sites: 1,
    stamp: "stampScheduleVersion",
    reason: "撤销赛果：清掉本场赛果与胜者，并清空下一场被填进去的那一侧",
  },
  {
    // 2026-10-19 阶段 2：这段编排从路由抽到了 application 用例，写入点随之迁移。
    // 数量仍是 2（提交 / 处理各一次），只是位置变了 —— 属于登记而不是放宽。
    file: "lib/application/reschedule.ts",
    sites: 2,
    stamp: "stampScheduleVersion",
    reason: "队长提交约赛申请、对手队长确认 / 拒绝（经 application/reschedule 用例）",
  },
  {
    file: "lib/domains/result/reporting-state.ts",
    sites: 1,
    stamp: "stampScheduleVersion",
    reason: "裁判报分、管理员裁决与受控更正（走 updateEventDataBatch，文档名是间接引用）",
  },
  {
    file: "app/api/admin/events/format/route.ts",
    // 2026-10-19 新增：自定义赛段链保存时，清掉「抽完签但一场没打」的旧骨架（同一次请求内）
    sites: 2,
    stamp: "stampScheduleVersion",
    reason: "换赛制时清掉「未开打骨架」（只清待排期且无开赛时间的场次），需递增 version",
  },
  {
    file: "app/api/admin/events/route.ts",
    sites: 1,
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

// ★ 条数也要一致（2026-10-12 补）：只比文件名的话，「往已登记的文件里再加一条写入路径」查不出来。
const discoveredSites = [...discovered.entries()].map(([file, count]) => `${file}×${count}`).sort();
const registeredSites = WRITERS.map((w) => `${w.file}×${w.sites}`).sort();
check(
  "每个文件里的写入条数也与冻结清单一致（同一文件新增写入路径同样必须登记）",
  JSON.stringify(discoveredSites) === JSON.stringify(registeredSites),
  `发现 ${JSON.stringify(discoveredSites)}，登记 ${JSON.stringify(registeredSites)} —— `
    + `某文件里多/少了一条写入 schedule 的路径：先确认它要不要递增 version，再把该文件的 sites 改成新值`,
);
check(
  "登记的 sites 都是正整数（写 0 或漏写会让上面那条失去意义）",
  WRITERS.every((w) => Number.isInteger(w.sites) && w.sites >= 1),
  JSON.stringify(WRITERS.map((w) => [w.file, w.sites])),
);

// reporting-state.ts（2026-10-26 从 reporting-data.ts 拆出）里同时有两种写入：一条能扫到 `writeEventData(..., "schedule", ...)`
// （本地演示 seed），另一条是 `updateEventDataBatch` 走 `REPORTING_DOCUMENTS` 的间接写入 ——
// 后者的文档名不在调用行上，**扫描在原理上就看不见它**，所以清单里是手工登记的。
// 这里顺手确认那条间接写入确实带着递增入口，否则「登记了但没递增」会蒙混过关。
const reportingData = readFileSync(join(SRC, "lib/domains/result/reporting-state.ts"), "utf8");
check(
  "reporting-state 的间接写入（updateEventDataBatch）确实带上了递增入口",
  reportingData.includes("updateEventDataBatch") && usesCall(reportingData, "stampScheduleVersion"),
);

console.log("\n== 组2 · 每个非豁免写入点都真的递增 version，且递增结果被用上 ==");

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
  check(
    `${writer.file}：${writer.stamp} 的结果被用上（不是调完就扔）`,
    capturesResult(source, writer.stamp),
    `找到了 ${writer.stamp}(...) 但它的结果没有被返回或赋值 —— `
      + `那样版本号算了等于没算，写入的仍是旧快照（那次数据丢失就是这个形状）`,
  );
}

// 豁免也必须写明理由，避免「顺手豁免」变成默认选项
check(
  "每个豁免项都写明了理由",
  WRITERS.filter((w) => w.stamp === "exempt").every((w) => w.reason.trim().length > 10),
);

console.log("\n== 组3 · 裁判提交不得再比对整份文档版本号 ==");

const resultOps = readFileSync(join(SRC, "lib/domains/schedule/result-ops.ts"), "utf8");
check(
  "submitResultOp 不再返回 VERSION_CONFLICT",
  !resultOps.includes("VERSION_CONFLICT"),
  "整份版本号是全局量，改回去会让两名裁判同时报不同场次时互相拒掉",
);
check("改用逐场前置条件 MATCH_CHANGED", resultOps.includes("MATCH_CHANGED"));

const stampHelper = readFileSync(join(SRC, "lib/domains/schedule/schedule-ops.ts"), "utf8");
check("统一递增入口 stampScheduleVersion 仍在", /export function stampScheduleVersion\(/.test(stampHelper));
check(
  "递增口径是 before.version + 1（单调）",
  /version:\s*before\.version\s*\+\s*1/.test(stampHelper),
);

console.log(`\n${pass} 通过 / ${fail} 未通过`);
if (fail > 0) process.exitCode = 1;
