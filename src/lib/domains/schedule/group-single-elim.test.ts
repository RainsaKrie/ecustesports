// =====================
// 「小组赛组内单败」守卫（2026-10-14）
// 运行：npm run test:group-single-elim
//
// 为什么需要它：这是**造赛程**的路径 —— 一旦生成错，淘汰赛的晋级队伍就是错的，
// 而错误的对阵会被当真打下去。所以把三件事钉住：
//   ① 对阵生成：4 组 × 4 队 = 12 场（不是 GSL 的 20 场），组内按种子位配对，晋级连线接好；
//   ② 名次取数：每组前两名 = **组内决赛**的胜者与负者（半决赛不算，这是最容易写错的一处）；
//   ③ 门控与换赛制：小组赛该有 12 场（不是 20），以及「已打完的阶段不动、未开打的阶段可改」。
// =====================

import {
  buildGroupSingleElimMatches,
  bracketOrderFromSeeds,
  buildDoubleEliminationMatches,
} from "./bracket-engine.ts";
import {
  extractGroupSingleElimQualifiers,
  resolveStagedDrawGate,
  buildKnockoutDrawOrder,
} from "./staged-format.ts";
import { resolveSupportedFormat, formatChangeRefusal, unplayedStagesToClear } from "./format-support.ts";
import type { StageConfig } from "./format-templates.ts";
import type { Group } from "@/lib/domains/registration/format";
import type { ScheduleMatch } from "./schedule-data.ts";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.log(`  ✗ ${name}${detail ? `（${detail}）` : ""}`); }
}
function group(title: string) {
  console.log("");
  console.log(`== ${title} ==`);
}

const GROUPS: Group[] = ["A", "B", "C", "D"].map((letter) => ({
  name: `${letter} 组`,
  teamIds: [1, 2, 3, 4].map((seed) => `${letter}${seed}`),
}));
const teamName = (id: string) => `队-${id}`;

/**
 * 把生成出来的对阵按「种子强者胜」跑完造夹具。
 *
 * 必须先跑第一轮、再用**晋级连线**把组内决赛的两队填上 —— 单败构造器生成的后续轮次
 * 队伍是「待定」，不模拟这一步决赛就永远打不完（初版夹具漏了这步，组 2 全军覆没）。
 */
function completeBySeedOrder(matches: ScheduleMatch[]): ScheduleMatch[] {
  const seedOf = (id: string) => Number(id.slice(1));
  const stronger = (a: string, b: string) => (seedOf(a) <= seedOf(b) ? a : b);
  const winnerOf = new Map<string, string>();

  const firstRound = matches.map((match) => {
    if (match.teamAId === "TBD" || match.teamBId === "TBD") return match;
    const winner = stronger(match.teamAId, match.teamBId);
    winnerOf.set(match.id, winner);
    return { ...match, status: "已完成" as const, winnerTeamId: winner };
  });

  return firstRound.map((match) => {
    if (match.teamAId !== "TBD" && match.teamBId !== "TBD") return match;
    const sideA = firstRound.find((m) => m.nextMatchId === match.id && m.nextSide === "A");
    const sideB = firstRound.find((m) => m.nextMatchId === match.id && m.nextSide === "B");
    const teamAId = sideA ? winnerOf.get(sideA.id) ?? "" : match.teamAId;
    const teamBId = sideB ? winnerOf.get(sideB.id) ?? "" : match.teamBId;
    if (!teamAId || !teamBId) return match;
    const winner = stronger(teamAId, teamBId);
    winnerOf.set(match.id, winner);
    return {
      ...match,
      teamAId,
      teamBId,
      teamAName: teamName(teamAId),
      teamBName: teamName(teamBId),
      status: "已完成" as const,
      winnerTeamId: winner,
    };
  });
}

// ── 组1 · 对阵生成 ────────────────────────────────────────

group("组1 · 组内单败对阵生成（4 组 × 4 队 = 12 场）");

const built = buildGroupSingleElimMatches(GROUPS, teamName, { startIndex: 1, phase: "小组赛", boType: "BO3" });

check("总场次是 12（GSL 是 20，两者差 8 场）", built.length === 12, `实际 ${built.length}`);
check("全部属于小组赛阶段", built.every((m) => m.phase === "小组赛"));
check("全部是 BO3", built.every((m) => m.boType === "BO3"));
check("比赛 id 不重复", new Set(built.map((m) => m.id)).size === 12, JSON.stringify(built.map((m) => m.id)));

for (const letter of ["A", "B", "C", "D"]) {
  const ofGroup = built.filter((m) => (m.round ?? "").startsWith(`${letter} 组`));
  check(`${letter} 组恰好 3 场（2 半决赛 + 1 决赛）`, ofGroup.length === 3, `实际 ${ofGroup.length}`);
}
check(
  "轮次名带小组前缀（界面能看出属于哪一组）",
  built.every((m) => /^[A-D] 组 (半决赛|决赛)$/.test(m.round ?? "")),
  JSON.stringify([...new Set(built.map((m) => m.round))]),
);

// ★ 种子位的意义：一号种子半决赛不能撞二号种子
const groupA = built.filter((m) => (m.round ?? "").startsWith("A 组"));
const semiA = groupA.filter((m) => (m.round ?? "").endsWith("半决赛"));
const pairs = semiA.map((m) => [m.teamAId, m.teamBId].sort().join("-")).sort();
check(
  "组内按种子位配对：一号对四号、二号对三号",
  JSON.stringify(pairs) === JSON.stringify(["A1-A4", "A2-A3"]),
  JSON.stringify(pairs),
);
check(
  "bracketOrderFromSeeds：4 队 → 1,4,2,3",
  JSON.stringify(bracketOrderFromSeeds(["s1", "s2", "s3", "s4"])) === JSON.stringify(["s1", "s4", "s2", "s3"]),
  JSON.stringify(bracketOrderFromSeeds(["s1", "s2", "s3", "s4"])),
);
check(
  "bracketOrderFromSeeds：8 队 → 1,8,4,5,2,7,3,6",
  JSON.stringify(bracketOrderFromSeeds(["1", "2", "3", "4", "5", "6", "7", "8"]))
    === JSON.stringify(["1", "8", "4", "5", "2", "7", "3", "6"]),
);

// 晋级连线：两场半决赛的胜者都要进该组决赛
// ⚠️「半决赛」也以「决赛」结尾 —— 只判 endsWith 会取到半决赛（测试自己踩过这个坑）
const finalA = groupA.find((m) => (m.round ?? "").endsWith("决赛") && !(m.round ?? "").endsWith("半决赛"))!;
check(
  "组内两场半决赛的胜者都被连到组内决赛（一 A 一 B）",
  semiA.every((m) => m.nextMatchId === finalA.id) && new Set(semiA.map((m) => m.nextSide)).size === 2,
  semiA.map((m) => `${m.id}→${m.nextMatchId}/${m.nextSide}`).join(" "),
);
check("组内决赛有前置条件（说明它是第二场）", Boolean(finalA.prerequisiteId));

check("队伍数不是 2 的幂时明确抛错", (() => {
  try {
    buildGroupSingleElimMatches([{ name: "X 组", teamIds: ["x1", "x2", "x3"] }], teamName);
    return false;
  } catch {
    return true;
  }
})());

// ── 组2 · 名次取数 ────────────────────────────────────────

group("组2 · 每组前两名 = 组内决赛的胜者与负者");

const completed = completeBySeedOrder(built);
const qualifiers = extractGroupSingleElimQualifiers(completed, "小组赛");

check("恰好取出 8 支晋级队伍", qualifiers.length === 8, `实际 ${qualifiers.length}`);
check(
  "每组一名第一 + 一名第二",
  qualifiers.filter((q) => q.placement === 1).length === 4
    && qualifiers.filter((q) => q.placement === 2).length === 4,
);
check(
  "组名正确（从轮次名里认组）",
  JSON.stringify([...new Set(qualifiers.map((q) => q.group))].sort()) === JSON.stringify(["A 组", "B 组", "C 组", "D 组"]),
  JSON.stringify([...new Set(qualifiers.map((q) => q.group))]),
);
// ★ 最容易写错的一处：只判 endsWith("决赛") 会把「半决赛」也算成出线战
check(
  "★ 半决赛不能被当成出线战（否则名次会多出一倍）",
  qualifiers.length === 8 && !qualifiers.some((q) => q.teamId === undefined),
);

const groupAWinners = qualifiers.filter((q) => q.group === "A 组");
check(
  "A 组第一 = A1（该组最强种子），第二 = A2（组内决赛的负者）",
  JSON.stringify(groupAWinners.map((q) => [q.placement, q.teamId]).sort())
    === JSON.stringify([[1, "A1"], [2, "A2"]]),
  JSON.stringify(groupAWinners.map((q) => [q.placement, q.teamId])),
);

check("决赛还没打完时不产生名次", (() => {
  const partial = built.map((m) => (m.round ?? "").endsWith("决赛") ? m : { ...m, status: "已完成" as const, winnerTeamId: m.teamAId });
  return extractGroupSingleElimQualifiers(partial, "小组赛").length === 0;
})());

check(
  "取出的 8 支能直接生成淘汰赛签位（4 个第一 + 4 个第二）",
  (() => {
    try {
      const order = buildKnockoutDrawOrder(qualifiers, () => 0.5);
      return order.length === 8 && new Set(order).size === 8;
    } catch {
      return false;
    }
  })(),
);

// ── 组3 · 赛制识别与门控 ──────────────────────────────────

group("组3 · 赛制识别与门控（小组赛该有 12 场，不是 20）");

const FOUR_STAGE_SEG: StageConfig[] = [
  { name: "资格赛", type: "single-elim", teamCount: 8, boType: "BO1" },
  { name: "入围赛", type: "single-elim", teamCount: 32, boType: "BO1" },
  { name: "小组赛", type: "single-elim-groups", teamCount: 16, groupCount: 4, boType: "BO3" },
  { name: "淘汰赛", type: "double-elim", teamCount: 8, boType: "BO3" },
];
const THREE_STAGE_SEG = FOUR_STAGE_SEG.slice(1);

check(
  "四阶段赛制：组内单败的小组赛被识别（不再是 unsupported）",
  resolveSupportedFormat(FOUR_STAGE_SEG).kind === "staged-playin",
  JSON.stringify(resolveSupportedFormat(FOUR_STAGE_SEG)),
);
check(
  "三阶段赛制：同样识别",
  resolveSupportedFormat(THREE_STAGE_SEG).kind === "staged-32-gsl-double-elim",
  JSON.stringify(resolveSupportedFormat(THREE_STAGE_SEG)),
);
check(
  "GSL 的小组赛仍然识别（不能为了新类型把旧的挤掉）",
  resolveSupportedFormat(FOUR_STAGE_SEG.map((s, i) => (i === 2 ? { ...s, type: "gsl-groups" as const } : s))).kind === "staged-playin",
);

const playinDone: ScheduleMatch[] = Array.from({ length: 16 }, (_, i) => ({
  id: `P${i}`, phase: "入围赛", round: "入围赛", boType: "BO1",
  teamAId: `t${i}a`, teamBId: `t${i}b`, teamAName: "甲", teamBName: "乙",
  startTime: "", endTime: "", status: "已完成", frozen: false, winnerTeamId: `t${i}a`,
}));

const gateReady = resolveStagedDrawGate(THREE_STAGE_SEG as [StageConfig, StageConfig, StageConfig], [], playinDone, []);
check(
  "入围赛 16 场打完 → 开放小组赛抽签（stageIndex 1）",
  gateReady.status === "ready" && gateReady.stageIndex === 1,
  JSON.stringify(gateReady.status),
);

// 12 场都已生成，但只打完 6 场 —— 这是「小组赛进行中」的真实状态
const groupMatchesAll = completed.filter((m) => m.phase === "小组赛");
check("夹具本身：小组赛恰好 12 场", groupMatchesAll.length === 12, `实际 ${groupMatchesAll.length}`);
const groupHalfDone: ScheduleMatch[] = groupMatchesAll.map((m, index) =>
  index < 6 ? m : { ...m, status: "已排期" as const, winnerTeamId: undefined });
const gateWaiting = resolveStagedDrawGate(
  THREE_STAGE_SEG as [StageConfig, StageConfig, StageConfig], [], [...playinDone, ...groupHalfDone], [],
);
check(
  "★ 小组赛打了 6 / 12 → 期望场次报 12（写死成 GSL 的 20 就会永远卡在「等待」）",
  gateWaiting.status === "waiting" && gateWaiting.totalMatches === 12,
  JSON.stringify(gateWaiting),
);

const gateKnockout = resolveStagedDrawGate(
  THREE_STAGE_SEG as [StageConfig, StageConfig, StageConfig], [], [...playinDone, ...completed], [],
);
// 联合类型要先收窄再取可选字段（tsx 不做类型检查，这类错只在 tsc 里暴露）
const knockoutReady = gateKnockout.status === "ready" ? gateKnockout : null;
check(
  "小组赛 12 场全部完成 → 取到 8 支队伍、开放淘汰赛抽签（stageIndex 2）",
  knockoutReady !== null && knockoutReady.stageIndex === 2
    && (knockoutReady.qualifiers?.length ?? 0) === 8,
  JSON.stringify({
    status: gateKnockout.status,
    index: gateKnockout.stageIndex,
    q: knockoutReady?.qualifiers?.length ?? 0,
  }),
);

// ── 组4 · 换赛制判定（这届的真实情形）─────────────────────

group("组4 · 赛制变更判定：已打完的阶段不动，未开打的阶段可改");

const currentStages: StageConfig[] = FOUR_STAGE_SEG.map((s, i) => (i === 2 ? { ...s, type: "gsl-groups" as const } : s));
const played: Array<{ phase: string }> = [
  ...Array.from({ length: 4 }, () => ({ phase: "资格赛" })),
  ...Array.from({ length: 16 }, () => ({ phase: "入围赛" })),
];

check(
  "★ 本届的真实情形：已打完资格赛 + 入围赛，把小组赛从 GSL 改成组内单败 → 放行",
  formatChangeRefusal(currentStages, FOUR_STAGE_SEG, played) === null,
  String(formatChangeRefusal(currentStages, FOUR_STAGE_SEG, played)),
);
check(
  "改**已经打过**的阶段（把入围赛 32 队改成 8 队）→ 拒绝",
  formatChangeRefusal(currentStages, currentStages.map((s, i) => (i === 1 ? { ...s, teamCount: 8 } : s)), played) !== null,
);
check(
  "改已打完阶段的晋级人数（下一阶段缩到 8 队）→ 拒绝",
  formatChangeRefusal(currentStages, currentStages.map((s, i) => (i === 2 ? { ...s, teamCount: 8 } : s)), played) !== null,
);
check(
  "删掉已打过比赛的阶段 → 拒绝，并点出是哪个阶段",
  (() => {
    const refusal = formatChangeRefusal(currentStages, currentStages.filter((_, i) => i !== 1), played);
    return refusal !== null && refusal.includes("入围赛");
  })(),
);
check(
  "还没有任何赛程 → 随便改都放行",
  formatChangeRefusal(currentStages, FOUR_STAGE_SEG, []) === null,
);
check(
  "改未开打的**淘汰赛**（8 队双败改成 8 队单败）→ 放行（它也确实没打过）",
  formatChangeRefusal(currentStages, currentStages.map((s, i) => (i === 3 ? { ...s, type: "single-elim" as const } : s)), played) === null,
);

// ── 组5 · 待排期骨架：能改，且能指出要清掉什么（2026-10-14 第三版判据）──

group("组5 · 只抽了签、一场没打的阶段允许换赛制（生成了 ≠ 用上了）");

const skeleton = [
  ...played,
  // 小组赛抽完签：20 场全是待排期、没有开赛时间
  ...Array.from({ length: 20 }, () => ({ phase: "小组赛", status: "待排期", startTime: "" })),
];
check(
  "★ 小组赛 20 场全是待排期骨架 → 换成组内单败：放行",
  formatChangeRefusal(currentStages, FOUR_STAGE_SEG, skeleton) === null,
  String(formatChangeRefusal(currentStages, FOUR_STAGE_SEG, skeleton)),
);
check(
  "并指出要清掉的是「小组赛」",
  JSON.stringify(unplayedStagesToClear(currentStages, FOUR_STAGE_SEG, skeleton)) === JSON.stringify(["小组赛"]),
  JSON.stringify(unplayedStagesToClear(currentStages, FOUR_STAGE_SEG, skeleton)),
);
check(
  "已打完的阶段不在清除清单里（资格赛/入围赛有赛果）",
  !unplayedStagesToClear(currentStages, FOUR_STAGE_SEG, skeleton).includes("入围赛"),
);
check(
  "★ 小组赛里只要有一场排过期 → 拒绝（排过期就是被用上了）",
  formatChangeRefusal(currentStages, FOUR_STAGE_SEG, [
    ...played,
    ...Array.from({ length: 19 }, () => ({ phase: "小组赛", status: "待排期", startTime: "" })),
    { phase: "小组赛", status: "已排期", startTime: "2026-10-20T12:00:00" },
  ]) !== null,
);
check(
  "有开赛时间但状态还是待排期 → 同样拒绝（保守）",
  formatChangeRefusal(currentStages, FOUR_STAGE_SEG, [
    ...played,
    { phase: "小组赛", status: "待排期", startTime: "2026-10-20T12:00:00" },
  ]) !== null,
);
check(
  "缺 status 的老数据按「已使用」保守处理 → 拒绝",
  formatChangeRefusal(currentStages, FOUR_STAGE_SEG, [...played, { phase: "小组赛" }]) !== null,
);
check(
  "赛制没变时不该清任何东西",
  unplayedStagesToClear(currentStages, currentStages, skeleton).length === 0,
);
check(
  "还没生成对阵的阶段不在清除清单里（它本来就没东西可清）",
  unplayedStagesToClear(
    currentStages.map((st, i) => (i === 2 ? { ...st, type: "single-elim-groups" as const } : st)),
    currentStages,
    played,
  ).length === 0,
);

// ── 组6 · 小组赛 → 淘汰赛的接续（P0：最后的未验证环节）─────────

group("组6 · 组内单败打完 → 淘汰赛抽签：签位、避让、14 场对阵与连线");

const knockoutOrder = buildKnockoutDrawOrder(qualifiers, () => 0.5);
check("抽签顺序是 8 支队伍的排列（不重不漏）", knockoutOrder.length === 8 && new Set(knockoutOrder).size === 8);
check(
  "四个小组第一全部在列",
  qualifiers.filter((q) => q.placement === 1).every((q) => knockoutOrder.includes(q.teamId)),
);
check(
  "四个小组第二全部在列",
  qualifiers.filter((q) => q.placement === 2).every((q) => knockoutOrder.includes(q.teamId)),
);

// ★ 同组的两支（第一与第二）首轮不能相遇：签位相邻成对（0-1 / 2-3 / 4-5 / 6-7）即相遇
const pairBucket = (teamId: string) => Math.floor(knockoutOrder.indexOf(teamId) / 2);
const groupsWithClash = ["A 组", "B 组", "C 组", "D 组"].filter((name) => {
  const first = qualifiers.find((q) => q.group === name && q.placement === 1);
  const second = qualifiers.find((q) => q.group === name && q.placement === 2);
  return !first || !second || pairBucket(first.teamId) === pairBucket(second.teamId);
});
check("★ 同组的两支队伍首轮不相遇（淘汰赛抽签的避让规则）", groupsWithClash.length === 0, JSON.stringify(groupsWithClash));

const knockoutMatches = buildDoubleEliminationMatches(knockoutOrder, teamName, {
  startIndex: 33,
  phase: "淘汰赛",
  boType: "BO3",
});
check("淘汰赛生成 14 场（8 队双败）", knockoutMatches.length === 14, `实际 ${knockoutMatches.length}`);
check("全部属于淘汰赛阶段", knockoutMatches.every((m) => m.phase === "淘汰赛"));
check("首轮 8 支队伍都落在对阵里", new Set(knockoutMatches.slice(0, 4).flatMap((m) => [m.teamAId, m.teamBId])).size === 8);
check(
  "晋级连线完整：除最终场外每场都有下一场指向",
  knockoutMatches.filter((m) => !m.nextMatchId && !m.nextLoserMatchId).length <= 1,
  JSON.stringify(knockoutMatches.filter((m) => !m.nextMatchId && !m.nextLoserMatchId).map((m) => m.id)),
);
const withLoserLink = knockoutMatches.filter((m) => Boolean(m.nextLoserMatchId));
check("双败结构：存在把败者送进败者组的连线", withLoserLink.length >= 4, `实际 ${withLoserLink.length}`);
check(
  "比赛 id 不与小组赛冲突（起始序号接在小组赛之后）",
  knockoutMatches.every((m) => !completed.some((g) => g.id === m.id)),
);

console.log("");
console.log(`结果：通过 ${pass} / ${pass + fail}`);
if (fail > 0) {
  console.error(`${fail} 项未通过`);
  process.exit(1);
}
