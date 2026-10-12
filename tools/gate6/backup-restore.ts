// =====================
// 赛事数据的导出与恢复演练
//
// 三条规矩（都是踩出来的）：
//
//  1. **导出的算法不在这里**，在 `./backup-format`。生成端与校验端各写一份 `stable/checksum`
//     的后果是两边悄悄走偏——校验工具会对一份完好的备份报错，从此没人再相信它。
//
//  2. **哪一份文档不存在，不是失败。** 旧版遇到缺失就直接 throw，于是「这场赛事还没做过 BP」
//     会让**整份备份一个字都写不出来**。救命工具输在缺一份可选文档上，这是错的失败方式：
//     现在它照常导出，把那一条记成 `sha256: null` 并在报告里点名。
//
//  3. **写完立刻自校验**（见 main 里 `verifyBackup` 那一段），保证「写出」与「校验」两端真的一致。
//
// 只读校验（任何时候都能跑，含比赛进行中）：npm run ops:verify-backup -- <仓库外的备份文件>
//
// 用法（走 npm 脚本，别直接敲 npx —— 本机 npx 不可用）：
//   导出备份（只读，可对生产执行）
//     npm run ops:backup -- --event=event-1 D:\ecust-backups\2026-10-12.json
//   恢复演练（会写入临时赛事再删除，只能在隔离库执行）
//     npm run ops:backup-drill -- --event=<赛事ID> <仓库外路径>
//
// 两个脚本名分开，是为了让「写库」这件事必须**换个命令名**才做得到：
// `ops:backup` 里已经钉死了 --backup-only，顺手敲的那条永远是只读的。
// =====================

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { supabaseDataStore } from "../../src/lib/supabase-data-store";
import {
  BACKUP_SCHEMA_VERSION,
  checksum,
  documentKey,
  verifyBackup,
  type BackupDocument,
} from "./backup-format";

/** 只说明「去哪里取哪一份」，不含内容。 */
type DocumentSpec = Pick<BackupDocument, "scope" | "eventId" | "name">;

/**
 * 不指定 --event 时的默认值。
 *
 * 刻意用**生产的赛事 ID**：这个工具是给生产导出用的，万一有人漏了 --event，
 * 默认值应该落在「真的那场赛事」上，而不是本地夹具的 ID（event-mt8f43vq）。
 * 即便如此，漏错赛事也不会静默通过 —— 五份文档会全部记成 absent，`passed` 随之为 false。
 */
const DEFAULT_EVENT_ID = "event-1";

function documentSpecs(eventId: string): DocumentSpec[] {
  return [
    { scope: "site", eventId: "", name: "site-config" },
    { scope: "event", eventId, name: "registration" },
    { scope: "event", eventId, name: "format" },
    { scope: "event", eventId, name: "schedule" },
    { scope: "event", eventId, name: "bp" },
  ];
}

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

function countArray(value: unknown, key: string): number {
  if (!value || typeof value !== "object") return 0;
  const candidate = (value as Record<string, unknown>)[key];
  return Array.isArray(candidate) ? candidate.length : 0;
}

async function main() {
  loadEnvConfig(process.cwd(), true);
  const { flags, positional } = parseArgs(process.argv.slice(2));
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    throw new Error("Gate 6 备份恢复演练缺少 Supabase 配置：需要 SUPABASE_URL 与 SUPABASE_SECRET_KEY");
  }

  const backupOnly = flags.has("backup-only");
  const eventId = flags.get("event") || process.env.BACKUP_EVENT_ID || DEFAULT_EVENT_ID;
  const label = flags.get("label") || "Supabase";

  const outputPath = positional[0];
  if (!outputPath) throw new Error("请提供仓库外的备份文件路径");
  const resolvedOutput = path.resolve(outputPath);
  if (resolvedOutput.startsWith(path.resolve(process.cwd()))) {
    throw new Error("备份文件不能写入项目仓库");
  }
  // 不许静默覆盖：上一次的备份可能就是唯一一份好副本，被无声顶掉是不可挽回的。
  // 想覆盖请显式写 --overwrite。
  if (existsSync(resolvedOutput) && !flags.has("overwrite")) {
    throw new Error(`这个路径已经有文件了：${resolvedOutput}\n`
      + "备份是被覆盖不回来的东西 —— 换个文件名（推荐带日期），或者确认要顶掉它再加 --overwrite。");
  }

  const missing = { __gate6Missing: true };
  const documents: BackupDocument[] = [];
  const absentDocuments: string[] = [];
  for (const spec of documentSpecs(eventId)) {
    const payload = await supabaseDataStore.read<unknown>(spec.scope, spec.eventId, spec.name, missing);
    const isMissing = payload === missing
      || (Boolean(payload) && typeof payload === "object" && "__gate6Missing" in (payload as object));
    // 缺一份不阻断整份备份：记成 sha256=null（导出时即不存在），由校验端判成 absent 而不是失败。
    if (isMissing) {
      absentDocuments.push(documentKey(spec));
      documents.push({ ...spec, sha256: null });
      continue;
    }
    documents.push({ ...spec, sha256: checksum(payload), payload });
  }

  const backup = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    source: label,
    documents,
  };
  await mkdir(path.dirname(resolvedOutput), { recursive: true });
  await writeFile(resolvedOutput, `${JSON.stringify(backup, null, 2)}\n`, "utf8");

  // 写完立刻自校验：拿刚落盘的那串字，重新解析、重新算校验和。
  // 若这里不通过，说明「写出」与「校验」两端已经不一致 —— 那这份备份是不可信的，必须当场炸掉。
  const persisted = JSON.parse(await readFile(resolvedOutput, "utf8")) as typeof backup;
  const selfCheck = verifyBackup(persisted);
  if (!selfCheck.ok) {
    throw new Error(`刚写出的备份没能通过自校验（这不该发生，请连同这条信息一起报告）：${selfCheck.problems.join("；")}\n`
      + `这份文件在 ${resolvedOutput}，**别拿它去恢复**。`);
  }

  // 能拿去恢复的只有「真的有内容」的那几份。
  const restorable = persisted.documents.filter((document) => document.sha256 !== null && "payload" in document);

  // --backup-only：只导出，不写库。可以对着生产执行。
  let drill = { performed: false, restorableDocuments: restorable.length, restoredDocuments: 0, matchingChecksums: 0, temporaryRestoreDeleted: false };
  if (!backupOnly) {
    const restoreEventId = `gate6restore-${randomUUID().slice(0, 8)}`;
    const restored: Array<{ name: string; sourceSha256: string; restoredSha256: string; matches: boolean }> = [];
    try {
      for (const document of restorable) {
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
          sourceSha256: document.sha256 as string,
          restoredSha256,
          matches: restoredSha256 === document.sha256,
        });
      }
    } finally {
      await supabaseDataStore.deleteEvent(restoreEventId);
    }

    const deletionChecks = await Promise.all(
      restorable.map(async (document) => {
        const restoreName = document.scope === "site" ? `site-${document.name}` : document.name;
        const value = await supabaseDataStore.read<unknown>("event", restoreEventId, restoreName, missing);
        return value === missing || (Boolean(value) && typeof value === "object" && "__gate6Missing" in (value as object));
      }),
    );
    drill = {
      performed: true,
      restorableDocuments: restorable.length,
      restoredDocuments: restored.length,
      matchingChecksums: restored.filter((document) => document.matches).length,
      temporaryRestoreDeleted: deletionChecks.every(Boolean),
    };
  }

  const registration = documents.find((document) => document.name === "registration")?.payload;
  const schedule = documents.find((document) => document.name === "schedule")?.payload;
  // `passed` 只回答一个问题：**这份备份可信吗**。
  // 旧版写的是 `!drill.performed || ...`，于是 --backup-only 下它**恒为 true** ——
  // 一个永远说「通过」的字段比没有字段更糟（文档还据此说「passed 表示五份全导出成功」，也是错的）。
  // 「缺了哪几份」由 absentDocuments 单独说，不混进这里。
  const passed = selfCheck.ok
    && restorable.length > 0
    && (!drill.performed
      || (drill.restoredDocuments === drill.restorableDocuments
        && drill.matchingChecksums === drill.restorableDocuments
        && drill.temporaryRestoreDeleted));
  const report = {
    recordedAt: new Date().toISOString(),
    mode: backupOnly ? "backup-only（未做恢复演练）" : "backup-and-drill（含恢复演练）",
    eventId,
    outputPath: resolvedOutput,
    documentCount: documents.length,
    /** 导出时就不存在的文档（例如没做过 BP 的赛事）。空数组才表示五份齐活。 */
    absentDocuments,
    backupBytes: Buffer.byteLength(JSON.stringify(backup)),
    selfVerifiedAfterWrite: selfCheck.ok,
    playerCount: countArray(registration, "players"),
    teamCount: countArray(registration, "teams"),
    matchCount: countArray(schedule, "matches"),
    restorableDocuments: drill.restorableDocuments,
    restoredDocuments: drill.restoredDocuments,
    matchingChecksums: drill.matchingChecksums,
    temporaryRestoreDeleted: drill.temporaryRestoreDeleted,
    passed,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (absentDocuments.length > 0) {
    process.stdout.write(`注意：有 ${absentDocuments.length} 份文档在导出时就不存在（${absentDocuments.join("、")}）。\n`);
  }
  if (!passed) process.exitCode = 2;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Gate 6 备份恢复演练失败");
  process.exitCode = 1;
});
