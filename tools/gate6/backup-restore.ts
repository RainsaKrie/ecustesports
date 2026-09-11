import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { supabaseDataStore } from "../../src/lib/supabase-data-store";
import {
  BACKUP_SCHEMA_VERSION,
  arrayLength,
  checksum,
  verifyBackup,
  type BackupDocument,
  type BackupDocumentSpec,
  type BackupFile,
} from "./backup-format";

/**
 * 备份与恢复演练（SYS-02 §4）。
 *
 * 用法：
 *   备份（只读导出 + 自校验，可对生产执行）
 *     tsx tools/gate6/backup-restore.ts --backup-only --event=<赛事ID> --label=生产 <仓库外路径>
 *
 *   恢复演练（会写入临时赛事再删除，只能在隔离库执行）
 *     tsx tools/gate6/backup-restore.ts --event=<赛事ID> <仓库外路径>
 *
 * 需要环境变量：SUPABASE_URL、SUPABASE_SECRET_KEY（只从环境读，不写进任何文件）。
 * 备份文件必须落在仓库之外，避免被提交进 Git。
 */

const DEFAULT_EVENT_ID = "event-mt8f43vq";

function parseArgs(argv: string[]) {
  const flags = new Map<string, string>();
  const positional: string[] = [];
  for (const raw of argv) {
    if (raw.startsWith("--")) {
      const [key, ...rest] = raw.replace(/^--/, "").split("=");
      flags.set(key, rest.join("=") || "true");
    } else {
      positional.push(raw);
    }
  }
  return { flags, positional };
}

function documentSpecs(eventId: string): BackupDocumentSpec[] {
  return [
    { scope: "site", eventId: "", name: "site-config" },
    { scope: "event", eventId, name: "registration" },
    { scope: "event", eventId, name: "format" },
    { scope: "event", eventId, name: "schedule" },
    { scope: "event", eventId, name: "bp" },
  ];
}

async function main() {
  loadEnvConfig(process.cwd(), true);
  const { flags, positional } = parseArgs(process.argv.slice(2));

  const outputPath = positional[0];
  if (!outputPath) {
    throw new Error("请提供仓库外的备份文件路径：tsx tools/gate6/backup-restore.ts [--backup-only] [--event=<赛事ID>] <路径>");
  }
  const backupOnly = flags.has("backup-only");
  const eventId = flags.get("event") || process.env.BACKUP_EVENT_ID || DEFAULT_EVENT_ID;
  const label = flags.get("label") || "Supabase";

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    throw new Error("缺少 Supabase 配置：需要环境变量 SUPABASE_URL 与 SUPABASE_SECRET_KEY");
  }

  const resolvedOutput = path.resolve(outputPath);
  if (resolvedOutput.startsWith(path.resolve(process.cwd()))) {
    throw new Error("备份文件不能写入项目仓库，请换到仓库之外的目录");
  }

  const specs = documentSpecs(eventId);
  const missing = { __gate6Missing: true };
  const documents: BackupDocument[] = [];
  for (const spec of specs) {
    const payload = await supabaseDataStore.read<unknown>(spec.scope, spec.eventId, spec.name, missing);
    if (payload === missing || (payload && typeof payload === "object" && "__gate6Missing" in payload)) {
      throw new Error(`源文档不存在：${spec.scope}/${spec.eventId || "__site__"}/${spec.name}`);
    }
    documents.push({ ...spec, sha256: checksum(payload), payload });
  }

  const backup: BackupFile = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    source: label,
    documents,
  };
  await mkdir(path.dirname(resolvedOutput), { recursive: true });
  await writeFile(resolvedOutput, `${JSON.stringify(backup, null, 2)}\n`, "utf8");

  // 写完立即按落盘内容自校验，保证「导出」与「校验」两端算法一致。
  const persisted = JSON.parse(await readFile(resolvedOutput, "utf8")) as BackupFile;
  const local = verifyBackup(persisted);
  if (!local.ok) {
    throw new Error(`备份写出后自校验失败：${[...local.problems, ...local.mismatches.map((m) => m.key)].join("；")}`);
  }

  // 恢复演练会写入临时赛事再删除，只能对隔离库执行，生产一律跳过。
  let drill: { performed: boolean; restoredDocuments: number; matchingChecksums: number; temporaryRestoreDeleted: boolean } = {
    performed: false,
    restoredDocuments: 0,
    matchingChecksums: 0,
    temporaryRestoreDeleted: false,
  };
  if (!backupOnly) {
    const restoreEventId = `gate6restore-${randomUUID().slice(0, 8)}`;
    const restored: Array<{ matches: boolean }> = [];
    try {
      for (const document of persisted.documents) {
        const restoreName = document.scope === "site" ? `site-${document.name}` : document.name;
        await supabaseDataStore.write("event", restoreEventId, restoreName, document.payload);
        const restoredPayload = await supabaseDataStore.read<unknown>("event", restoreEventId, restoreName, missing);
        restored.push({ matches: checksum(restoredPayload) === document.sha256 });
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
    drill = {
      performed: true,
      restoredDocuments: restored.length,
      matchingChecksums: restored.filter((document) => document.matches).length,
      temporaryRestoreDeleted: deletionChecks.every(Boolean),
    };
  }

  const registration = documents.find((document) => document.name === "registration")?.payload;
  const schedule = documents.find((document) => document.name === "schedule")?.payload;
  const drillPassed = !drill.performed
    || (drill.restoredDocuments === documents.length
      && drill.matchingChecksums === documents.length
      && drill.temporaryRestoreDeleted);
  const passed = local.ok && drillPassed;

  const report = {
    recordedAt: new Date().toISOString(),
    mode: backupOnly ? "backup-only（未做恢复演练）" : "backup-and-drill（含恢复演练）",
    source: label,
    eventId,
    outputPath: resolvedOutput,
    documentCount: documents.length,
    backupBytes: Buffer.byteLength(JSON.stringify(backup)),
    localVerifyOk: local.ok,
    localVerifyMatched: local.matched,
    playerCount: arrayLength(registration, "players"),
    teamCount: arrayLength(registration, "teams"),
    matchCount: arrayLength(schedule, "matches"),
    restoreDrill: drill,
    passed,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!passed) process.exitCode = 2;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "备份任务失败");
  process.exitCode = 1;
});
