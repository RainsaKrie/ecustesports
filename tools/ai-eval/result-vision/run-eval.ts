#!/usr/bin/env node
// =====================
// AIE-02 评测框架：命令行入口
//
//   run      —— 执行一臂（arm），只读 manifest 与图片，**不读答案**
//   score    —— 读取答案并评分，产出报告
//   selftest —— 用 mock 适配器跑通 run + score，无需密钥与外网
//   coverage —— 只检查数据集是否达到最低样本量
//
// 关键约束：
//   · run 阶段绝不读 truth.json —— 盲测是技术保障，不是靠自觉
//   · 每条预测即时落盘，中途失败不丢已完成结果；支持断点续跑
//   · 报告不含密钥、不含图片、不含模型原始输出
//   · 产出只写进 out 目录，默认落在已被 gitignore 的 .workbuddy/ 下
// =====================

import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveAdapter, type VisionAdapter } from "./adapters";
import {
  DEFAULT_REDUCTION_MODEL,
  aggregate,
  decide,
  evaluateCase,
  evaluateGate,
  type ManualBaseline,
} from "./metrics";
import { PREDICTION_SCHEMA_VERSION, checkDatasetCoverage, validateManifest, validateTruthFile } from "./schema";
import type { CaseInput, CasePrediction, CaseTruth, Manifest, RunFailure, RunMeta, TruthFile } from "./types";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_OUT = path.join(REPO_ROOT, ".workbuddy", "ai-eval-runs");
const EXAMPLE_DATASET = path.join(REPO_ROOT, "docs", "05-规则与AI验证", "评测数据", "result-vision-example");

/** 人工手工填写基线，来源为负责人亲历数据（2026-09-11）。仅作对照记录，不参与门槛。 */
const MANUAL_BASELINE: ManualBaseline = {
  medianSeconds: { BO1: 20, BO3: 45, BO5: 90 },
  source: "负责人亲历数据（做过两届裁判并管理裁判，执裁 15 场以上；自述为保守估计）",
};

type Logger = (line: string) => void;

const stdoutLogger: Logger = (line) => process.stdout.write(`${line}\n`);
const silentLogger: Logger = () => {};

function parseArgs(argv: string[]): { command: string; flags: Map<string, string> } {
  const flags = new Map<string, string>();
  let command = "";
  for (const raw of argv) {
    if (raw.startsWith("--")) {
      const [key, ...rest] = raw.replace(/^--/, "").split("=");
      flags.set(key, rest.join("=") || "true");
    } else if (!command) {
      command = raw;
    }
  }
  return { command, flags };
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function requireDir(dir: string, label: string): void {
  if (!existsSync(dir)) throw new Error(`${label}不存在：${dir}`);
}

/** 读 manifest。校验失败即停——schema 问题必须修好，不允许带着问题跑出分数。 */
export function loadManifest(datasetDir: string, requireImages: boolean): Manifest {
  const file = path.join(datasetDir, "manifest.json");
  if (!existsSync(file)) throw new Error(`找不到 manifest：${file}`);
  const raw = readJson(file) as Manifest;
  const problems = validateManifest(raw, requireImages);
  if (problems.length > 0) {
    throw new Error(`manifest 校验未通过（共 ${problems.length} 项）：\n  - ${problems.join("\n  - ")}`);
  }
  return raw;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`单例超时（>${timeoutMs}ms）`)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

// ---------------------------------------------------------------
// run
// ---------------------------------------------------------------

export interface RunOptions {
  datasetDir: string;
  armId?: string;
  outRoot?: string;
  timeoutMs?: number;
  storeRawOutput?: boolean;
  force?: boolean;
  limit?: number;
  /** 复用已有的 run 目录继续跑（断点续跑的真实入口）；不传则新建 run */
  resumeRunDir?: string;
}

export interface RunOutcome {
  runId: string;
  runDir: string;
  caseCount: number;
  succeeded: number;
  failed: number;
  skipped: number;
  coverageShortfall: string[];
}

/** 执行一臂。可被测试直接调用；命令行的 run 只是它的外壳。 */
export async function executeRun(options: RunOptions, log: Logger = silentLogger): Promise<RunOutcome> {
  const datasetDir = path.resolve(options.datasetDir);
  requireDir(datasetDir, "数据集目录");

  const armId = options.armId ?? "mock";
  const adapter: VisionAdapter = resolveAdapter(armId);
  const configured = adapter.isConfigured();
  if (!configured.ok) throw new Error(`适配器 ${armId} 未配置：${configured.reason}`);

  const timeoutMs = options.timeoutMs ?? 60000;
  const storeRawOutput = options.storeRawOutput ?? false;
  const force = options.force ?? false;
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const outRoot = path.resolve(options.outRoot ?? DEFAULT_OUT);

  const manifest = loadManifest(datasetDir, adapter.requiresImages);
  const coverage = checkDatasetCoverage(manifest.cases);

  // 续跑时沿用原 run 目录与 runId，保证「同一个 run 可以推进多次」而不是每次都另起一个。
  const resumeRunDir = options.resumeRunDir ? path.resolve(options.resumeRunDir) : null;
  const existingMeta = resumeRunDir && existsSync(path.join(resumeRunDir, "meta.json"))
    ? (readJson(path.join(resumeRunDir, "meta.json")) as RunMeta)
    : null;
  const runId = existingMeta?.runId
    ?? `${adapter.id.replace(/[^a-zA-Z0-9]+/g, "-")}-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}-${randomUUID().slice(0, 6)}`;
  const runDir = resumeRunDir ?? path.join(outRoot, "runs", runId);
  mkdirSync(runDir, { recursive: true });

  const meta: RunMeta = {
    runId,
    armId: adapter.id,
    provider: adapter.provider,
    model: adapter.model,
    promptVersion: adapter.promptVersion,
    schemaVersion: PREDICTION_SCHEMA_VERSION,
    datasetId: manifest.datasetId,
    datasetDir,
    startedAt: new Date().toISOString(),
    caseCount: manifest.cases.length,
    storeRawOutput,
    timeoutMs,
  };
  writeFileSync(path.join(runDir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");

  const predictionsFile = path.join(runDir, "predictions.jsonl");
  const failuresFile = path.join(runDir, "failures.jsonl");
  const done = new Set(readJsonl<CasePrediction>(predictionsFile).map((p) => p.caseId));
  const failedBefore = new Set(readJsonl<RunFailure>(failuresFile).map((f) => f.caseId));

  log(`runId: ${runId}`);
  log(`适配器: ${adapter.id}（provider=${adapter.provider} model=${adapter.model}）`);
  log(`数据集: ${manifest.datasetId}（${manifest.cases.length} 例）`);
  log(`输出目录: ${runDir}`);
  if (!force && done.size + failedBefore.size > 0) {
    log(`断点续跑：已有 ${done.size} 条预测、${failedBefore.size} 条失败记录，将跳过`);
  }
  log("");

  let executed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const input of manifest.cases) {
    if (executed >= limit) break;
    if (!force && (done.has(input.caseId) || failedBefore.has(input.caseId))) continue;
    executed += 1;

    const record = (failure: Omit<RunFailure, "caseId" | "armId" | "at">) => {
      failed += 1;
      const entry: RunFailure = { caseId: input.caseId, armId: adapter.id, at: new Date().toISOString(), ...failure };
      appendFileSync(failuresFile, `${JSON.stringify(entry)}\n`, "utf8");
    };

    if (adapter.requiresImages) {
      const missing = input.images.filter((image) => !existsSync(path.join(datasetDir, "images", image.file)));
      if (missing.length > 0) {
        record({ kind: "missingImage", message: `缺少图片：${missing.map((m) => m.file).join("、")}` });
        log(`  ✗ ${input.caseId} 缺少图片`);
        continue;
      }
    }

    const startedAt = new Date().toISOString();
    const startedAtMs = Date.now();
    try {
      const result = await withTimeout(adapter.run(input, { datasetDir, timeoutMs }), timeoutMs);
      const prediction: CasePrediction = {
        caseId: input.caseId,
        armId: adapter.id,
        provider: adapter.provider,
        model: adapter.model,
        promptVersion: adapter.promptVersion,
        schemaVersion: PREDICTION_SCHEMA_VERSION,
        startedAt,
        latencyMs: Date.now() - startedAtMs,
        usage: result.usage ?? {},
        refused: result.refused,
        refusedReason: result.refusedReason ?? null,
        parsed: result.parsed,
        parseError: result.parseError ?? null,
        validatorErrors: result.validatorErrors ?? [],
        // 默认不存原始输出：真实截图旁常带昵称与聊天，原样入库等于把个人信息抄一遍
        ...(storeRawOutput && result.raw ? { raw: result.raw } : {}),
      };
      appendFileSync(predictionsFile, `${JSON.stringify(prediction)}\n`, "utf8");
      succeeded += 1;
      log(`  ✓ ${input.caseId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      record({ kind: message.includes("超时") ? "timeout" : "adapterError", message });
      log(`  ✗ ${input.caseId} ${message}`);
    }
  }

  const finished: RunMeta = { ...meta, runId, startedAt: existingMeta?.startedAt ?? meta.startedAt, finishedAt: new Date().toISOString() };
  writeFileSync(path.join(runDir, "meta.json"), `${JSON.stringify(finished, null, 2)}\n`, "utf8");

  return {
    runId,
    runDir,
    caseCount: manifest.cases.length,
    succeeded,
    failed,
    skipped: manifest.cases.length - executed,
    coverageShortfall: coverage.shortfall,
  };
}

async function commandRun(flags: Map<string, string>): Promise<void> {
  const datasetFlag = flags.get("dataset");
  if (!datasetFlag) throw new Error("需要 --dataset=<数据集目录>");
  const resumeFlag = flags.get("resume");
  if (resumeFlag === "true") throw new Error("--resume 需要给出 run 目录：--resume=<run 目录>");
  const outcome = await executeRun(
    {
      datasetDir: path.resolve(datasetFlag),
      armId: flags.get("arm") ?? "mock",
      outRoot: flags.get("out"),
      timeoutMs: flags.get("timeout") ? Number(flags.get("timeout")) : undefined,
      storeRawOutput: flags.get("store-raw") === "true",
      force: flags.get("force") === "true",
      limit: flags.get("limit") ? Number(flags.get("limit")) : undefined,
      resumeRunDir: resumeFlag ? path.resolve(resumeFlag) : undefined,
    },
    stdoutLogger,
  );
  if (outcome.coverageShortfall.length > 0) {
    stdoutLogger("数据集体量提示（不阻止运行）：");
    for (const item of outcome.coverageShortfall) stdoutLogger(`  - ${item}`);
    stdoutLogger("");
  }
  stdoutLogger(`完成：成功 ${outcome.succeeded}，失败 ${outcome.failed}，跳过 ${outcome.skipped}`);
  stdoutLogger(`下一步：npm run ai:result-score -- --dataset=${path.resolve(String(datasetFlag))} --run=${outcome.runDir}`);
}

// ---------------------------------------------------------------
// score
// ---------------------------------------------------------------

export interface ScoreOutcome {
  reportPath: string;
  decision: string;
  reason: string;
  gatePassed: boolean;
  gateItems: Array<{ id: string; requirement: string; actual: string; pass: boolean }>;
}

export function scoreRun(datasetDir: string, runDir: string): ScoreOutcome {
  const meta = readJson(path.join(runDir, "meta.json")) as RunMeta;
  const manifest = readJson(path.join(datasetDir, "manifest.json")) as Manifest;
  const truthPath = path.join(datasetDir, "truth.json");
  if (!existsSync(truthPath)) throw new Error(`找不到答案文件：${truthPath}`);
  const truthFile = readJson(truthPath) as TruthFile;

  const caseIds = new Set(manifest.cases.map((c) => c.caseId));
  const truthProblems = validateTruthFile(truthFile, caseIds);
  if (truthProblems.length > 0) {
    throw new Error(`truth.json 校验未通过（共 ${truthProblems.length} 项）：\n  - ${truthProblems.join("\n  - ")}`);
  }

  const truthById = new Map<string, CaseTruth>(truthFile.cases.map((t) => [t.caseId, t]));
  const predictions = readJsonl<CasePrediction>(path.join(runDir, "predictions.jsonl"));
  const failures = readJsonl<RunFailure>(path.join(runDir, "failures.jsonl"));
  const predictionById = new Map(predictions.map((p) => [p.caseId, p]));
  const failureById = new Map(failures.map((f) => [f.caseId, f]));

  const evaluations = manifest.cases.map((input: CaseInput) => {
    const truth = truthById.get(input.caseId);
    if (!truth) throw new Error(`答案缺少案例：${input.caseId}`);
    return evaluateCase(input, truth, predictionById.get(input.caseId) ?? null);
  });

  const metrics = aggregate(evaluations, {
    reductionModel: DEFAULT_REDUCTION_MODEL,
    manualBaseline: MANUAL_BASELINE,
  });
  const gate = evaluateGate(metrics);
  const decision = decide(gate, metrics, { retestable: false });

  const uncovered = manifest.cases.filter((c) => !failureById.has(c.caseId) && !predictionById.has(c.caseId));
  const report = {
    runId: meta.runId,
    generatedAt: new Date().toISOString(),
    dataset: {
      datasetId: manifest.datasetId,
      caseCount: manifest.cases.length,
      frozenAt: manifest.frozenAt ?? null,
      coverage: checkDatasetCoverage(manifest.cases),
    },
    arm: {
      armId: meta.armId,
      provider: meta.provider,
      model: meta.model,
      promptVersion: meta.promptVersion,
      schemaVersion: meta.schemaVersion,
    },
    metrics,
    grouping: {
      划分准确率_忽略左右: metrics.groupingPartition.rate,
      定向准确率_需要输入给名单: metrics.grouping.rate,
      样本数: `${metrics.groupingPartition.correct}/${metrics.groupingPartition.total}`,
      疑似两侧对调的案例数: metrics.groupingSwappedCases,
      说明:
        "划分 = 能不能把 10 个昵称正确分成那两组；定向 = 还要分对哪组是 A。" +
        "排位图没有队名与名单，定向本就无从确定，故 Gate 用划分口径。",
    },
    failureBreakdown: {
      模型错误_字段不匹配: metrics.byStatus.incorrect,
      解析错误_输出无法解析: metrics.byStatus.parseError,
      结构错误_schema不合规: metrics.byStatus.schemaError,
      规则冲突_违反BO规则: metrics.byStatus.ruleRejected,
      输入不足_正确拒答: metrics.byStatus.refusedOk,
      输入不足_应拒答却作答: metrics.byStatus.guessed,
      误拒_信息充足却拒答: metrics.byStatus.refusedModel,
      执行失败_适配器或超时: metrics.byStatus.failed,
    },
    gate,
    decision,
    comparisons: {
      人工手工填写基线: MANUAL_BASELINE,
      不使用视觉模型的固定表单: {
        note: "以 form-baseline 臂表示：自动预填为 0，字段准确率由人工基线提供，不由模型测量。",
        script: "npm run ai:result-run -- --arm=form-baseline --dataset=<数据集目录>",
      },
      reductionModel: DEFAULT_REDUCTION_MODEL,
    },
    integrity: {
      predictionsMissing: uncovered.length,
      note: "报告只含统计结果，不含密钥、图片与模型原始输出。",
    },
  };

  const reportPath = path.join(runDir, "report.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return {
    reportPath,
    decision: decision.decision,
    reason: decision.reason,
    gatePassed: gate.passed,
    gateItems: gate.items,
  };
}

function commandScore(flags: Map<string, string>): void {
  const datasetFlag = flags.get("dataset");
  const runFlag = flags.get("run");
  if (!datasetFlag) throw new Error("需要 --dataset=<数据集目录>");
  if (!runFlag) throw new Error("需要 --run=<run 目录>");
  const datasetDir = path.resolve(datasetFlag);
  const runDir = path.resolve(runFlag);
  requireDir(datasetDir, "数据集目录");
  requireDir(runDir, "run 目录");

  const result = scoreRun(datasetDir, runDir);
  stdoutLogger(`报告：${result.reportPath}`);
  stdoutLogger("");
  stdoutLogger("—— Gate AI-2 逐条判定 ——");
  for (const item of result.gateItems) {
    stdoutLogger(`  ${item.pass ? "通过" : "未过"}  ${item.id}（要求 ${item.requirement}，实际 ${item.actual}）`);
  }
  stdoutLogger("");
  stdoutLogger(`结论：${result.decision} —— ${result.reason}`);
}

// ---------------------------------------------------------------
// selftest / coverage
// ---------------------------------------------------------------

async function commandSelftest(flags: Map<string, string>): Promise<void> {
  const datasetDir = path.resolve(flags.get("dataset") ?? EXAMPLE_DATASET);
  requireDir(datasetDir, "示例数据集");
  stdoutLogger("自测：使用 mock 适配器，不需要密钥与外网");
  stdoutLogger(`数据集：${datasetDir}`);
  stdoutLogger("");

  const outRoot = path.join(path.resolve(flags.get("out") ?? DEFAULT_OUT), "selftest");
  const outcome = await executeRun(
    { datasetDir, armId: "mock", outRoot, force: true },
    stdoutLogger,
  );
  stdoutLogger(`导出：成功 ${outcome.succeeded}，失败 ${outcome.failed}`);
  stdoutLogger("");
  commandScore(new Map([["dataset", datasetDir], ["run", outcome.runDir]]));
}

function commandCoverage(flags: Map<string, string>): void {
  const datasetFlag = flags.get("dataset");
  if (!datasetFlag) throw new Error("需要 --dataset=<数据集目录>");
  const datasetDir = path.resolve(datasetFlag);
  const manifest = loadManifest(datasetDir, false);
  const coverage = checkDatasetCoverage(manifest.cases);
  stdoutLogger(`数据集：${manifest.datasetId}（共 ${manifest.cases.length} 例）`);
  stdoutLogger("");
  stdoutLogger("—— 分类计数 ——");
  for (const [category, count] of Object.entries(coverage.byCategory)) {
    stdoutLogger(`  ${category}: ${count}`);
  }
  stdoutLogger("");
  if (coverage.shortfall.length === 0) {
    stdoutLogger("已达到工作包要求的最低样本量。");
  } else {
    stdoutLogger("尚未达到最低样本量：");
    for (const item of coverage.shortfall) stdoutLogger(`  - ${item}`);
  }
}

// ---------------------------------------------------------------

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (command === "run") return commandRun(flags);
  if (command === "score") return commandScore(flags);
  if (command === "selftest") return commandSelftest(flags);
  if (command === "coverage") return commandCoverage(flags);
  stdoutLogger("用法：");
  stdoutLogger("  run       --dataset=<目录> [--arm=mock|form-baseline|vision] [--out=<目录>] [--limit=] [--timeout=] [--force] [--store-raw] [--resume=<run 目录>]");
  stdoutLogger("  score     --dataset=<目录> --run=<run 目录>");
  stdoutLogger("  selftest  [--dataset=<目录>]");
  stdoutLogger("  coverage  --dataset=<目录>");
  process.exitCode = 1;
}

export { EXAMPLE_DATASET, MANUAL_BASELINE };

/**
 * 只有被当作脚本直接执行时才跑 main。
 * 测试会 import 本文件里的 executeRun / scoreRun，若不加这道判断，
 * import 就会触发 main、打印用法并把退出码设成 1。
 */
const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  return /^run-eval\.(ts|js|mjs)$/.test(path.basename(entry));
})();

if (invokedDirectly) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
