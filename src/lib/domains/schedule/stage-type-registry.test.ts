// =====================
// 阶段类型的「单一真源」守卫（2026-10-16）
// 运行：npm run test:stage-type-registry
//
// 为什么需要它：`StageType` 这个真值目前散落在**七处**（类型联合两份、白名单两处、文案表两处、
// 构造点默认值），2026-10-14 加 `single-elim-groups` 时正是漏掉其中一处（玩家手册页那份
// `Record<string, string>`）导致**静默显示空白** —— 类型检查不会报，因为它写成了宽松的 Record。
//
// 文档挡不住这种漏，断言可以：本套件扫描这几处源码，要求**每一种阶段类型都被登记**。
// 以后加新阶段类型时，漏一处就会红，并直接点名是哪个文件。
//
// 覆盖的登记处（新增一处就往这里加一行）：
//   1. format-templates：STAGE_TYPE_LABELS / STAGE_TYPE_DEFAULT_BO（TS 已保证穷尽，这里再锁一次）
//   2. types/index.ts 的类型联合
//   3. site-config-schema.ts 的 validTypes 白名单
//   4. app/api/admin/events/route.ts 的 validTypes 白名单
//   5. components/events/EventHandbook.tsx 的文案表（★ 就是漏过的那一处）
// =====================

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { STAGE_TYPE_LABELS, STAGE_TYPE_DEFAULT_BO, type StageType } from "./format-templates.ts";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.log(`  ✗ ${name}${detail ? `（${detail}）` : ""}`); }
}

const ROOT = process.cwd();
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

/** 从源码里抽出「被引号单独包裹」的阶段类型字面量（与 game-data 守卫同一套判据） */
function quotedTypeLiterals(source: string): Set<string> {
  const known = Object.keys(STAGE_TYPE_LABELS) as StageType[];
  const found = new Set<string>();
  for (const type of known) {
    if (source.includes(`"${type}"`) || source.includes(`'${type}'`)) found.add(type);
  }
  return found;
}

const ALL_TYPES = Object.keys(STAGE_TYPE_LABELS) as StageType[];
console.log(`阶段类型全集（${ALL_TYPES.length} 种）：${ALL_TYPES.join("、")}`);

console.log("");
console.log("== 组1 · 文案表与默认值（本模块内） ==");
check(
  "★ 文案表与默认 BO 的键集合完全一致（漏一个就会出现空白文案）",
  JSON.stringify(Object.keys(STAGE_TYPE_LABELS).sort()) === JSON.stringify(Object.keys(STAGE_TYPE_DEFAULT_BO).sort()),
  JSON.stringify({ labels: Object.keys(STAGE_TYPE_LABELS), defaults: Object.keys(STAGE_TYPE_DEFAULT_BO) }),
);
check("每种类型都有非空中文文案", ALL_TYPES.every((type) => (STAGE_TYPE_LABELS[type] ?? "").trim().length > 0));
check("每种类型都有默认 BO", ALL_TYPES.every((type) => Boolean(STAGE_TYPE_DEFAULT_BO[type])));

console.log("");
console.log("== 组2 · 散落在别处的四处登记 ==");

const registries: Array<{ label: string; file: string }> = [
  { label: "types/index.ts 的类型联合", file: "src/types/index.ts" },
  { label: "site-config-schema.ts 的 validTypes 白名单", file: "src/lib/site-config-schema.ts" },
  { label: "app/api/admin/events/route.ts 的 validTypes 白名单", file: "src/app/api/admin/events/route.ts" },
  { label: "★ EventHandbook.tsx 的文案表（漏过一次的那处）", file: "src/components/events/EventHandbook.tsx" },
];

for (const { label, file } of registries) {
  const found = quotedTypeLiterals(read(file));
  const missing = ALL_TYPES.filter((type) => !found.has(type));
  check(`${label} 覆盖全部阶段类型`, missing.length === 0, missing.length ? `漏了：${missing.join("、")}` : "");
}

console.log("");
console.log("== 组3 · 防守边界（守卫本身不能永远为真） ==");
check(
  "扫描逻辑确实能发现缺失（用一个不存在的类型验证判据有效）",
  quotedTypeLiterals('const x = ["single-elim"];').size === 1,
);
check(
  "至少要能认出两种以上类型（否则扫到空文件也会通过）",
  quotedTypeLiterals(read("src/lib/domains/schedule/format-templates.ts")).size >= 2,
  String(quotedTypeLiterals(read("src/lib/domains/schedule/format-templates.ts")).size),
);

console.log("");
console.log("== 组4 · 事件字段的登记完整性 ==");

/**
 * 加一个「事件字段」要改的地方比阶段类型散得多：类型声明 → 默认事件 → 归一化 → 更新接口。
 * 只加在类型里、忘了归一化，就会出现「存了又变回去」（2026-10-16 加 scheduleMode 时踩过）。
 * 判据：每个字段名在整个 schema 文件里至少出现 **2 次**（类型声明之外还要有落点）。
 */
const schemaSource = read("src/lib/site-config-schema.ts");
// 换行符要先归一：本机 core.autocrlf=true，工作区文件可能是 CRLF，
// 而下面对「接口结束」的判断是 line === "}" —— 行尾多一个 \r 就永远匹配不上，
// 接口体被截成空，于是报"所有字段都没被归一化读取"。CI 是 Linux（LF）所以一直是绿的。
const schemaLines = schemaSource.replace(/\r\n/g, "\n").split("\n");
const ifaceStart = schemaLines.findIndex((line) => line.startsWith("export interface EditableEvent"));
const ifaceEnd = schemaLines.findIndex((line, index) => index > ifaceStart && line === "}");
const interfaceBody = schemaLines.slice(ifaceStart, ifaceEnd).join("\n");
const eventFields = [...interfaceBody.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]);
check("能解析出事件字段（否则守卫会永远为真）", eventFields.length >= 10, `解析到 ${eventFields.length} 个`);

const registeredOnce = eventFields.filter((field) => {
  // 判据必须精确到「归一化真的读了它」：出现 `item.<字段>` 或 `fallback.<字段>`。
  // 早先只数「字段名出现 ≥2 次」被变异验证证明**抓不到**「加了字段却忘了归一化」
  // —— 默认事件模板里那个字段名本身就凑了第二次出现。
  return !new RegExp(`(item|fallback)\\.${field}\\b`).test(schemaSource);
});
check(
  "★ 每个事件字段都真的被归一化读取（item./fallback.）",
  registeredOnce.length === 0,
  registeredOnce.length ? `没被归一化读取：${registeredOnce.join("、")}` : "",
);

console.log("");
console.log(`结果：通过 ${pass} / ${pass + fail}`);
if (fail > 0) {
  console.error(`${fail} 项未通过 —— 新加阶段类型时，请把上面点名的文件一起改`);
  process.exit(1);
}
