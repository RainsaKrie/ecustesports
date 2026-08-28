import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  assertDocumentValue,
  assertSafeDocumentName,
  assertSafeEventId,
  type DataStoreDriver,
  type DataUpdater,
} from "@/lib/data-store-types";

const dataDirectory = path.join(process.cwd(), "data");
const fileQueues = new Map<string, Promise<void>>();

async function withFileLock<T>(filePath: string, task: () => Promise<T>): Promise<T> {
  const previous = fileQueues.get(filePath) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  fileQueues.set(filePath, queued);
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (fileQueues.get(filePath) === queued) fileQueues.delete(filePath);
  }
}

async function atomicWrite<T>(filePath: string, value: T): Promise<void> {
  const tmpPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tmpPath, filePath);
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function filePathFor(scope: "site" | "event", eventId: string, name: string): string {
  const safeName = assertSafeDocumentName(name);
  if (scope === "site") return path.join(dataDirectory, `${safeName}.json`);
  return path.join(dataDirectory, "events", assertSafeEventId(eventId), `${safeName}.json`);
}

export const fileDataStore: DataStoreDriver = {
  async read<T>(scope: "site" | "event", eventId: string, name: string, fallback: T): Promise<T> {
    try {
      const raw = await readFile(filePathFor(scope, eventId, name), "utf8");
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  },

  async write<T>(scope: "site" | "event", eventId: string, name: string, value: T): Promise<void> {
    assertDocumentValue(value);
    const filePath = filePathFor(scope, eventId, name);
    await mkdir(path.dirname(filePath), { recursive: true });
    await withFileLock(filePath, () => atomicWrite(filePath, value));
  },

  async update<T>(
    scope: "site" | "event",
    eventId: string,
    name: string,
    fallback: T,
    updater: DataUpdater<T>,
  ): Promise<T> {
    const filePath = filePathFor(scope, eventId, name);
    return withFileLock(filePath, async () => {
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

  async deleteEvent(eventId: string): Promise<void> {
    const safeId = assertSafeEventId(eventId);
    const eventsDirectory = path.resolve(dataDirectory, "events");
    const eventDirectory = path.resolve(eventsDirectory, safeId);
    if (path.dirname(eventDirectory) !== eventsDirectory) {
      throw new Error("赛事数据目录不合法");
    }
    await rm(eventDirectory, { recursive: true, force: true });
  },
};
