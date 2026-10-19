// =====================
// AIE-02 评测框架：评分与 Gate 门槛
//
// 两条硬约束：
//   1. **不依赖模型自报置信度**——本文件从头到尾没有读模型的 confidence 字段，
//      所有结论都来自「模型输出 vs 人工标注」的直接比对。
//   2. **确定性复核复用生产规则**——直接调 src/lib/scheduling 的 validateGames，
//      评测与线上用同一套 BO 校验，避免两边规则分叉后评测结果偏乐观。
// =====================

import { validateGames } from "../../../src/lib/domains/schedule/schedule-ops";
import type { GameResult } from "../../../src/lib/domains/schedule/schedule-data";
import type { CaseInput, CasePrediction, CaseTruth, ParsedGame, ParsedOutput, TruthGame } from "./types";

export type CaseStatus =
  | "correct" // 可用预填，且关键字段全对
  | "incorrect" // 可用预填，但字段有错
  | "refusedOk" // 模型拒答，且确实应当拒答
  | "refusedModel" // 模型拒答，但信息其实是够的（误拒）
  | "guessed" // 应当拒答，模型却给了具体答案
  | "parseError" // 输出无法解析成 schema
  | "schemaError" // 结构非法
  | "ruleRejected" // 确定性规则拒绝（如非法 BO）
  | "failed"; // 适配器失败、超时或无记录

export interface CaseEvaluation {
  caseId: string;
  groupId: string;
  category: string;
  split: string;
  status: CaseStatus;
  reason: string;
  /** 标注认为该案例是否应当拒答。用于把分母分成「有效样本」与「应拒答样本」。 */
  expectedRefusal: boolean;
  /** 确定性规则是否通过。可用但规则未过 = 管线漏放，属实现缺陷。 */
  rulesPassed: boolean;
  /** 断言了「标注为不可确定」的字段次数 */
  undeterminableAssertions: number;
  /** 严重虚构（应拒答却给答案） */
  severeFabrication: number;
  /** 逐局比分是否逐项正确 */
  gameScoreCorrect: boolean[];
  /** 逐局地图是否逐项正确（仅统计可确定的地图） */
  mapCorrect: boolean[];
  winnerCorrect: boolean | null;
  seriesCorrect: boolean | null;
  /**
   * 分组比对结果。为 null 表示这一例没有分组答案、或模型没输出分组。
   * 分开统计的理由：读对比分但把队分反，与读错比分，是两种不同的失败，
   * 修法也不同（前者改提示词里的颜色说明，后者才是识别能力问题）。
   */
  groupingCorrect: number | null;
  /** 忽略左右后的划分正确数。见 compareGroups 的说明。 */
  groupingPartitionCorrect: number | null;
  groupingTotal: number | null;
  /** 该案例是否产出可用预填 */
  usable: boolean;
  latencyMs: number | null;
  costUsd: number | null;
}

/** 分组比对结果 */
export interface GroupComparison {
  /** 定向正确数：昵称既在对的一组、也在对的一侧 */
  correct: number;
  /** 划分正确数：忽略左右，只看「10 个昵称有没有被正确分成那两组」 */
  partitionCorrect: number;
  total: number;
}

/**
 * 逐个昵称比对分组，同时给出「定向」与「划分」两个口径。
 *
 * 为什么要两个口径：有些输入**在图上根本没有区分左右的依据**。
 * 例如排位赛截图只有玩家昵称、没有队名，也没有提供双方名单，
 * 此时模型无从知道哪一组该叫 A、哪一组该叫 B——它只能确定「这 10 个人分成这两组」。
 * 只报定向口径会把「左右未定」误判成「分组错误」，那是评测口径的问题，不是模型能力问题。
 *
 * 生产场景不受此限：裁判报分时会提供两队队员名单，定向有确定依据，两个口径应当都达标。
 * 只统计人工标注里出现过的昵称，多报的不算分。
 */
export function compareGroups(
  truth: CaseTruth,
  parsed: ParsedOutput | null,
): GroupComparison | null {
  if (!truth.groups) return null;
  const expectedA = new Set(truth.groups.a);
  const expectedB = new Set(truth.groups.b);
  const total = expectedA.size + expectedB.size;
  if (total === 0) return null;
  if (!parsed || !parsed.groups) return { correct: 0, partitionCorrect: 0, total };

  const gotA = new Set(parsed.groups.a ?? []);
  const gotB = new Set(parsed.groups.b ?? []);

  let correct = 0;
  for (const name of expectedA) if (gotA.has(name)) correct += 1;
  for (const name of expectedB) if (gotB.has(name)) correct += 1;

  // 对调后再数一遍，取两者较高者作为「划分正确数」
  let swapped = 0;
  for (const name of expectedA) if (gotB.has(name)) swapped += 1;
  for (const name of expectedB) if (gotA.has(name)) swapped += 1;

  return { correct, partitionCorrect: Math.max(correct, swapped), total };
}

function ruleCheck(boType: string, games: ParsedGame[]): { ok: boolean; message?: string } {
  // 规则校验按 A/B 朝向判断「每局谁赢」——所以必须用**逐局的 winnerGroup** 把朝向还原回去。
  // 若一律把 winnerScore 放在 A 侧，会读成「A 赢下所有局」，BO3 变成 3:0 而被拒（踩过）。
  const payload: GameResult[] = games.map((g) => {
    const aWon = g.winnerGroup === "a";
    return {
      ...(g.map ? { map: g.map } : {}),
      teamAScore: aWon ? g.winnerScore : g.loserScore,
      teamBScore: aWon ? g.loserScore : g.winnerScore,
    };
  });
  return validateGames(payload, boType);
}

/**
 * 比分是否一致。
 *
 * 两侧朝向不同：truth 记的是 A/B（人知道哪支是 A 队），模型 v5 给的是「赢 / 输」。
 * 所以**先都折算成「高分 : 低分」再比** —— 朝向本身由下面的 winnerCorrect 单独评，
 * 这里只回答「两个数字读对没有」。
 */
function sameScore(truth: TruthGame, parsed: ParsedGame): boolean {
  const truthHigh = Math.max(truth.teamAScore, truth.teamBScore);
  const truthLow = Math.min(truth.teamAScore, truth.teamBScore);
  const parsedHigh = Math.max(parsed.winnerScore, parsed.loserScore);
  const parsedLow = Math.min(parsed.winnerScore, parsed.loserScore);
  return truthHigh === parsedHigh && truthLow === parsedLow;
}

function isUndeterminable(truth: CaseTruth, field: string): boolean {
  return truth.undeterminable.includes(field);
}

function countUndeterminableAssertions(truth: CaseTruth, prediction: CasePrediction): number {
  const parsed = prediction.parsed;
  if (!parsed) return 0;
  let count = 0;
  // 注意：truth.undeterminable 里写的字段名仍是 "winnerSide"（标注数据沿用旧名），
  // 但模型 v5 起输出的是 parsed.winnerGroup —— 语义相同（都是「胜方」），只是表示法不同。
  if (isUndeterminable(truth, "winnerSide") && parsed.winnerGroup !== null) count += 1;
  if (isUndeterminable(truth, "series") && parsed.series !== null) count += 1;
  for (const field of truth.undeterminable) {
    const match = /^games\[(\d+)\]\.map$/.exec(field);
    if (!match) continue;
    const index = Number(match[1]);
    if (parsed.games[index] && parsed.games[index].map) count += 1;
  }
  return count;
}

/**
 * 评估单个案例。没有预测记录时按 failed 处理——部分失败不能悄悄从分母里消失。
 */
export function evaluateCase(
  input: CaseInput,
  truth: CaseTruth,
  prediction: CasePrediction | null,
): CaseEvaluation {
  const base = {
    caseId: input.caseId,
    groupId: input.groupId,
    category: input.category,
    split: input.split,
    expectedRefusal: truth.shouldRefuse,
    rulesPassed: true,
    undeterminableAssertions: 0,
    severeFabrication: 0,
    gameScoreCorrect: [] as boolean[],
    mapCorrect: [] as boolean[],
    winnerCorrect: null as boolean | null,
    seriesCorrect: null as boolean | null,
    groupingCorrect: null as number | null,
    groupingPartitionCorrect: null as number | null,
    groupingTotal: null as number | null,
    usable: false,
    latencyMs: prediction?.latencyMs ?? null,
    costUsd: prediction?.usage?.costUsd ?? null,
  };

  if (!prediction) {
    return { ...base, status: "failed", reason: "无预测记录（适配器失败、超时或未执行）" };
  }
  if (prediction.validatorErrors.length > 0) {
    return { ...base, status: "schemaError", reason: prediction.validatorErrors.join("；") };
  }

  // 拒答必须排在解析之前判断：拒答是合法的终止状态，其 parsed 天然为空，
  // 若先判 parsed === null，会把每一次正确拒答都误记成解析错误。
  if (prediction.refused) {
    return truth.shouldRefuse
      ? { ...base, status: "refusedOk", reason: truth.refusalReason ?? "按标注应当拒答" }
      : { ...base, status: "refusedModel", reason: prediction.refusedReason ?? "模型拒答但信息其实充足" };
  }
  if (prediction.parsed === null) {
    return { ...base, status: "parseError", reason: prediction.parseError ?? "输出无法解析" };
  }

  const parsed = prediction.parsed;

  // 应当拒答却给了答案 → 严重虚构
  if (truth.shouldRefuse) {
    const asserted = (parsed.games.length > 0 ? 1 : 0) + (parsed.winnerGroup ? 1 : 0) + (parsed.series ? 1 : 0);
    return {
      ...base,
      status: "guessed",
      reason: `应当拒答却给出 ${asserted} 项具体答案`,
      severeFabrication: 1,
      undeterminableAssertions: countUndeterminableAssertions(truth, prediction),
    };
  }

  // 确定性规则复核：拒绝即不可用，且必须被记为规则冲突
  const rules = ruleCheck(input.boType, parsed.games);
  if (!rules.ok) {
    return { ...base, status: "ruleRejected", rulesPassed: false, reason: rules.message ?? "违反 BO 规则" };
  }

  // 字段级比对
  const gameScoreCorrect: boolean[] = [];
  const mapCorrect: boolean[] = [];
  const maxLen = Math.max(parsed.games.length, truth.games.length);
  for (let i = 0; i < maxLen; i += 1) {
    const truthGame = truth.games[i];
    const parsedGame = parsed.games[i];
    if (!truthGame || !parsedGame) {
      gameScoreCorrect.push(false);
      mapCorrect.push(false);
      continue;
    }
    gameScoreCorrect.push(sameScore(truthGame, parsedGame));
    if (truthGame.map !== null && !isUndeterminable(truth, `games[${i}].map`)) {
      mapCorrect.push(truthGame.map === parsedGame.map);
    }
  }

  // truth 里标注的是 A/B（人知道哪支是 A 队），模型给的是 a/b 组号 —— 大小写归一后比较。
  const winnerCorrect = truth.winnerSide !== null && !isUndeterminable(truth, "winnerSide")
    ? parsed.winnerGroup === truth.winnerSide.toLowerCase()
    : null;
  const seriesCorrect = truth.series !== null && !isUndeterminable(truth, "series")
    ? parsed.series !== null && parsed.series.a === truth.series.a && parsed.series.b === truth.series.b
    : null;

  const allCorrect = gameScoreCorrect.every(Boolean)
    && mapCorrect.every(Boolean)
    && winnerCorrect !== false
    && seriesCorrect !== false;

  const grouping = compareGroups(truth, parsed);

  return {
    ...base,
    status: allCorrect ? "correct" : "incorrect",
    reason: allCorrect ? "关键字段全部正确" : "存在字段不匹配",
    undeterminableAssertions: countUndeterminableAssertions(truth, prediction),
    gameScoreCorrect,
    mapCorrect,
    winnerCorrect,
    seriesCorrect,
    groupingCorrect: grouping ? grouping.correct : null,
    groupingPartitionCorrect: grouping ? grouping.partitionCorrect : null,
    groupingTotal: grouping ? grouping.total : null,
    usable: true,
  };
}

export interface Rate {
  correct: number;
  total: number;
  rate: number | null;
}

function rate(correct: number, total: number): Rate {
  return { correct, total, rate: total === 0 ? null : correct / total };
}

export interface ReductionModel {
  /** 人工逐局录入的操作次数：地图选择 + 两个比分 */
  perGameInputs: number;
  /** 系列级固定操作：确认胜者 + 提交 */
  perSeriesInputs: number;
}

export const DEFAULT_REDUCTION_MODEL: ReductionModel = { perGameInputs: 3, perSeriesInputs: 2 };

export interface ManualBaseline {
  /** 人工手工填写的中位秒数，来自负责人亲历数据 */
  medianSeconds: { BO1: number; BO3: number; BO5: number };
  source: string;
}

export interface AggregateOptions {
  reductionModel?: ReductionModel;
  manualBaseline?: ManualBaseline;
  /** 失败是否来自可修正的输入规范或提示词问题 */
  retestable?: boolean;
  /** 隐私或成本上的阻断问题；非空则直接 Stop */
  blockingSafetyIssue?: string | null;
}

export interface ArmMetrics {
  caseCount: number;
  byStatus: Record<CaseStatus, number>;
  /** 信息充足、应当出结果的有效样本数 */
  validCaseCount: number;
  /** 标注认为应当拒答的样本数 */
  refusalCaseCount: number;
  winner: Rate;
  series: Rate;
  gameScore: Rate;
  map: Rate;
  caseAllCorrect: Rate;
  usablePrefill: Rate;
  /** 应拒答案例中正确拒答的比例 */
  correctRefusal: Rate;
  /** 信息充足却拒答的比例（误拒） */
  falseRefusal: Rate;
  severeFabrication: number;
  undeterminableAssertions: number;
  /** 规则层拦下的非法 BO 次数 */
  illegalProduced: number;
  illegalWronglyAccepted: number;
  /** 未被规则发现的事实错误（字段错但规则通过） */
  unstampedErrors: number;
  /** 分组准确率（定向）：既在对的一组、也在对的一侧。需要输入提供队名/名单才有意义。 */
  grouping: Rate;
  /** 分组划分准确率：忽略左右。不依赖输入是否提供名单，更接近「能不能正确分两组」。 */
  groupingPartition: Rate;
  /** 分组被算反的案例数（对调两侧即全部正确）——与「随便归」区分开 */
  groupingSwappedCases: number;
  theoreticalReduction: number;
  latency: { p50: number | null; p95: number | null };
  totalCostUsd: number;
}

const STATUS_KEYS: CaseStatus[] = [
  "correct",
  "incorrect",
  "refusedOk",
  "refusedModel",
  "guessed",
  "parseError",
  "schemaError",
  "ruleRejected",
  "failed",
];

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

export function aggregate(evaluations: CaseEvaluation[], options: AggregateOptions = {}): ArmMetrics {
  const model = options.reductionModel ?? DEFAULT_REDUCTION_MODEL;
  const byStatus = Object.fromEntries(STATUS_KEYS.map((s) => [s, 0])) as Record<CaseStatus, number>;
  for (const item of evaluations) byStatus[item.status] += 1;

  // 分母必须分开：
  //   有效样本 = 标注认为信息充足、应当出结果的案例
  //   应拒答样本 = 无效输入或关键信息不足
  // 把两者混在一个分母里，会同时低估「可用预填」和高估「拒答能力」。
  const validCases = evaluations.filter((e) => !e.expectedRefusal);
  const refusalCases = evaluations.filter((e) => e.expectedRefusal);

  let winnerCorrect = 0;
  let winnerTotal = 0;
  let seriesCorrect = 0;
  let seriesTotal = 0;
  let gameCorrect = 0;
  let gameTotal = 0;
  let mapCorrect = 0;
  let mapTotal = 0;
  let allCorrect = 0;
  let usable = 0;
  let reductionSum = 0;
  let reductionCount = 0;

  for (const item of evaluations) {
    if (item.winnerCorrect !== null) {
      winnerTotal += 1;
      if (item.winnerCorrect) winnerCorrect += 1;
    }
    if (item.seriesCorrect !== null) {
      seriesTotal += 1;
      if (item.seriesCorrect) seriesCorrect += 1;
    }
    for (const flag of item.gameScoreCorrect) {
      gameTotal += 1;
      if (flag) gameCorrect += 1;
    }
    for (const flag of item.mapCorrect) {
      mapTotal += 1;
      if (flag) mapCorrect += 1;
    }
    if (item.status === "correct") allCorrect += 1;
    if (item.usable) usable += 1;

    // 理论字段削减：仅在预填可用时成立；不可用则记 0（人工仍需全填）
    const gameCount = Math.max(item.gameScoreCorrect.length, 1);
    const withoutAi = model.perGameInputs * gameCount + model.perSeriesInputs;
    const reduction = item.usable ? 1 - model.perSeriesInputs / withoutAi : 0;
    reductionSum += reduction;
    reductionCount += 1;
  }

  const latencies = evaluations.map((e) => e.latencyMs).filter((v): v is number => typeof v === "number");
  const costs = evaluations.map((e) => e.costUsd).filter((v): v is number => typeof v === "number");

  let groupingCorrect = 0;
  let groupingPartition = 0;
  let groupingTotal = 0;
  let groupingSwapped = 0;
  for (const item of evaluations) {
    if (item.groupingTotal === null) continue;
    groupingCorrect += item.groupingCorrect ?? 0;
    groupingPartition += item.groupingPartitionCorrect ?? 0;
    groupingTotal += item.groupingTotal;
    // 完全归错且两侧人数与答案一致 → 大概率是把两侧整体对调了，属特定失败模式
    if (item.groupingCorrect === 0 && item.groupingTotal > 0) groupingSwapped += 1;
  }

  return {
    caseCount: evaluations.length,
    byStatus,
    validCaseCount: validCases.length,
    refusalCaseCount: refusalCases.length,
    winner: rate(winnerCorrect, winnerTotal),
    series: rate(seriesCorrect, seriesTotal),
    gameScore: rate(gameCorrect, gameTotal),
    map: rate(mapCorrect, mapTotal),
    caseAllCorrect: rate(allCorrect, usable),
    usablePrefill: rate(usable, validCases.length),
    correctRefusal: rate(byStatus.refusedOk, refusalCases.length),
    falseRefusal: rate(byStatus.refusedModel, validCases.length),
    severeFabrication: evaluations.reduce((sum, e) => sum + e.severeFabrication, 0),
    undeterminableAssertions: evaluations.reduce((sum, e) => sum + e.undeterminableAssertions, 0),
    illegalProduced: byStatus.ruleRejected,
    // 结构不变式：可用却未过规则的案例数应恒为 0。放在这里是为了在管线被改坏时能被测试抓到。
    illegalWronglyAccepted: evaluations.filter((e) => e.usable && !e.rulesPassed).length,
    unstampedErrors: byStatus.incorrect,
    grouping: rate(groupingCorrect, groupingTotal),
    groupingPartition: rate(groupingPartition, groupingTotal),
    groupingSwappedCases: groupingSwapped,
    theoreticalReduction: reductionCount === 0 ? 0 : reductionSum / reductionCount,
    latency: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
    totalCostUsd: costs.reduce((sum, v) => sum + v, 0),
  };
}

export interface GateItem {
  id: string;
  requirement: string;
  actual: string;
  pass: boolean;
}

export interface GateResult {
  items: GateItem[];
  passed: boolean;
}

function ratePass(label: string, r: Rate, threshold: number): GateItem {
  const actual = r.rate === null ? "无样本" : `${(r.rate * 100).toFixed(1)}%（${r.correct}/${r.total}）`;
  return { id: label, requirement: `≥ ${(threshold * 100).toFixed(0)}%`, actual, pass: r.rate === null || r.rate >= threshold };
}

/**
 * 新增指标专用的判定：没有样本时明确标为「不适用」，而不是算通过或失败。
 * 缺样本本身由数据集体量检查（checkDatasetCoverage）负责提示，
 * 不该在这里被伪装成一次「通过」。
 */
function ratePassOrSkip(label: string, r: Rate, threshold: number): GateItem {
  if (r.total === 0) {
    return { id: label, requirement: `≥ ${(threshold * 100).toFixed(0)}%`, actual: "不适用（本批未标注该项）", pass: true };
  }
  return ratePass(label, r, threshold);
}

/** Gate AI-2 硬门槛，逐条判定，不允许用「总体感觉不错」代替 */
export function evaluateGate(metrics: ArmMetrics): GateResult {
  const items: GateItem[] = [
    ratePass("胜方精确匹配率", metrics.winner, 0.98),
    ratePass("系列大比分精确匹配率", metrics.series, 0.98),
    ratePass("单局比分精确匹配率", metrics.gameScore, 0.95),
    ratePass("地图精确匹配率", metrics.map, 0.95),
    {
      id: "关键信息不足时不得猜测",
      requirement: "0 次",
      actual: `${metrics.severeFabrication + metrics.undeterminableAssertions} 次`,
      pass: metrics.severeFabrication + metrics.undeterminableAssertions === 0,
    },
    {
      id: "严重虚构事实",
      requirement: "0 次",
      actual: `${metrics.severeFabrication} 次`,
      pass: metrics.severeFabrication === 0,
    },
    ratePass("可用预填比例", metrics.usablePrefill, 0.8),
    {
      id: "非法 BO 结果被规则拦截",
      requirement: "100%",
      actual: metrics.illegalWronglyAccepted === 0
        ? `拦下 ${metrics.illegalProduced} 次，误放 ${metrics.illegalWronglyAccepted} 次`
        : `误放 ${metrics.illegalWronglyAccepted} 次`,
      pass: metrics.illegalWronglyAccepted === 0,
    },
    {
      id: "可减少的手工字段比例",
      requirement: "≥ 50%",
      actual: `${(metrics.theoreticalReduction * 100).toFixed(1)}%`,
      pass: metrics.theoreticalReduction >= 0.5,
    },
    // 以下为框架新增项，不在原计划的 Gate 清单里。加它的理由来自真实截图：
    // 结算表底色有三种（两队 + 截图者自己那行），分错队会把比分填反，
    // 而分反与读错在结果上同样致命、修法却不同，必须单独量。
    //
    // 门槛用「划分」口径（忽略左右）而不是「定向」口径，理由：
    // 定向需要输入提供队名或双方名单作为依据。排位赛截图两者都没有，
    // 此时左右本就无从确定，用定向率做门槛会把「输入不足」误判成模型失败。
    // 生产场景会提供双方名单，定向率另在报告里如实给出，供对照。
    ratePassOrSkip("昵称分组划分准确率（新增项）", metrics.groupingPartition, 0.98),
  ];
  return { items, passed: items.every((i) => i.pass) };
}

export type Decision = "Go" | "Retest" | "No-Go" | "Stop";

export interface DecisionResult {
  decision: Decision;
  reason: string;
}

/** 决策规则，对齐工作包 §5「决策输出」 */
export function decide(gate: GateResult, metrics: ArmMetrics, options: AggregateOptions = {}): DecisionResult {
  if (options.blockingSafetyIssue) {
    return { decision: "Stop", reason: `存在不可接受的安全或成本问题：${options.blockingSafetyIssue}` };
  }
  if (metrics.severeFabrication > 0) {
    return { decision: "Stop", reason: `出现 ${metrics.severeFabrication} 次严重虚构，属事实安全问题` };
  }
  if (gate.passed) return { decision: "Go", reason: "全部门槛通过，可进入影子运行设计" };
  const failed = gate.items.filter((i) => !i.pass).map((i) => i.id);
  if (options.retestable) {
    return { decision: "Retest", reason: `未通过：${failed.join("、")}；判定为输入规范或提示词可修正` };
  }
  return { decision: "No-Go", reason: `未通过：${failed.join("、")}` };
}
