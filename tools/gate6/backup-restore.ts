import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { supabaseDataStore } from "../../src/lib/supabase-data-store";

interface DocumentSpec {
  scope: "site" | "event";
  eventId: string;
  name: string;
}

interface BackupDocument extends DocumentSpec {
  sha256: string;
  payload: unknown;
}

const SOURCE_EVENT_ID = "event-mt8f43vq";
const DOCUMENTS: DocumentSpec[] = [
  { scope: "site", eventId: "", name: "site-config" },
  { scope: "event", eventId: SOURCE_EVENT_ID, name: "registration" },
  { scope: "event", eventId: SOURCE_EVENT_ID, name: "format" },
  { scope: "event", eventId: SOURCE_EVENT_ID, name: "schedule" },
  { scope: "event", eventId: SOURCE_EVENT_ID, name: "bp" },
];

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function checksum(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

function countArray(value: unknown, key: string): number {
  if (!value || typeof value !== "object") return 0;
  const candidate = (value as Record<string, unknown>)[key];
  return Array.isArray(candidate) ? candidate.length : 0;
}

async function main() {
  loadEnvConfig(process.cwd(), true);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    throw new Error("Gate 6 备份恢复演练缺少 Supabase staging 配置");
  }

  const outputPath = process.argv[2];
  if (!outputPath) throw new Error("请提供仓库外的备份文件路径");
  const resolvedOutput = path.resolve(outputPath);
  if (resolvedOutput.startsWith(path.resolve(process.cwd()))) {
    throw new Error("备份文件不能写入项目仓库");
  }

  const missing = { __gate6Missing: true };
  const documents: BackupDocument[] = [];
  for (const spec of DOCUMENTS) {
    const payload = await supabaseDataStore.read<unknown>(spec.scope, spec.eventId, spec.name, missing);
    if (payload === missing || (payload && typeof payload === "object" && "__gate6Missing" in payload)) {
      throw new Error(`源文档不存在：${spec.scope}/${spec.eventId || "__site__"}/${spec.name}`);
    }
    documents.push({ ...spec, sha256: checksum(payload), payload });
  }

  const backup = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    source: "Supabase staging",
    documents,
  };
  await mkdir(path.dirname(resolvedOutput), { recursive: true });
  await writeFile(resolvedOutput, `${JSON.stringify(backup, null, 2)}\n`, "utf8");

  const persisted = JSON.parse(await readFile(resolvedOutput, "utf8")) as typeof backup;
  const restoreEventId = `gate6restore-${randomUUID().slice(0, 8)}`;
  const restored: Array<{ name: string; sourceSha256: string; restoredSha256: string; matches: boolean }> = [];
  try {
    for (const document of persisted.documents) {
      const restoreName = document.scope === "site" ? `site-${document.name}` : document.name;
      await supabaseDataStore.write("event", restoreEventId, restoreName, document.payload);
      const restoredPayload = await supabaseDataStore.read<unknown>(
        "event",
        restoreEventId,
        restoreName,
        missing,
      );
      const restoredSha256 = checksum(restoredPayload);
      restored.push({
        name: restoreName,
        sourceSha256: document.sha256,
        restoredSha256,
        matches: restoredSha256 === document.sha256,
      });
    }
  } finally {
    await supabaseDataStore.deleteEvent(restoreEventId);
  }

  const deletionChecks = await Promise.all(
    persisted.documents.map(async (document) => {
      const restoreName = document.scope === "site" ? `site-${document.name}` : document.name;
      const value = await supabaseDataStore.read<unknown>("event", restoreEventId, restoreName, missing);
      return value === missing || (value && typeof value === "object" && "__gate6Missing" in value);
    }),
  );
  const registration = documents.find((document) => document.name === "registration")?.payload;
  const schedule = documents.find((document) => document.name === "schedule")?.payload;
  const passed = restored.length === documents.length
    && restored.every((document) => document.matches)
    && deletionChecks.every(Boolean);
  const report = {
    recordedAt: new Date().toISOString(),
    outputPath: resolvedOutput,
    documentCount: documents.length,
    backupBytes: Buffer.byteLength(JSON.stringify(backup)),
    playerCount: countArray(registration, "players"),
    teamCount: countArray(registration, "teams"),
    matchCount: countArray(schedule, "matches"),
    restoredDocuments: restored.length,
    matchingChecksums: restored.filter((document) => document.matches).length,
    temporaryRestoreDeleted: deletionChecks.every(Boolean),
    passed,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!passed) process.exitCode = 2;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Gate 6 备份恢复演练失败");
  process.exitCode = 1;
});
