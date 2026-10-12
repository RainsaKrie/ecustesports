// =====================
// 游戏数据单一来源的守卫测试（2026-10-12）
// 运行：npx tsx src/lib/games/game-data-single-source.test.ts
//
// 契约：一款游戏「有哪些地图 / 段位 / 位置 / 人数」，只在 `src/lib/games/` 下写一份。
//       其余任何地方要这些数据，都从 `@/lib/games` 取。
//
// 为什么需要单独的守卫：抽出这一层之前，段位阶梯在 **3 个**文件里各写了一遍
// （`format-data.ts` 的对照表、报名页的 `RANKS`、选手页的 `RANKS`，加上演示数据生成器
// 与播种脚本共 5 份），位置表与人数上限同理。这类重复的恶劣之处不是「读起来啰嗦」，
// 而是**加一档段位要改 5 处，漏掉的那处不会报错、只会静默不一致** ——
// 报名页能选、后台算不出均值、种子分档按 0 处理。
//
// 所以这里用源码断言把它钉住三件事：
//   1. 段位名 / 位置名 / 地图名不得在 `src/lib/games/` 之外成组出现（少数白名单必须写明理由）；
//   2. 已经收进配置层的旧符号，不得再从旧位置导入；
//   3. 取值与统一之前**逐项一致** —— 防止「搬了个家顺便把数值改了」。
//
// ★ 第 3 组是本文件最重要的一半：前两组防的是「又多写一份」，第 3 组防的是
//   「搬家过程中把 5 改成 4、把 9 档写成 8 档」——那种改动同样不会让别的测试变红。
// =====================

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import {
  getGameConfig,
  rankValueOf,
  isKnownRank,
  normalizePositions,
  rosterLimitOf,
  mapImageOf,
  findMapByName,
  DEFAULT_GAME_ID,
  listGames,
} from "@/lib/games";

const ROOT = process.cwd();
/** 源码根：应用代码与命令行脚本都要查 —— 播种脚本那次就是被类型检查抓出来的。 */
const ROOTS = [join(ROOT, "src"), join(ROOT, "tools")];

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `（${detail}）` : ""}`); }
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function rel(full: string): string {
  return relative(ROOT, full).split(sep).join("/");
}

const SOURCES = [...ROOTS.flatMap(walk)].sort();
const cache = new Map<string, string>();
function sourceOf(file: string): string {
  const hit = cache.get(file);
  if (hit !== undefined) return hit;
  const text = readFileSync(file, "utf8");
  cache.set(file, text);
  return text;
}

/**
 * 某组名字在该文件里，有几个是**作为独立字面量**出现的。
 *
 * ★ 为什么必须加「独立」这个条件：`title="首发 5 人段位均值（铁 1 → 无畏战魂 9）"` 这种
 *   提示文案里也会出现段位名，但那是**在说这件事**，不是在定义阶梯。
 *   定义一定是 `["铁", ...]` 或 `1: "铁",` 这种「名字被引号单独包起来」的形状。
 *   不过滤的话，白名单会被文案污染，最后谁也不敢开这道断言（第一版就是这么失败的）。
 */
function distinctHits(source: string, names: string[]): number {
  return names.filter((name) => source.includes(`"${name}"`) || source.includes(`'${name}'`)).length;
}

function filesWithCatalogue(names: string[]): string[] {
  // 至少 3 个同现才算「抄了一份目录」：只提到一个名字的不在此列
  return SOURCES.filter((file) => distinctHits(sourceOf(file), names) >= 3).map(rel).sort();
}

function checkSingleSource(
  label: string,
  names: string[],
  allowlist: Array<{ file: string; reason: string }>,
) {
  const found = filesWithCatalogue(names);
  const expected = ["src/lib/games/valorant.ts", ...allowlist.map((a) => a.file)].sort();
  check(
    `${label}只在游戏配置里写一份`,
    JSON.stringify(found) === JSON.stringify(expected),
    `实际出现在 ${JSON.stringify(found)}，允许 ${JSON.stringify(expected)}`,
  );
  // 白名单必须写明理由，避免「顺手加一行」变成默认解
  for (const entry of allowlist) {
    check(`　白名单 ${entry.file} 写明了理由`, entry.reason.trim().length > 10, entry.reason);
  }
}

const GAME = getGameConfig();

console.log("== 组1 · 段位阶梯、擅长位置、地图目录各自只有一份定义 ==");
console.log(`  段位：${GAME.ranks.join(" / ")}`);
console.log(`  位置：${GAME.positions.join(" / ")}`);
console.log(`  地图：${GAME.maps.length} 张，默认图池 ${GAME.defaultMapPool.length} 张`);

checkSingleSource("段位阶梯", GAME.ranks, [
  {
    file: "src/lib/scheduling/useRegistration.ts",
    reason: "演示数据生成器：段位只用来把 16 支演示队分档，不参与任何校验，不需要跟着阶梯走",
  },
]);

checkSingleSource("擅长位置", GAME.positions, []);

checkSingleSource("地图目录", GAME.maps.map((m) => m.name), [
  {
    file: "src/lib/referee/map-name.ts",
    reason: "视觉误读校正词表：右侧必须写字面官方名，它对齐的目标就是目录里的名字",
  },
]);

console.log("\n== 组2 · 旧位置不得再被导入 ==");

/** 已收进游戏配置层的符号：只能从 `@/lib/games` 取。 */
const MIGRATED = [
  "TEAM_SIZE",
  "MAX_SUBSTITUTE",
  "MAX_COACH",
  "POSITIONS",
  "RANK_VALUE",
  "VALORANT_MAPS",
  "DEFAULT_MAP_POOL",
];

const GAMES_MODULES = ["@/lib/games", "@/lib/games/index", "../src/lib/games", "../../src/lib/games"];

const staleImports: string[] = [];
for (const file of SOURCES) {
  const source = sourceOf(file);
  const statement = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g;
  for (const match of source.matchAll(statement)) {
    const specifiers = match[1].split(",").map((s) => s.replace(/^type\s+/, "").trim());
    const modulePath = match[2];
    const offenders = specifiers.filter((s) => MIGRATED.includes(s));
    if (offenders.length > 0 && !GAMES_MODULES.includes(modulePath)) {
      staleImports.push(`${rel(file)} 从 ${modulePath} 导入 ${offenders.join("/")}`);
    }
  }
}
check(
  `没有任何文件从旧位置导入 ${MIGRATED.join(" / ")}`,
  staleImports.length === 0,
  staleImports.join("；"),
);

// 反向检查：上面的禁令针对的是「这些名字必须从配置层取」，所以配置层得真的给出等价能力，
// 否则禁完之后调用方无处可去（名字本身刻意不再导出，免得又有人去 import 它）。
check("配置层给出了四个等价取值入口", [
  typeof rosterLimitOf === "function",   // 原 TEAM_SIZE / MAX_SUBSTITUTE / MAX_COACH
  typeof normalizePositions === "function", // 原 POSITIONS
  typeof rankValueOf === "function",     // 原 RANK_VALUE
  typeof findMapByName === "function",   // 原 VALORANT_MAPS / @/lib/maps
].every(Boolean));

check("已删除的 @/lib/maps 模块没有回来", !existsSync(join(ROOT, "src", "lib", "maps.ts")));
check(
  "没有文件再引用 @/lib/maps",
  !SOURCES.some((file) => /from\s+["'][^"']*lib\/maps["']/.test(sourceOf(file))),
);

console.log("\n== 组3 · 取值与统一之前逐项一致 ==");

// —— 段位阶梯：原来是「铁 1 → 无畏战魂 9」的对照表，现在是下标 +1 ——
check("段位共 9 档", GAME.ranks.length === 9, `实际 ${GAME.ranks.length}`);
check("最低档是「铁」", GAME.ranks[0] === "铁");
check("最高档是「无畏战魂」", GAME.ranks[8] === "无畏战魂");
check("rankValueOf 铁 = 1", rankValueOf("铁") === 1);
check("rankValueOf 黄金 = 4", rankValueOf("黄金") === 4);
check("rankValueOf 无畏战魂 = 9", rankValueOf("无畏战魂") === 9);
check("未知段位取 0（不是抛错）", rankValueOf("最强王者") === 0);
check("isKnownRank 认得出来 / 认不出来", isKnownRank("铂金") && !isKnownRank("钻石大师"));

// —— 队伍规模：原来写死 5 / 1 / 1 ——
check("首发 5 人", rosterLimitOf("首发") === 5);
check("替补上限 1 人", rosterLimitOf("替补") === 1);
check("教练上限 1 人", rosterLimitOf("教练") === 1);

// —— 位置：原来 `as const` 的 5 项元组 ——
check("擅长位置 5 个", GAME.positions.length === 5);
check("位置顺序未变（一突 → 哨位）", GAME.positions.join(",") === "一突,二突,烟位,先锋,哨位");
check(
  "normalizePositions 去空白、丢无效项、按序去重",
  JSON.stringify(normalizePositions([" 一突 ", "一突", "哨位", "打野", 7, null])) ===
    JSON.stringify(["一突", "哨位"]),
);
check("normalizePositions 对非数组返回空", normalizePositions("一突").length === 0);

// —— 地图：13 张、默认图池 7 张（随赛季轮换，是初始值不是常量）——
check("地图 13 张", GAME.maps.length === 13, `实际 ${GAME.maps.length}`);
check("默认图池 7 张", GAME.defaultMapPool.length === 7);
check("图池取自目录前 7 张", GAME.defaultMapPool.every((m, i) => m.id === GAME.maps[i].id && m.name === GAME.maps[i].name));
check("findMapByName 亚海悬城 → ascent", findMapByName("亚海悬城")?.id === "ascent");
check("mapImageOf 按 id 命中", mapImageOf({ id: "ascent" }) === "/maps/ascent.png");
check("mapImageOf 按中文名命中", mapImageOf({ name: "亚海悬城" }) === "/maps/ascent.png");
check("mapImageOf 认不出时返回 undefined", mapImageOf({ id: "de_dust2" }) === undefined);
check(
  "每张地图的 id / 中文名 / 英文名 / 图片都齐",
  GAME.maps.every((m) => m.id && m.name && m.codeName && m.image.startsWith("/maps/")),
);

// —— 识图标识：提示词里的英文游戏标识，与代码用的 id 分成两个字段 ——
check("识图标识是 valorant", GAME.visionGameId === "valorant");

// —— 解析：id / 别名 / 未知值 ——
check("默认款是 valorant", DEFAULT_GAME_ID === "valorant");
check("按 id 能取到", getGameConfig("valorant") === GAME);
check("按中文显示名能取到（历届赛事 game 字段填的就是它）", getGameConfig("无畏契约") === GAME);
check("按别名忽略大小写能取到", getGameConfig("VALORANT") === GAME);
check("空值退回默认款", getGameConfig(undefined) === GAME && getGameConfig("") === GAME);
check(
  "未登记的游戏名退回默认款而不是抛错",
  getGameConfig("英雄联盟") === GAME,
  "报名页不该因为 game 字段填错就打不开",
);
check("listGames 至少给出 id 与显示名", listGames().some((g) => g.id === "valorant" && g.displayName === "无畏契约"));

console.log(`\n${pass} 通过 / ${fail} 未通过`);
if (fail > 0) process.exitCode = 1;
