import { writeFile } from "node:fs/promises";

const base = process.argv[2]?.replace(/\/$/, "");
const outputPath = process.argv[3] ?? "gate6-read-result.json";
if (!base) throw new Error("missing base URL");

const eventId = "event-mt8f43vq";
const scenarios = [
  { name: "home", path: "/" },
  { name: "registration", path: `/api/public/registration?eventId=${eventId}` },
  { name: "schedule", path: `/api/public/schedule?eventId=${eventId}` },
];

function percentile(values, ratio) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]);
}

function errorDetail(error) {
  const cause = error && typeof error === "object" && "cause" in error ? error.cause : undefined;
  const causeDetail = cause && typeof cause === "object"
    ? [cause.code, cause.errno, cause.syscall, cause.message].filter(Boolean).join(" | ")
    : cause
      ? String(cause)
      : "";
  return [error instanceof Error ? error.message : String(error), causeDetail]
    .filter(Boolean)
    .join(" :: ");
}

async function request(scenario) {
  const started = performance.now();
  try {
    const response = await fetch(`${base}${scenario.path}`, {
      headers: { "user-agent": "Gate6-cloud-read-capacity/1.0" },
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.arrayBuffer();
    return {
      scenario: scenario.name,
      status: response.status,
      ok: response.ok,
      durationMs: Math.round(performance.now() - started),
      bytes: body.byteLength,
      cacheStatus: response.headers.get("x-vercel-cache") ?? "",
      edge: response.headers.get("x-vercel-id") ?? "",
    };
  } catch (error) {
    return {
      scenario: scenario.name,
      status: 0,
      ok: false,
      durationMs: Math.round(performance.now() - started),
      bytes: 0,
      error: errorDetail(error),
    };
  }
}

function summarize(rows) {
  const durations = rows.map((row) => row.durationMs);
  const statuses = [...new Set(rows.map((row) => row.status))].sort((a, b) => a - b);
  const cacheStatuses = [...new Set(rows.map((row) => row.cacheStatus).filter(Boolean))].sort();
  const succeeded = rows.filter((row) => row.ok).length;
  const serverErrors = rows.filter((row) => row.status >= 500).length;
  const p95Ms = percentile(durations, 0.95);
  return {
    requests: rows.length,
    succeeded,
    failed: rows.length - succeeded,
    successRate: Number(((succeeded / rows.length) * 100).toFixed(2)),
    serverErrorRate: Number(((serverErrors / rows.length) * 100).toFixed(2)),
    p50Ms: percentile(durations, 0.5),
    p95Ms,
    maxMs: Math.max(...durations),
    totalBytes: rows.reduce((sum, row) => sum + row.bytes, 0),
    statuses: Object.fromEntries(statuses.map((status) => [status, rows.filter((row) => row.status === status).length])),
    cacheStatuses: Object.fromEntries(
      cacheStatuses.map((status) => [status, rows.filter((row) => row.cacheStatus === status).length]),
    ),
    edges: [...new Set(rows.map((row) => row.edge).filter(Boolean))],
    errors: [...new Set(rows.map((row) => row.error).filter(Boolean))],
    gate: {
      noFailedRequests: succeeded === rows.length,
      serverErrorRateBelowOnePercent: serverErrors / rows.length < 0.01,
      p95BelowOneSecond: p95Ms !== null && p95Ms < 1_000,
      passed: succeeded === rows.length && serverErrors / rows.length < 0.01 && p95Ms !== null && p95Ms < 1_000,
    },
  };
}

async function runLevel(concurrency) {
  const baseCount = Math.floor(concurrency / scenarios.length);
  const remainder = concurrency % scenarios.length;
  const tasks = scenarios.flatMap((scenario, scenarioIndex) =>
    Array.from(
      { length: baseCount + (scenarioIndex < remainder ? 1 : 0) },
      () => request(scenario),
    ),
  );
  const started = performance.now();
  const rows = await Promise.all(tasks);
  return {
    concurrency,
    wallTimeMs: Math.round(performance.now() - started),
    overall: summarize(rows),
    scenarios: Object.fromEntries(
      scenarios.map((scenario) => [scenario.name, summarize(rows.filter((row) => row.scenario === scenario.name))]),
    ),
  };
}

const warmup = await runLevel(3);
const level30 = await runLevel(30);
const level300 = level30.overall.gate.passed ? await runLevel(300) : null;
const report = {
  schemaVersion: 1,
  recordedAt: new Date().toISOString(),
  base,
  source: "GitHub Actions hosted runner",
  runner: {
    os: process.env.RUNNER_OS ?? process.platform,
    architecture: process.env.RUNNER_ARCH ?? process.arch,
    name: process.env.RUNNER_NAME ?? "local",
    runId: process.env.GITHUB_RUN_ID ?? "local",
    commit: process.env.GITHUB_SHA ?? "local",
  },
  thresholds: {
    failedRequests: 0,
    serverErrorRatePercentBelow: 1,
    p95MsBelow: 1_000,
  },
  warmup,
  levels: { "30": level30, "300": level300 },
  passed: Boolean(level300?.overall.gate.passed),
  note: level300 ? "30 并发通过后执行 300 并发。" : "30 并发未通过，按测试规则停止放大。",
};

await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 2;
