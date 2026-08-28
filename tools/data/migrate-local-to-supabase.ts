import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { supabaseDataStore } from "../../src/lib/supabase-data-store";

interface Candidate {
  scope: "site" | "event";
  eventId: string;
  name: string;
  filePath: string;
  bytes: number;
}

const root = process.cwd();
loadEnvConfig(root);
const dataRoot = path.join(root, "data");
const apply = process.argv.includes("--apply");
const eventArg = process.argv.find((arg) => arg.startsWith("--event="));
const selectedEvent = eventArg?.slice("--event=".length).trim();

function documentName(fileName: string): string {
  return fileName.replace(/\.json$/i, "");
}

async function jsonFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => entry.name);
}

async function collect(): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  for (const fileName of await jsonFiles(dataRoot)) {
    const filePath = path.join(dataRoot, fileName);
    candidates.push({
      scope: "site",
      eventId: "",
      name: documentName(fileName),
      filePath,
      bytes: (await stat(filePath)).size,
    });
  }

  const eventEntries = await readdir(path.join(dataRoot, "events"), { withFileTypes: true }).catch(() => []);
  for (const eventEntry of eventEntries) {
    if (!eventEntry.isDirectory()) continue;
    if (selectedEvent && eventEntry.name !== selectedEvent) continue;
    const eventDirectory = path.join(dataRoot, "events", eventEntry.name);
    for (const fileName of await jsonFiles(eventDirectory)) {
      const filePath = path.join(eventDirectory, fileName);
      candidates.push({
        scope: "event",
        eventId: eventEntry.name,
        name: documentName(fileName),
        filePath,
        bytes: (await stat(filePath)).size,
      });
    }
  }
  return candidates;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function main() {
  const candidates = await collect();
  const totalBytes = candidates.reduce((sum, candidate) => sum + candidate.bytes, 0);
  console.log(`迁移计划：${candidates.length} 份文档，${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
  for (const candidate of candidates) {
    console.log(`- ${candidate.scope === "site" ? "站点" : candidate.eventId}/${candidate.name} · ${candidate.bytes} B`);
  }

  if (!apply) {
    console.log("仅完成预检；确认 Supabase migration 已执行后，再使用 --apply 写入。");
    return;
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    throw new Error("执行迁移前必须设置 SUPABASE_URL 与 SUPABASE_SECRET_KEY");
  }

  for (const candidate of candidates) {
    const value = JSON.parse(await readFile(candidate.filePath, "utf8")) as unknown;
    await supabaseDataStore.write(candidate.scope, candidate.eventId, candidate.name, value);
    const stored = await supabaseDataStore.read(candidate.scope, candidate.eventId, candidate.name, null);
    if (stable(stored) !== stable(value)) {
      throw new Error(`写入后核对失败：${candidate.eventId || "site"}/${candidate.name}`);
    }
    console.log(`✓ ${candidate.eventId || "site"}/${candidate.name}`);
  }
  console.log(`迁移并核对完成：${candidates.length}/${candidates.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
