import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  assertDocumentValue,
  assertSafeDocumentName,
  assertSafeEventId,
  type DataBatchUpdater,
  type DataDocumentBatch,
  type DataStoreDriver,
  type DataUpdater,
} from "@/lib/data-store-types";

const dataDirectory = path.join(process.cwd(), "data");
const scopeQueues = new Map<string, Promise<void>>();

async function withScopeLock<T>(scopeKey: string, task: () => Promise<T>): Promise<T> {
  const previous = scopeQueues.get(scopeKey) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  scopeQueues.set(scopeKey, queued);
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (scopeQueues.get(scopeKey) === queued) scopeQueues.delete(scopeKey);
  }
}

async function atomicWriteText(filePath: string, content: string): Promise<void> {
  const tmpPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(tmpPath, content, "utf8");
    await rename(tmpPath, filePath);
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function atomicWrite<T>(filePath: string, value: T): Promise<void> {
  await atomicWriteText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function scopeKeyFor(scope: "site" | "event", eventId: string): string {
  return scope === "site" ? "site" : `event:${assertSafeEventId(eventId)}`;
}

function filePathFor(scope: "site" | "event", eventId: string, name: string): string {
  const safeName = assertSafeDocumentName(name);
  if (scope === "site") return path.join(dataDirectory, `${safeName}.json`);
  return path.join(dataDirectory, "events", assertSafeEventId(eventId), `${safeName}.json`);
}

export const fileDataStore: DataStoreDriver = {
  async read<T>(scope: "site" | "event", eventId: string, name: string, fallback: T): Promise<T> {
    const scopeKey = scopeKeyFor(scope, eventId);
    return withScopeLock(scopeKey, async () => {
      try {
        const raw = await readFile(filePathFor(scope, eventId, name), "utf8");
        return JSON.parse(raw) as T;
      } catch {
        return fallback;
      }
    });
  },

  async write<T>(scope: "site" | "event", eventId: string, name: string, value: T): Promise<void> {
    assertDocumentValue(value);
    const filePath = filePathFor(scope, eventId, name);
    const scopeKey = scopeKeyFor(scope, eventId);
    await withScopeLock(scopeKey, async () => {
      await mkdir(path.dirname(filePath), { recursive: true });
      await atomicWrite(filePath, value);
    });
  },

  async update<T>(
    scope: "site" | "event",
    eventId: string,
    name: string,
    fallback: T,
    updater: DataUpdater<T>,
  ): Promise<T> {
    const filePath = filePathFor(scope, eventId, name);
    const scopeKey = scopeKeyFor(scope, eventId);
    return withScopeLock(scopeKey, async () => {
      await mkdir(path.dirname(filePath), { recursive: true });
      let current = fallback;
      try {
        current = JSON.parse(await readFile(filePath, "utf8")) as T;
      } catch {
        // 新文档首次写入时使用调用方给定的空状态。
      }
      const next = await updater(current);
      assertDocumentValue(next);
      await atomicWrite(filePath, next);
      return next;
    });
  },

  async updateMany<T extends Record<string, unknown>>(
    scope: "site" | "event",
    eventId: string,
    documents: DataDocumentBatch<T>,
    updater: DataBatchUpdater<T>,
  ): Promise<T> {
    const entries = Object.entries(documents) as Array<[keyof T & string, { name: string; fallback: T[keyof T] }]>;
    if (entries.length === 0) throw new Error("批量更新至少需要一个数据文档");

    const names = new Set<string>();
    for (const [, spec] of entries) {
      const name = assertSafeDocumentName(spec.name);
      if (names.has(name)) throw new Error("批量更新的数据文档名称不能重复");
      names.add(name);
    }

    const scopeKey = scopeKeyFor(scope, eventId);
    return withScopeLock(scopeKey, async () => {
      const currentValues: Record<string, unknown> = {};
      const originalRaw = new Map<string, string | null>();

      for (const [key, spec] of entries) {
        const filePath = filePathFor(scope, eventId, spec.name);
        try {
          const raw = await readFile(filePath, "utf8");
          originalRaw.set(filePath, raw);
          currentValues[key] = JSON.parse(raw) as T[typeof key];
        } catch {
          originalRaw.set(filePath, null);
          currentValues[key] = spec.fallback;
        }
      }

      const current = currentValues as T;
      const patch = await updater(current);
      const knownKeys = new Set(entries.map(([key]) => key));
      const patchEntries = Object.entries(patch) as Array<[keyof T & string, T[keyof T]]>;
      for (const [key, value] of patchEntries) {
        if (!knownKeys.has(key)) throw new Error(`批量更新包含未知文档：${key}`);
        assertDocumentValue(value);
      }

      const next = { ...current, ...patch } as T;
      const writtenPaths: string[] = [];
      try {
        for (const [key, value] of patchEntries) {
          const filePath = filePathFor(scope, eventId, documents[key].name);
          await mkdir(path.dirname(filePath), { recursive: true });
          await atomicWrite(filePath, value);
          writtenPaths.push(filePath);
        }
      } catch (error) {
        for (const filePath of writtenPaths.reverse()) {
          const original = originalRaw.get(filePath);
          if (original === null || original === undefined) {
            await rm(filePath, { force: true }).catch(() => undefined);
          } else {
            await atomicWriteText(filePath, original).catch(() => undefined);
          }
        }
        throw error;
      }
      return next;
    });
  },

  async deleteEvent(eventId: string): Promise<void> {
    const safeId = assertSafeEventId(eventId);
    const eventsDirectory = path.resolve(dataDirectory, "events");
    const eventDirectory = path.resolve(eventsDirectory, safeId);
    if (path.dirname(eventDirectory) !== eventsDirectory) {
      throw new Error("赛事数据目录不合法");
    }
    await withScopeLock(scopeKeyFor("event", safeId), () => rm(eventDirectory, { recursive: true, force: true }));
  },
};
