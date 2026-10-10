// =====================
// AIE-02 赛果识别离线评测框架测试
// 运行：npm run test:ai-result-eval
//
// 全部离线：不需要密钥、不访问网络、不读生产数据。
// 视觉适配器的网络路径通过注入 fetch 覆盖。
// =====================

import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createFormBaselineAdapter,
  createMockAdapter,
  createVisionAdapter,
  extractJson,
  normalizeModelJson,
} from "./adapters";
import {
  DEFAULT_REDUCTION_MODEL,
  aggregate,
  decide,
  evaluateCase,
  evaluateGate,
  type CaseEvaluation,
} from "./metrics";
import { checkDatasetCoverage, validateManifest, validateParsedOutput, validateTruthFile } from "./schema";
import { EXAMPLE_DATASET, executeRun, scoreRun } from "./run-eval";
import type { CaseInput, CasePrediction, CaseTruth, ParsedOutput } from "./types";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `（${detail}）` : ""}`); }
}

// ---------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------

const TEAMS = { a: "甲队", b: "乙队" };

function input(overrides: Partial<CaseInput> = {}): CaseInput {
  return {
    caseId: "c1",
    groupId: "g1",
    split: "dev",
    category: "clear",
    game: "valorant",
    pageType: "赛后结算页",
    boType: "BO3",
    teams: TEAMS,
    squads: {
      a: ["甲一号", "甲二号", "甲三号", "甲四号", "甲五号"],
      b: ["乙一号", "乙二号", "乙三号", "乙四号", "乙五号"],
    },
    knownMaps: ["亚海悬城", "源工重镇", "隐士修所"],
    images: [{ file: "c1.png", order: 1 }],
    privacy: { containsPii: false, redaction: "无" },
    ...overrides,
  };
}

function truth(overrides: Partial<CaseTruth> = {}): CaseTruth {
  return {
    caseId: "c1",
    shouldRefuse: false,
    undeterminable: [],
    series: { a: 2, b: 0 },
    // 人工标注用 A/B（人知道哪支是 A 队）；只有「模型输出」才是 a/b 组号。
    winnerSide: "A",
    games: [
      { map: "亚海悬城", teamAScore: 13, teamBScore: 7 },
      { map: "源工重镇", teamAScore: 13, teamBScore: 9 },
    ],
    illegalBo: false,
    annotatedBy: ["甲", "乙"],
    ...overrides,
  };
}

/**
 * 测试里写「模型输出」时允许沿用旧记法（`winnerSide` + `teamAScore/teamBScore`），
 * 在这里统一归一成 v5 的 `ParsedOutput`（`winnerGroup` + `winnerScore/loserScore`）。
 *
 * 为什么不把 40 多处调用点全部改写：那些调用点关心的是**评分逻辑**，不是字段拼写；
 * 在这里做一次归一，测试意图更清楚，也免得漏改一处就静默失真。
 */
type LegacyParsedInput = {
  series?: { a: number; b: number } | null;
  winnerSide?: "A" | "B" | null;
  winnerGroup?: "a" | "b" | null;
  games?: Array<{
    map?: string | null;
    teamAScore?: number;
    teamBScore?: number;
    winnerGroup?: "a" | "b";
    winnerScore?: number;
    loserScore?: number;
  }>;
  groups?: { a: string[]; b: string[] } | null;
};

function toParsedOutput(input: LegacyParsedInput): ParsedOutput {
  return {
    series: input.series ?? null,
    winnerGroup: input.winnerGroup
      ?? (input.winnerSide ? (input.winnerSide.toLowerCase() as "a" | "b") : null),
    games: (input.games ?? []).map((g) => {
      const a = g.teamAScore ?? 0;
      const b = g.teamBScore ?? 0;
      // 逐局胜方：显式给了就用，否则按「A 侧分高即 a 组赢」推（测试场景都是 A 赢）
      const group: "a" | "b" = g.winnerGroup === "b" ? "b" : "a";
      return {
        map: g.map ?? null,
        winnerGroup: group,
        winnerScore: g.winnerScore ?? Math.max(a, b),
        loserScore: g.loserScore ?? Math.min(a, b),
      };
    }),
    groups: input.groups ?? null,
  };
}

function prediction(parsed: LegacyParsedInput | null, overrides: Partial<CasePrediction> = {}): CasePrediction {
  return {
    caseId: "c1",
    armId: "test",
    provider: "test",
    model: "test",
    promptVersion: "v1",
    schemaVersion: "result-vision-1",
    startedAt: new Date(0).toISOString(),
    latencyMs: 1000,
    usage: {},
    refused: false,
    refusedReason: null,
    parsed: parsed ? toParsedOutput(parsed) : null,
    parseError: null,
    validatorErrors: [],
    ...overrides,
  };
}

const GOOD_PARSED = {
  series: { a: 2, b: 0 },
  winnerGroup: "a" as const,
  games: [
    { map: "亚海悬城", winnerGroup: "a" as const, winnerScore: 13, loserScore: 7 },
    { map: "源工重镇", winnerGroup: "a" as const, winnerScore: 13, loserScore: 9 },
  ],
};

function evaluate(
  parsed: CasePrediction["parsed"],
  truthOverrides: Partial<CaseTruth> = {},
  predictionOverrides: Partial<CasePrediction> = {},
): CaseEvaluation {
  return evaluateCase(input(), truth(truthOverrides), prediction(parsed, predictionOverrides));
}

console.log("\n== 组1 · manifest 校验（只报问题，不修补）==");
{
  const ok = validateManifest({
    schemaVersion: 1,
    datasetId: "t",
    cases: [input()],
  }, false);
  check("合法 manifest 通过", ok.length === 0, ok.join("；"));

  const withAnswer = validateManifest({
    schemaVersion: 1,
    datasetId: "t",
    cases: [{ ...input(), series: { a: 1, b: 0 } }],
  }, false);
  check("输入携带答案字段被拒", withAnswer.some((p) => p.includes("疑似答案字段")), withAnswer.join("；"));

  const badSplit = validateManifest({
    schemaVersion: 1,
    datasetId: "t",
    cases: [{ ...input(), split: "unknown" }],
  }, false);
  check("split 非法被拒", badSplit.some((p) => p.includes("split")), badSplit.join("；"));

  const badBo = validateManifest({
    schemaVersion: 1,
    datasetId: "t",
    cases: [{ ...input(), boType: "BO7" }],
  }, false);
  check("boType 非法被拒", badBo.some((p) => p.includes("boType")), badBo.join("；"));

  const noImages = validateManifest({
    schemaVersion: 1,
    datasetId: "t",
    cases: [{ ...input(), images: [] }],
  }, true);
  check("要求图片时 images 为空被拒", noImages.some((p) => p.includes("images 为空")), noImages.join("；"));

  const sameOrder = validateManifest({
    schemaVersion: 1,
    datasetId: "t",
    cases: [{ ...input(), images: [{ file: "a.png", order: 1 }, { file: "b.png", order: 1 }] }],
  }, false);
  check("图片顺序重复被拒", sameOrder.some((p) => p.includes("order 重复")), sameOrder.join("；"));

  const dupId = validateManifest({
    schemaVersion: 1,
    datasetId: "t",
    cases: [input(), input()],
  }, false);
  check("caseId 重复被拒", dupId.some((p) => p.includes("caseId 重复")), dupId.join("；"));

  const wrongVersion = validateManifest({ schemaVersion: 9, datasetId: "t", cases: [input()] }, false);
  check("schemaVersion 不符被拒", wrongVersion.some((p) => p.includes("schemaVersion")), wrongVersion.join("；"));

  // 截图只显示昵称，报名存的是「昵称#标签」。带上 # 说明没规范化，匹配必然失败。
  const rawTag = validateManifest({
    schemaVersion: 1,
    datasetId: "t",
    cases: [{ ...input(), squads: { a: ["甲一号#12345", "甲二号"], b: ["乙一号"] } }],
  }, false);
  check("队员昵称未去掉 # 标签被拒", rawTag.some((p) => p.includes("未去掉 # 标签")), rawTag.join("；"));

  const badSquad = validateManifest({
    schemaVersion: 1,
    datasetId: "t",
    cases: [{ ...input(), squads: { a: "不是数组", b: [] } }],
  }, false);
  check("squads 结构非法被拒", badSquad.some((p) => p.includes("squads.a")), badSquad.join("；"));

  const okSquad = validateManifest({
    schemaVersion: 1,
    datasetId: "t",
    cases: [{ ...input(), squads: { a: ["甲一号"], b: ["乙一号"] } }],
  }, false);
  check("规范化后的昵称通过校验", okSquad.length === 0, okSquad.join("；"));
}

console.log("\n== 组2 · truth 校验 ==");
{
  const ok = validateTruthFile({ schemaVersion: 1, cases: [truth()] }, new Set(["c1"]));
  check("合法 truth 通过", ok.length === 0, ok.join("；"));

  const contradictory = validateTruthFile({
    schemaVersion: 1,
    cases: [truth({ shouldRefuse: true, games: [{ map: null, teamAScore: 13, teamBScore: 7 }] })],
  }, new Set(["c1"]));
  check("标为应拒答却给了逐局答案被拒", contradictory.some((p) => p.includes("自相矛盾")), contradictory.join("；"));

  const unknown = validateTruthFile({ schemaVersion: 1, cases: [truth({ caseId: "nope" })] }, new Set(["c1"]));
  check("truth 出现 manifest 之外案例被拒", unknown.some((p) => p.includes("不在 manifest 中")), unknown.join("；"));

  const badWinner = validateTruthFile({ schemaVersion: 1, cases: [truth({ winnerSide: "C" as never })] }, new Set(["c1"]));
  check("winnerSide 非法被拒", badWinner.some((p) => p.includes("winnerSide")), badWinner.join("；"));

  const noAnnotator = validateTruthFile({ schemaVersion: 1, cases: [truth({ annotatedBy: [] })] }, new Set(["c1"]));
  check("缺少标注者不报错但需为空数组（字段存在即可）", noAnnotator.length === 0);
}

console.log("\n== 组3 · 案例评估九种状态 ==");
{
  const correct = evaluate(GOOD_PARSED);
  check("字段全对 → correct 且可用", correct.status === "correct" && correct.usable);

  const wrongScore = evaluate({
    ...GOOD_PARSED,
    games: [{ map: "亚海悬城", winnerGroup: "a" as const, winnerScore: 13, loserScore: 11 }, GOOD_PARSED.games[1]],
  });
  check("比分错 → incorrect", wrongScore.status === "incorrect", wrongScore.status);
  check("比分错被计入未被规则发现的事实错误", wrongScore.usable && wrongScore.gameScoreCorrect[0] === false);

  const wrongMap = evaluate({
    ...GOOD_PARSED,
    games: [{ map: "幽邃地窟", winnerGroup: "a" as const, winnerScore: 13, loserScore: 7 }, GOOD_PARSED.games[1]],
  });
  check("地图错 → incorrect", wrongMap.status === "incorrect");

  const wrongWinner = evaluate({ ...GOOD_PARSED, winnerGroup: "b" as const });
  check("胜方错 → incorrect", wrongWinner.status === "incorrect" && wrongWinner.winnerCorrect === false);

  const refusedOk = evaluate(null, { shouldRefuse: true, series: null, winnerSide: null, games: [] }, {
    refused: true,
    refusedReason: "图不清",
  });
  check("应拒答且拒答 → refusedOk", refusedOk.status === "refusedOk");
  check("正确拒答不计虚构", refusedOk.severeFabrication === 0);

  const guessed = evaluate(GOOD_PARSED, { shouldRefuse: true, series: null, winnerSide: null, games: [] });
  check("应拒答却作答 → guessed", guessed.status === "guessed");
  check("猜测计入严重虚构", guessed.severeFabrication === 1);

  const falseRefusal = evaluate(null, {}, { refused: true });
  check("信息充足却拒答 → refusedModel", falseRefusal.status === "refusedModel");

  const parseError = evaluate(null, {}, { parseError: "模型输出不是 JSON" });
  check("解析失败 → parseError", parseError.status === "parseError");

  const schemaError = evaluate(null, {}, { validatorErrors: ["parsed.games[0].teamAScore 不是非负整数"] });
  check("结构非法 → schemaError", schemaError.status === "schemaError");
  check("结构错误只记录不修补", schemaError.usable === false);

  const illegal = evaluate({
    series: { a: 2, b: 0 },
    winnerGroup: "a" as const,
    games: [
      { map: "亚海悬城", winnerGroup: "a" as const, winnerScore: 13, loserScore: 7 },
      { map: "源工重镇", winnerGroup: "a" as const, winnerScore: 13, loserScore: 13 },
      { map: "隐士修所", winnerGroup: "a" as const, winnerScore: 13, loserScore: 9 },
    ],
  });
  check("含平局的非法比分被确定性规则拦下 → ruleRejected", illegal.status === "ruleRejected", illegal.reason);
  check("规则拒绝的案例不可用", illegal.usable === false && illegal.rulesPassed === false);

  const earlyWin = evaluate({
    series: { a: 3, b: 0 },
    winnerGroup: "a" as const,
    games: [
      { map: "亚海悬城", winnerGroup: "a" as const, winnerScore: 13, loserScore: 5 },
      { map: "源工重镇", winnerGroup: "a" as const, winnerScore: 13, loserScore: 5 },
      { map: "隐士修所", winnerGroup: "a" as const, winnerScore: 13, loserScore: 5 },
    ],
  });
  check("提前决出胜负后继续录局被拦（复用生产规则）", earlyWin.status === "ruleRejected", earlyWin.reason);

  const missing = evaluateCase(input(), truth(), null);
  check("无预测记录 → failed", missing.status === "failed");
  check("失败的案例不计入可用", missing.usable === false);
}

console.log("\n== 组4 · 不可确定字段与「不依赖自报置信度」==");
{
  const asserted = evaluate(
    { ...GOOD_PARSED, winnerGroup: "a" as const },
    { undeterminable: ["winnerSide"], winnerSide: null },
  );
  check("断言了标注为不可确定的字段被计数", asserted.undeterminableAssertions === 1);

  const notAsserted = evaluate(
    { series: null, winnerGroup: null, games: GOOD_PARSED.games },
    { undeterminable: ["winnerSide", "series"], winnerSide: null, series: null },
  );
  check("对不可确定字段留空不计数", notAsserted.undeterminableAssertions === 0);

  // 直接验证评分不吃模型自报置信度：塞一个极高的 confidence 也不改变结论
  const withConfidence = evaluateCase(
    input(),
    truth(),
    { ...prediction({ series: null, winnerGroup: "b" as const, games: [] }), confidence: 0.999 } as CasePrediction,
  );
  const withoutConfidence = evaluateCase(input(), truth(), prediction({ series: null, winnerGroup: "b" as const, games: [] }));
  check(
    "自称置信度不影响评分（同样的错误结论）",
    withConfidence.status === withoutConfidence.status && withConfidence.status !== "correct",
    `${withConfidence.status} vs ${withoutConfidence.status}`,
  );
}

console.log("\n== 组5 · 门槛与决策 ==");
{
  const allGood = aggregate(
    [evaluate(GOOD_PARSED), evaluate(GOOD_PARSED, {}, { caseId: "c1" })],
    { reductionModel: DEFAULT_REDUCTION_MODEL },
  );
  check("全对时 Gate 通过", evaluateGate(allGood).passed);
  check("全对时决策为 Go", decide(evaluateGate(allGood), allGood).decision === "Go");

  const wrongWinner = evaluate({ ...GOOD_PARSED, winnerGroup: "b" as const });
  const mixed = aggregate([evaluate(GOOD_PARSED), wrongWinner, evaluate(GOOD_PARSED)]);
  const mixedGate = evaluateGate(mixed);
  check("胜方未达 98% 时 Gate 不过", !mixedGate.passed);
  check("不可修正时决策为 No-Go", decide(mixedGate, mixed).decision === "No-Go");
  check("可修正时决策为 Retest", decide(mixedGate, mixed, { retestable: true }).decision === "Retest");

  const fabricated = aggregate([
    evaluate(GOOD_PARSED),
    evaluate(GOOD_PARSED, { shouldRefuse: true, series: null, winnerSide: null, games: [] }),
  ]);
  const fabricatedGate = evaluateGate(fabricated);
  check("严重虚构使 Gate 不过", !fabricatedGate.passed);
  check(
    "严重虚构时直接 Stop",
    decide(fabricatedGate, fabricated).decision === "Stop",
    decide(fabricatedGate, fabricated).reason,
  );

  const safe = aggregate([evaluate(GOOD_PARSED)]);
  check(
    "存在阻断安全问题时 Stop",
    decide(evaluateGate(safe), safe, { blockingSafetyIssue: "供应商保留数据未确认" }).decision === "Stop",
  );

  const refusalHeavy = aggregate([
    evaluate(GOOD_PARSED),
    evaluate(null, {}, { refused: true }),
    evaluate(null, {}, { refused: true }),
  ]);
  check("误拒拖低可用预填比例", (refusalHeavy.usablePrefill.rate ?? 0) < 0.8, String(refusalHeavy.usablePrefill.rate));
  check("误拒率被记录", (refusalHeavy.falseRefusal.rate ?? 0) > 0);
}

console.log("\n== 组6 · 评分口径 ==");
{
  const oneRefusal = aggregate([
    evaluate(GOOD_PARSED),
    evaluate(null, { shouldRefuse: true, series: null, winnerSide: null, games: [] }, { refused: true }),
  ]);
  check("应拒答样本不进入有效样本分母", oneRefusal.validCaseCount === 1);
  check("应拒答样本单独计数", oneRefusal.refusalCaseCount === 1);
  check("可用预填比例只按有效样本算", oneRefusal.usablePrefill.rate === 1);

  const bo1 = evaluateCase(
    input({ boType: "BO1" }),
    truth({ series: { a: 1, b: 0 }, games: [{ map: "亚海悬城", teamAScore: 13, teamBScore: 7 }] }),
    prediction({ series: { a: 1, b: 0 }, winnerGroup: "a" as const, games: [{ map: "亚海悬城", winnerGroup: "a" as const, winnerScore: 13, loserScore: 7 }] }),
  );
  const bo1Metrics = aggregate([bo1]);
  check(
    "BO1 理论削减 = 1 − 2/(3×1+2) = 60%",
    Math.abs(bo1Metrics.theoreticalReduction - 0.6) < 1e-9,
    String(bo1Metrics.theoreticalReduction),
  );

  const unusable = aggregate([evaluate(null, {}, { parseError: "x" })]);
  check("不可用时理论削减为 0", unusable.theoreticalReduction === 0);

  const latencies = aggregate([
    evaluateCase(input(), truth(), prediction(GOOD_PARSED, { latencyMs: 100 })),
    evaluateCase(input(), truth(), prediction(GOOD_PARSED, { latencyMs: 300 })),
    evaluateCase(input(), truth(), prediction(GOOD_PARSED, { latencyMs: 200 })),
  ]);
  check("延迟 P50 可计算", latencies.latency.p50 === 200, String(latencies.latency.p50));
  check("延迟 P95 可计算", latencies.latency.p95 === 300, String(latencies.latency.p95));

  const costed = aggregate([
    evaluateCase(input(), truth(), prediction(GOOD_PARSED, { usage: { costUsd: 0.0004 } })),
    evaluateCase(input(), truth(), prediction(GOOD_PARSED, { usage: { costUsd: 0.0006 } })),
  ]);
  check("成本求和", Math.abs(costed.totalCostUsd - 0.001) < 1e-9, String(costed.totalCostUsd));

  check(
    "非法拦截计数来自规则拒绝",
    aggregate([evaluate({
      series: { a: 2, b: 0 },
      winnerGroup: "a" as const,
      games: [
        { map: "亚海悬城", winnerGroup: "a" as const, winnerScore: 13, loserScore: 7 },
        { map: "源工重镇", winnerGroup: "a" as const, winnerScore: 13, loserScore: 13 },
      ],
    })]).illegalProduced === 1,
  );
  check(
    "规则拒绝的案例不会同时被算作可用（结构不变式）",
    aggregate([evaluate({
      series: { a: 2, b: 0 },
      winnerGroup: "a" as const,
      games: [{ map: "亚海悬城", winnerGroup: "a" as const, winnerScore: 13, loserScore: 13 }],
    })]).illegalWronglyAccepted === 0,
  );
}

console.log("\n== 组6b · 昵称分组（三种底色的坑）==");
{
  const truthWithGroups = (): CaseTruth => truth({
    groups: { a: ["甲一号", "甲二号", "甲三号"], b: ["乙一号", "乙二号"] },
  });

  const perfect = evaluateCase(
    input(),
    truthWithGroups(),
    prediction({ ...GOOD_PARSED, groups: { a: ["甲一号", "甲二号", "甲三号"], b: ["乙一号", "乙二号"] } }),
  );
  check("分组全对", perfect.groupingCorrect === 3 + 2 && perfect.groupingTotal === 5);

  // 「自己那行」被单算成第三组 → 该昵称缺失
  const selfRowMissed = evaluateCase(
    input(),
    truthWithGroups(),
    prediction({ ...GOOD_PARSED, groups: { a: ["甲一号", "甲二号"], b: ["乙一号", "乙二号"] } }),
  );
  check("自己那行被漏掉时分组扣分", selfRowMissed.groupingCorrect === 4, String(selfRowMissed.groupingCorrect));

  // 两侧整体对调
  const swapped = evaluateCase(
    input(),
    truthWithGroups(),
    prediction({ ...GOOD_PARSED, groups: { a: ["乙一号", "乙二号"], b: ["甲一号", "甲二号", "甲三号"] } }),
  );
  check("两侧对调时分组全错", swapped.groupingCorrect === 0 && swapped.groupingTotal === 5);
  // 这是「划分 vs 定向」两个口径的关键差异：对调后定向全错，但划分其实完全正确。
  // 排位图没有队名/名单时，左右本就无从确定，不该按定向口径算模型失败。
  check("两侧对调时划分仍算全对", swapped.groupingPartitionCorrect === 5, String(swapped.groupingPartitionCorrect));

  const swappedMetrics = aggregate([swapped]);
  check("两侧对调被单独计数", swappedMetrics.groupingSwappedCases === 1);
  check("对调时划分率=100%、定向率=0%",
    swappedMetrics.groupingPartition.rate === 1 && swappedMetrics.grouping.rate === 0,
    `划分=${swappedMetrics.groupingPartition.rate} 定向=${swappedMetrics.grouping.rate}`);

  const perfectMetrics = aggregate([perfect]);
  check("分组准确率可计算", Math.abs((perfectMetrics.grouping.rate ?? 0) - 1) < 1e-9);
  check("全对时两个口径一致", perfectMetrics.grouping.rate === perfectMetrics.groupingPartition.rate);
  check("全对时不报对调", perfectMetrics.groupingSwappedCases === 0);

  // 真实错误（部分归错）时，划分率应低于 100%，不能靠对调掩盖
  const partlyWrong = evaluateCase(
    input(),
    truthWithGroups(),
    prediction({ ...GOOD_PARSED, groups: { a: ["甲一号", "乙一号"], b: ["甲二号", "甲三号", "乙二号"] } }),
  );
  check("部分归错时划分率也扣分", (partlyWrong.groupingPartitionCorrect ?? 0) < 5,
    String(partlyWrong.groupingPartitionCorrect));
  // 注意 partitionCorrect 的语义：取两个方向里较好的那个，
  // 即「在最优的左右解释下分对了几个」。本用例定向对 2 个（甲一号、乙二号），
  // 对调后对 3 个（甲二号、甲三号、乙一号），故为 3。
  // 这不是掩盖错误——满分仍是 5，部分归错拿不到满分；它只是不把「左右搞反」重复扣一次。
  check("划分口径取较优方向（本例 3 > 定向的 2）",
    partlyWrong.groupingPartitionCorrect === 3 && partlyWrong.groupingCorrect === 2,
    `划分=${partlyWrong.groupingPartitionCorrect} 定向=${partlyWrong.groupingCorrect}`);

  // 没标注分组 → 指标为空，且不把 Gate 判失败（缺样本由覆盖度检查负责）
  const noGroups = evaluateCase(input(), truth(), prediction(GOOD_PARSED));
  check("未标注分组时指标为空", noGroups.groupingCorrect === null && noGroups.groupingTotal === null);
  const noGroupsGate = evaluateGate(aggregate([noGroups]));
  const item = noGroupsGate.items.find((i) => i.id.includes("昵称分组"));
  check("分组无样本时判为不适用而非失败", item?.pass === true && (item?.actual ?? "").includes("不适用"), item?.actual);

  // 模型没输出分组 → 记 0 分而不是跳过
  const missingOutput = evaluateCase(input(), truthWithGroups(), prediction(GOOD_PARSED));
  check("有答案但模型没输出分组时记 0", missingOutput.groupingCorrect === 0 && missingOutput.groupingTotal === 5);

  // 校验器接受合法分组、拒绝结构错误
  check("合法分组通过校验", validateParsedOutput({ series: null, winnerGroup: null, games: [], groups: { a: ["x"], b: ["y"] } }).length === 0);
  check("分组结构错误被拒", validateParsedOutput({ series: null, winnerGroup: null, games: [], groups: { a: "不是数组", b: [] } }).length > 0);
}

console.log("\n== 组7 · 覆盖度检查 ==");
{
  const coverage = checkDatasetCoverage([input(), input({ caseId: "c2", groupId: "g2", category: "invalid" })]);
  check("按类别计数", coverage.byCategory.clear === 1 && coverage.byCategory.invalid === 1);
  check("列出未达最低样本量的类别", coverage.shortfall.some((s) => s.includes("clear 需 15 例")));
  check("分组数等于案例数时不提示泄漏", !coverage.shortfall.some((s) => s.includes("互相泄漏")));

  const leaked = checkDatasetCoverage([input(), input({ caseId: "c2" })]);
  check("同组多案例提示数据泄漏风险", leaked.shortfall.some((s) => s.includes("互相泄漏")));
}

// 含 await 的用例统一放进异步函数：本仓库的 tsx 以 cjs 输出，不支持顶层 await。
async function asyncGroups(): Promise<void> {
console.log("\n== 组8 · 适配器 ==");
{
  const fenced = extractJson('这是结果：\n```json\n{"refuse": false}\n```\n以上。');
  check("能从代码块里取出 JSON", fenced.ok && (fenced.value as { refuse: boolean }).refuse === false);

  const inline = extractJson('前缀 {"refuse": true} 后缀');
  check("能从散文中取出 JSON", inline.ok);

  const noJson = extractJson("完全没有 JSON");
  check("无 JSON 时返回错误", !noJson.ok);

  const broken = extractJson("{不是合法 JSON}");
  check("非法 JSON 返回错误", !broken.ok);

  const refuse = normalizeModelJson({ refuse: true, reason: "图不清" });
  check("refuse 输出被识别为拒答（parsed 为空）", refuse.parsed === null && refuse.problems.length === 0);

  const badTypes = normalizeModelJson({ refuse: false, games: [{ map: "x", teamAScore: "十三", teamBScore: 7 }] });
  check("类型不对被记为问题而不是修补", badTypes.problems.length > 0, badTypes.problems.join("；"));

  const notObject = normalizeModelJson([1, 2]);
  check("数组输出被拒", notObject.problems.length > 0);

  const mock = createMockAdapter();
  const mockRun = await mock.run(input({ caseId: "不存在的案例" }), { datasetDir: EXAMPLE_DATASET, timeoutMs: 5000 });
  check("mock 缺案例时给明确解析错误", mockRun.parseError !== null && mockRun.parsed === null);
  check("mock 不需要图片", mock.requiresImages === false);

  const form = createFormBaselineAdapter();
  const formRun = await form.run(input(), { datasetDir: EXAMPLE_DATASET, timeoutMs: 5000 });
  check("对照组不产生任何预填", formRun.parsed !== null && formRun.parsed.games.length === 0);
  check("对照组标注为不使用视觉", form.usesVision === false);

  const misconfigured = createVisionAdapter({ provider: "p", model: "m", baseUrl: "https://x", apiKey: "" });
  check("缺 apiKey 时明确未配置", misconfigured.isConfigured().ok === false);

  const configured = createVisionAdapter({ provider: "p", model: "m", baseUrl: "https://x", apiKey: "k" });
  check("配置齐全时可用", configured.isConfigured().ok);
  check("视觉适配器要求图片存在", configured.requiresImages === true);
}

console.log("\n== 组9 · 视觉适配器网络路径（注入 fetch，不联网）==");
{
  const workDir = mkdtempSync(path.join(tmpdir(), "rv-"));
  mkdirSync(path.join(workDir, "images"), { recursive: true });
  // 1×1 透明 PNG，只用于让 readFileSync 有内容
  writeFileSync(
    path.join(workDir, "images", "t.png"),
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64"),
  );
  const caseInput = input({ images: [{ file: "t.png", order: 1 }] });

  const okFetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: '```json\n{"refuse":false,"series":{"a":2,"b":0},"winnerGroup":"a","games":[{"map":"亚海悬城","winnerGroup":"a","winnerScore":13,"loserScore":7},{"map":"源工重镇","winnerGroup":"a","winnerScore":13,"loserScore":9}]}\n```' } }],
      usage: { prompt_tokens: 1500, completion_tokens: 120 },
    }),
    text: async () => "",
  })) as unknown as typeof fetch;

  const adapter = createVisionAdapter(
    { provider: "p", model: "m", baseUrl: "https://example.invalid/v1", apiKey: "k", inputPerMillionUsd: 1, outputPerMillionUsd: 2 },
    { fetchImpl: okFetch },
  );
  const result = await adapter.run(caseInput, { datasetDir: workDir, timeoutMs: 5000 });
  check("解析模型 JSON 成功", result.parsed !== null && result.parsed.games.length === 2);
  check("无结构问题", (result.validatorErrors ?? []).length === 0, (result.validatorErrors ?? []).join("；"));
  check("usage 被记录", result.usage?.inputTokens === 1500 && result.usage?.outputTokens === 120);
  check(
    "成本由价格表算出（不由模型自报）",
    typeof result.usage?.costUsd === "number" && Math.abs((result.usage?.costUsd ?? 0) - (1500 / 1e6 * 1 + 120 / 1e6 * 2)) < 1e-12,
    String(result.usage?.costUsd),
  );

  const refuseFetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: '{"refuse":true,"reason":"比分被遮挡"}' } }] }),
    text: async () => "",
  })) as unknown as typeof fetch;
  const refused = await createVisionAdapter(
    { provider: "p", model: "m", baseUrl: "https://x/v1", apiKey: "k" },
    { fetchImpl: refuseFetch },
  ).run(caseInput, { datasetDir: workDir, timeoutMs: 5000 });
  check("模型拒答被识别", refused.refused === true && refused.parsed === null);

  const brokenJsonFetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: "抱歉，我无法完成。" } }] }),
    text: async () => "",
  })) as unknown as typeof fetch;
  const brokenResult = await createVisionAdapter(
    { provider: "p", model: "m", baseUrl: "https://x/v1", apiKey: "k" },
    { fetchImpl: brokenJsonFetch },
  ).run(caseInput, { datasetDir: workDir, timeoutMs: 5000 });
  check("输出无 JSON 时记为解析错误", brokenResult.parseError !== null && brokenResult.parsed === null);

  const errorFetch = (async () => ({
    ok: false,
    status: 500,
    json: async () => ({}),
    text: async () => "internal error",
  })) as unknown as typeof fetch;
  const errorResult = await createVisionAdapter(
    { provider: "p", model: "m", baseUrl: "https://x/v1", apiKey: "k" },
    { fetchImpl: errorFetch },
  ).run(caseInput, { datasetDir: workDir, timeoutMs: 5000 });
  check("HTTP 失败记为解析错误且不带完整响应体", errorResult.parseError?.includes("HTTP 500") === true);
}

console.log("\n== 组10 · 端到端（示例数据集，无密钥）==");
{
  const outRoot = mkdtempSync(path.join(tmpdir(), "rv-run-"));
  const first = await executeRun({ datasetDir: EXAMPLE_DATASET, armId: "mock", outRoot });
  check("run 执行全部案例", first.succeeded === 8 && first.failed === 0, `成功 ${first.succeeded} 失败 ${first.failed}`);

  const scored = scoreRun(EXAMPLE_DATASET, first.runDir);
  check("示例数据集 Gate 通过", scored.gatePassed);
  check("示例数据集决策为 Go", scored.decision === "Go", scored.reason);

  const reportText = readFileSync(scored.reportPath, "utf8");
  const report = JSON.parse(reportText) as {
    metrics: { byStatus: Record<string, number> };
    failureBreakdown: Record<string, number>;
    integrity: { predictionsMissing: number };
  };
  check("报告区分成功案例", report.metrics.byStatus.correct === 6 && report.metrics.byStatus.refusedOk === 2);
  check("报告按四类给出失败分解", Object.keys(report.failureBreakdown).length === 8);
  check("报告标记无缺失预测", report.integrity.predictionsMissing === 0);

  // 报告里不得出现原始输出与密钥
  check("报告不含模型原始输出字段", !/"raw"/.test(reportText));
  check("报告不含密钥与供应商地址", !/apiKey|Bearer|https:\/\/example\.invalid/.test(reportText));
  check("报告不含图片内容", !/iVBORw0KGgo/.test(reportText));

  // 预测文件默认不落原始输出
  const predictionsText = readFileSync(path.join(first.runDir, "predictions.jsonl"), "utf8");
  check("预测记录默认不保存 raw", !/"raw"/.test(predictionsText));

  // 断点续跑：复用同一 run 目录，应全部跳过
  const resumed = await executeRun({
    datasetDir: EXAMPLE_DATASET,
    armId: "mock",
    outRoot,
    resumeRunDir: first.runDir,
  });
  check("断点续跑沿用同一 runId", resumed.runId === first.runId);
  check("断点续跑不重复执行", resumed.succeeded === 0 && resumed.skipped === 8, `成功 ${resumed.succeeded} 跳过 ${resumed.skipped}`);

  // 强制重跑
  const forced = await executeRun({
    datasetDir: EXAMPLE_DATASET,
    armId: "mock",
    outRoot,
    resumeRunDir: first.runDir,
    force: true,
  });
  check("force 时重新执行全部案例", forced.succeeded === 8);

  // 对照组：无任何自动预填
  const control = await executeRun({ datasetDir: EXAMPLE_DATASET, armId: "form-baseline", outRoot });
  const controlScored = scoreRun(EXAMPLE_DATASET, control.runDir);
  const controlReport = JSON.parse(readFileSync(controlScored.reportPath, "utf8")) as {
    metrics: { usablePrefill: { rate: number }; theoreticalReduction: number };
  };
  check("对照组可用预填为 0", controlReport.metrics.usablePrefill.rate === 0);
  check("对照组理论削减为 0", controlReport.metrics.theoreticalReduction === 0);
  check("对照组决策不是 Go", controlScored.decision !== "Go", controlScored.reason);
}

console.log("\n== 组11 · 校验失败时必须中止而不是带着问题跑 ==");
{
  const badDir = mkdtempSync(path.join(tmpdir(), "rv-bad-"));
  writeFileSync(
    path.join(badDir, "manifest.json"),
    JSON.stringify({ schemaVersion: 1, datasetId: "bad", cases: [{ ...input(), boType: "BO9" }] }),
    "utf8",
  );
  let threw = "";
  try {
    await executeRun({ datasetDir: badDir, armId: "mock", outRoot: mkdtempSync(path.join(tmpdir(), "rv-out-")) });
  } catch (error) {
    threw = error instanceof Error ? error.message : String(error);
  }
  check("manifest 非法时 run 直接报错中止", threw.includes("manifest 校验未通过"), threw.slice(0, 80));

  const noTruth = mkdtempSync(path.join(tmpdir(), "rv-notruth-"));
  const runForTruth = await executeRun({ datasetDir: EXAMPLE_DATASET, armId: "mock", outRoot: noTruth });
  let scoreThrew = "";
  try {
    scoreRun(badDir, runForTruth.runDir);
  } catch (error) {
    scoreThrew = error instanceof Error ? error.message : String(error);
  }
  check("缺答案文件时 score 报错中止", scoreThrew.includes("找不到答案文件"), scoreThrew.slice(0, 80));
}
}

asyncGroups()
  .then(() => {
    console.log(`\n结果：通过 ${pass} / ${pass + fail}`);
    if (fail > 0) process.exit(1);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
