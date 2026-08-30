import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { supabaseDataStore } from "../../src/lib/supabase-data-store";

interface ProbeDocument {
  runId: string;
  requestIds: string[];
  padding: string;
}

const PROBE_DOCUMENT_NAME = "write-concurrency";
const CONCURRENCY = 30;
const PAYLOAD_PADDING_BYTES = 400_000;

async function main() {
  loadEnvConfig(process.cwd(), true);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    throw new Error("Gate 6 写入并发测试缺少 Supabase staging 配置");
  }

  const runId = randomUUID();
  const probeEventId = `gate6probe-${runId.slice(0, 8)}`;
  const initial: ProbeDocument = {
    runId,
    requestIds: [],
    padding: "x".repeat(PAYLOAD_PADDING_BYTES),
  };
  const requestIds = Array.from({ length: CONCURRENCY }, () => randomUUID());

  try {
    await supabaseDataStore.write("event", probeEventId, PROBE_DOCUMENT_NAME, initial);
    const started = performance.now();
    const results = await Promise.allSettled(
      requestIds.map((requestId) =>
        supabaseDataStore.update<ProbeDocument>(
          "event",
          probeEventId,
          PROBE_DOCUMENT_NAME,
          initial,
          (current) => ({
            ...current,
            requestIds: current.requestIds.includes(requestId)
              ? current.requestIds
              : [...current.requestIds, requestId],
          }),
        ),
      ),
    );
    const elapsedMs = Math.round(performance.now() - started);
    const final = await supabaseDataStore.read<ProbeDocument>(
      "event",
      probeEventId,
      PROBE_DOCUMENT_NAME,
      initial,
    );
    const uniqueIds = new Set(final.requestIds);
    const missingIds = requestIds.filter((requestId) => !uniqueIds.has(requestId));
    const rejected = results.filter((result) => result.status === "rejected");
    const report = {
      recordedAt: new Date().toISOString(),
      concurrency: CONCURRENCY,
      payloadBytes: Buffer.byteLength(JSON.stringify(initial)),
      elapsedMs,
      fulfilled: results.length - rejected.length,
      rejected: rejected.length,
      storedRequestIds: final.requestIds.length,
      uniqueStoredRequestIds: uniqueIds.size,
      missingRequestIds: missingIds.length,
      duplicateRequestIds: final.requestIds.length - uniqueIds.size,
      errors: [
        ...new Set(
          rejected.map((result) =>
            result.status === "rejected" && result.reason instanceof Error
              ? result.reason.message
              : "未知写入错误",
          ),
        ),
      ],
    };
    const passed =
      rejected.length === 0
      && final.requestIds.length === CONCURRENCY
      && uniqueIds.size === CONCURRENCY
      && missingIds.length === 0;

    process.stdout.write(`${JSON.stringify({ ...report, passed }, null, 2)}\n`);
    if (!passed) process.exitCode = 2;
  } finally {
    await supabaseDataStore.deleteEvent(probeEventId);
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Gate 6 写入并发测试失败");
  process.exitCode = 1;
});
