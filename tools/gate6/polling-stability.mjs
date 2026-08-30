import { writeFile } from "node:fs/promises";

const base = process.argv[2]?.replace(/\/$/, "");
const outputPath = process.argv[3] ?? "gate6-poll-result.json";
if (!base) throw new Error("missing base URL");

const clientCount = 100;
const durationMs = 10 * 60 * 1_000;
const intervalMs = 5_000;
const endpoint = `${base}/api/public/schedule?eventId=event-mt8f43vq`;

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

async function delay(ms) {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const testStarted = performance.now();

async function runClient(clientIndex) {
  const rows = [];
  const staggerMs = Math.round((clientIndex / clientCount) * intervalMs);
  await delay(staggerMs);
  let nextStart = testStarted + staggerMs;
  let previousVersion = null;

  while (performance.now() - testStarted < durationMs) {
    const started = performance.now();
    try {
      const response = await fetch(endpoint, {
        headers: { "user-agent": "Gate6-cloud-polling-stability/1.0" },
        signal: AbortSignal.timeout(10_000),
      });
      const body = await response.json().catch(() => null);
      const version = typeof body?.version === "number" ? body.version : null;
      const rollback = previousVersion !== null && version !== null && version < previousVersion;
      if (version !== null) previousVersion = version;
      rows.push({
        minute: Math.min(9, Math.floor((started - testStarted) / 60_000)),
        status: response.status,
        ok: response.ok && version !== null,
        durationMs: Math.round(performance.now() - started),
        cacheStatus: response.headers.get("x-vercel-cache") ?? "",
        edge: (response.headers.get("x-vercel-id") ?? "").split("::").slice(0, 2).join("::"),
        version,
        rollback,
      });
    } catch (error) {
      rows.push({
        minute: Math.min(9, Math.floor((started - testStarted) / 60_000)),
        status: 0,
        ok: false,
        durationMs: Math.round(performance.now() - started),
        error: errorDetail(error),
        rollback: false,
      });
    }

    nextStart += intervalMs;
    await delay(nextStart - performance.now());
  }
  return rows;
}

const clientRows = await Promise.all(Array.from({ length: clientCount }, (_, index) => runClient(index)));
const rows = clientRows.flat();
const durations = rows.map((row) => row.durationMs);
const serverErrors = rows.filter((row) => row.status >= 500).length;
const failed = rows.filter((row) => !row.ok).length;
const minuteBuckets = Array.from({ length: 10 }, (_, minute) => {
  const bucket = rows.filter((row) => row.minute === minute);
  return {
    minute: minute + 1,
    requests: bucket.length,
    failed: bucket.filter((row) => !row.ok).length,
    p50Ms: percentile(bucket.map((row) => row.durationMs), 0.5),
    p95Ms: percentile(bucket.map((row) => row.durationMs), 0.95),
    maxMs: bucket.length > 0 ? Math.max(...bucket.map((row) => row.durationMs)) : null,
  };
});
const maxMinuteP95Ms = Math.max(...minuteBuckets.map((bucket) => bucket.p95Ms ?? 0));
const passed =
  failed === 0
  && serverErrors / rows.length < 0.01
  && rows.every((row) => !row.rollback)
  && maxMinuteP95Ms < 1_000;
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
  load: { clientCount, durationMs, intervalMs },
  requests: rows.length,
  succeeded: rows.length - failed,
  failed,
  successRate: Number((((rows.length - failed) / rows.length) * 100).toFixed(3)),
  serverErrorRate: Number(((serverErrors / rows.length) * 100).toFixed(3)),
  p50Ms: percentile(durations, 0.5),
  p95Ms: percentile(durations, 0.95),
  maxMs: Math.max(...durations),
  maxMinuteP95Ms,
  versions: [...new Set(rows.map((row) => row.version).filter((value) => value !== null))],
  rollbackCount: rows.filter((row) => row.rollback).length,
  statuses: Object.fromEntries(
    [...new Set(rows.map((row) => row.status))]
      .sort((a, b) => a - b)
      .map((status) => [status, rows.filter((row) => row.status === status).length]),
  ),
  cacheStatuses: Object.fromEntries(
    [...new Set(rows.map((row) => row.cacheStatus).filter(Boolean))]
      .sort()
      .map((status) => [status, rows.filter((row) => row.cacheStatus === status).length]),
  ),
  edges: [...new Set(rows.map((row) => row.edge).filter(Boolean))],
  errors: [...new Set(rows.map((row) => row.error).filter(Boolean))],
  minuteBuckets,
  passed,
};

await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!passed) process.exitCode = 2;
