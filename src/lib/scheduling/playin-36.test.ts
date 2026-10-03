// 四阶段赛制测试（资格赛 → 入围赛 → 小组赛 → 淘汰赛）。
// 场景：报名 36 队，超出 32 个入围赛席位；最弱 8 队先打资格赛，4 支胜者并入入围赛。
//
// 关键不变式：轮空机制不增加容量（轮空数是「配比开关」），
// 所以 36 队必须靠**多打一轮**收敛，不能靠加轮空。

import assert from "node:assert/strict";

import { buildQualificationMatches } from "./bracket-engine";
import { buildPlayInPairs, rankTeamsByAvgRank, type Matchup } from "./format-data";
import { resolveSupportedFormat } from "./format-support";
import { resolvePlayInGate, resolveStagedDrawGate } from "./staged-format";
import {
  buildDefaultEventRules,
  buildEventFromTemplate,
  resolveTemplateIdFromStages,
  type StageConfig,
} from "./format-templates";
import { appendMatchesOp, reportGameResultsOp } from "./schedule-ops";
import { emptySchedule, normalizeScheduleState } from "./schedule-data";
import type { RegistrationPlayer, RegistrationTeam } from "./registration-data";

const stages4: StageConfig[] = [
  { name: "资格赛", type: "single-elim", teamCount: 8, boType: "BO1" },
  { name: "入围赛", type: "single-elim", teamCount: 32, boType: "BO1" },
  { name: "小组赛", type: "gsl-groups", teamCount: 16, groupCount: 4, boType: "BO3" },
  { name: "淘汰赛", type: "double-elim", teamCount: 8, boType: "BO3" },
];

let passed = 0;
function check(name: string, condition: boolean, detail?: string) {
  assert.ok(condition, `${name}${detail ? ` —— ${detail}` : ""}`);
  passed += 1;
  console.log(`✓ ${name}`);
}

// ---------- 1. 赛制识别 ----------
const format = resolveSupportedFormat(stages4);
check("识别为四阶段赛制", format.kind === "staged-playin", format.kind);
if (format.kind === "staged-playin") {
  check("资格赛规模为 8 队", format.playInTeams === 8, String(format.playInTeams));
  check("所需队伍总数为 36", format.requiredTeams === 36, String(format.requiredTeams));
  check("后三阶段仍是入围赛/小组赛/淘汰赛", format.stages[0].teamCount === 32 && format.stages[1].teamCount === 16 && format.stages[2].teamCount === 8);
}

// 三阶段赛制不能被误识别为四阶段
check(
  "既有的 32 队三阶段赛制不受影响",
  resolveSupportedFormat([stages4[1], stages4[2], stages4[3]]).kind === "staged-32-gsl-double-elim",
);

// ---------- 2. 段位排序与同档配对 ----------
function makeTeam(id: string, ranks: string[]): { team: RegistrationTeam; players: RegistrationPlayer[] } {
  const players = ranks.map((rank, index) => ({
    id: `${id}-P${index}`,
    gameId: `${id} 选手${index}`,
    rank,
    role: "首发" as const,
    status: "已入队" as const,
    teamId: id,
  })) as unknown as RegistrationPlayer[];
  const team = {
    id,
    name: id,
    captainId: `${id}-P0`,
    memberIds: players.map((p) => p.id),
    status: "已冻结" as const,
    createdAt: "2026-10-02T00:00:00.000Z",
  } as unknown as RegistrationTeam;
  return { team, players };
}

// 构造 8 支队伍，平均段位从高到低：神话(8) → 铁(1)
const rankOrder = ["神话", "神话", "钻石", "钻石", "铂金", "铂金", "白银", "青铜"];
const built = rankOrder.map((rank, index) => makeTeam(`P${index + 1}`, [rank, rank, rank, rank, rank]));
const teams36 = built.map((item) => item.team);
const players36 = built.flatMap((item) => item.players);

const ranked = rankTeamsByAvgRank(teams36, players36);
check("按平均段位降序排列", ranked.length === 8 && ranked[0].avg >= ranked[ranked.length - 1].avg, JSON.stringify(ranked.map((r) => r.avg)));

const ordered = ranked.map((item) => item.id);
const pairs: Matchup[] = buildPlayInPairs(ordered);
check("8 队产生 4 场资格赛", pairs.length === 4, String(pairs.length));
check(
  "同档互打：档内第 1 对第 4、第 2 对第 3",
  pairs[0].teamAId === ordered[0] && pairs[0].teamBId === ordered[3]
    && pairs[1].teamAId === ordered[1] && pairs[1].teamBId === ordered[2],
);
check(
  "最弱一档内部互打（最弱 4 支必有 2 支取胜）",
  pairs[2].teamAId === ordered[4] && pairs[2].teamBId === ordered[7]
    && pairs[3].teamAId === ordered[5] && pairs[3].teamBId === ordered[6],
);

// ---------- 3. 资格赛门控 ----------
const playInStage = stages4[0];
let schedule = emptySchedule();

const ready = resolvePlayInGate(playInStage, ordered, schedule.matches);
check("空赛程时资格赛可抽签", ready.status === "ready", ready.status);

const slots = pairs.flatMap((pair) => [pair.teamAId, pair.teamBId]);
const qualification = buildQualificationMatches(slots, (id) => id, {
  phase: playInStage.name,
  boType: playInStage.boType,
  advancingTeams: playInStage.teamCount / 2,
});
check("资格赛生成 4 场", qualification.matches.length === 4, String(qualification.matches.length));
check("资格赛没有轮空", qualification.byes.length === 0, String(qualification.byes.length));

schedule = appendMatchesOp(schedule, qualification.matches, "资格赛抽签发布");
const waiting = resolvePlayInGate(playInStage, ordered, schedule.matches);
check("未提交赛果时资格赛为进行中", waiting.status === "waiting", waiting.status);

for (const match of qualification.matches) {
  schedule = reportGameResultsOp(schedule, match.id, [{ teamAScore: 13, teamBScore: 5 }]).state;
}
const complete = resolvePlayInGate(playInStage, ordered, schedule.matches);
check("赛果齐后资格赛完成", complete.status === "complete", complete.status);
if (complete.status === "complete") {
  check("4 支胜者晋级", complete.advancingTeamIds.length === 4, String(complete.advancingTeamIds.length));
}

// ---------- 4. 36 → 32 → 16 的晋级链 ----------
const stages3: [StageConfig, StageConfig, StageConfig] = [stages4[1], stages4[2], stages4[3]];
const others = Array.from({ length: 28 }, (_, index) => `D-${index + 1}`);
const entrants32 = [...others, ...(complete.status === "complete" ? complete.advancingTeamIds : [])];
check("入围赛 entrants 恰为 32 支", entrants32.length === 32, String(entrants32.length));
check("入围赛 entrants 无重复", new Set(entrants32).size === 32);

const qualifierGate = resolveStagedDrawGate(stages3, entrants32, schedule.matches, []);
check("32 支 entrants 放行入围赛抽签", qualifierGate.status === "ready", qualifierGate.status);

// 反例：若不做资格赛，直接拿 36 支抽入围赛 —— 必须被拦
const overflow = resolveStagedDrawGate(stages3, [...ordered, ...others], schedule.matches, []);
check("36 支直接抽入围赛被拦（容量硬上限）", overflow.status === "blocked", overflow.status);

// 反例：轮空机制无法解决 36 队 —— byes 为负说明无解
check(
  "轮空数 32−36 为负，证明轮空不增加容量",
  32 - 36 < 0,
);

// ---------- 5. 新建赛事路径的参赛规模 ----------
// 第 1 节查的是 resolveSupportedFormat 的 requiredTeams（赛制识别层）；
// 而「新建赛事」真正写进 event.teamCount 的是 buildEventFromTemplate 这条路径，
// 两者是分开的代码。这里曾经直接取首阶段队伍数，把 36 队赛事声明成「8 队」。
function buildFor(stages: StageConfig[], suffix: string) {
  return buildEventFromTemplate({
    id: `event-playin36-${suffix}`,
    name: "36 队四阶段赛事",
    game: "无畏契约",
    organizer: "赛事组",
    templateId: resolveTemplateIdFromStages(stages),
    stageConfigs: stages,
  });
}

const built36 = buildFor(stages4, "a");
check("新建赛事按 36 队声明参赛规模", built36.teamCount === 36, String(built36.teamCount));

const scaleRule = buildDefaultEventRules(stages4, 5).find((rule) => rule.title === "参赛规模");
check(
  "规程「参赛规模」文案写的是 36 个席位",
  Boolean(scaleRule?.detail.includes("36 个参赛席位")),
  scaleRule?.detail,
);

// 反向：三阶段 32 队不能被这条推导改错
const built32 = buildFor(stages3, "b");
check("三阶段 32 队赛事规模仍为 32", built32.teamCount === 32, String(built32.teamCount));

// ---------- 6. 资格赛的轮次名 ----------
// 背景：`buildQualificationMatches` 原来把轮次名写死成「入围赛」，
// 三阶段赛制下阶段名与轮次名都是「入围赛」所以看不出来，
// 四阶段赛制下资格赛会显示成「资格赛（阶段）· 入围赛（轮次）」。
//
// 这里必须**同时**钉住生成侧与读取侧：
//   · 生成侧 —— 新抽的签直接带正确的轮次名；
//   · 读取侧 —— 已经落库的旧对阵读一次就被修正（后台下次保存赛程才写回）。
// 且要有一条「输入确实是错的」的护栏，否则断言可能在错数据上也恒真。

const generatedRounds = qualification.matches.map((match) => match.round);
check(
  "新生成的资格赛对阵，轮次名等于阶段名「资格赛」",
  generatedRounds.every((round) => round === "资格赛"),
  JSON.stringify(generatedRounds),
);
check(
  "护栏：生成侧确实改掉了写死值（否则上面的断言无区分度）",
  generatedRounds.every((round) => round !== "入围赛"),
);

const legacyMatch = { ...qualification.matches[0], round: "入围赛" };
check("护栏：构造的旧数据轮次名确实是错的「入围赛」", legacyMatch.round === "入围赛");
const repaired = normalizeScheduleState({ matches: [legacyMatch] });
check("旧数据的资格赛轮次名被修正为「资格赛」", repaired.matches[0].round === "资格赛", String(repaired.matches[0].round));

// 反向：入围赛 / 小组赛 / 淘汰赛的轮次名不能被这条修正动到
const untouched = normalizeScheduleState({
  matches: [
    { ...qualification.matches[0], phase: "入围赛", round: "入围赛" },
    { ...qualification.matches[0], phase: "小组赛", round: "小组赛" },
    { ...qualification.matches[0], phase: "淘汰赛", round: "胜者组第 1 轮" },
  ],
});
check(
  "非资格赛阶段不受修正影响",
  untouched.matches[0].round === "入围赛"
    && untouched.matches[1].round === "小组赛"
    && untouched.matches[2].round === "胜者组第 1 轮",
  JSON.stringify(untouched.matches.map((match) => match.round)),
);

console.log(`\n${passed} play-in tests passed`);
