// =====================
// 通用数据文件存储
// 站点级：data/{name}.json（如 site-config.json）
// 赛事级：data/events/{eventId}/{name}.json（如 schedule.json）
// 原子写入（临时文件 + rename），避免写入中断损坏文件
// =====================

import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

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

export async function readData<T>(name: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path.join(dataDirectory, `${name}.json`), "utf8");
    const parsed = JSON.parse(raw);
    return parsed as T;
  } catch {
    return fallback;
  }
}

export async function writeData<T>(name: string, value: T): Promise<void> {
  // 只接受对象（或数组），拒绝字符串等标量，避免写入损坏数据
  if (typeof value !== "object" || value === null) {
    throw new Error("数据必须是对象或数组");
  }

  await mkdir(dataDirectory, { recursive: true });
  const filePath = path.join(dataDirectory, `${name}.json`);
  await withFileLock(filePath, () => atomicWrite(filePath, value));
}

/** 在同一服务进程内串行执行“读取 → 修改 → 写入”，避免并发覆盖。 */
export async function updateData<T>(
  name: string,
  fallback: T,
  updater: (current: T) => T | Promise<T>,
): Promise<T> {
  const filePath = path.join(dataDirectory, `${name}.json`);
  return withFileLock(filePath, async () => {
    await mkdir(dataDirectory, { recursive: true });
    let current = fallback;
    try {
      current = JSON.parse(await readFile(filePath, "utf8")) as T;
    } catch {
      // 文件不存在或损坏时从明确的空状态开始。
    }
    const next = await updater(current);
    if (typeof next !== "object" || next === null) throw new Error("数据必须是对象或数组");
    await atomicWrite(filePath, next);
    return next;
  });
}

/** 校验 eventId：只允许字母、数字、连字符和下划线，防止路径穿越 */
function safeEventId(eventId: string): string {
  return /^[a-zA-Z0-9_-]{1,60}$/.test(eventId) ? eventId : "event-1";
}

/** 读某个赛事的数据文件（data/events/{eventId}/{name}.json） */
export async function readEventData<T>(eventId: string, name: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path.join(dataDirectory, "events", safeEventId(eventId), `${name}.json`), "utf8");
    const parsed = JSON.parse(raw);
    return parsed as T;
  } catch {
    return fallback;
  }
}

/** 写某个赛事的数据文件（data/events/{eventId}/{name}.json） */
export async function writeEventData<T>(eventId: string, name: string, value: T): Promise<void> {
  if (typeof value !== "object" || value === null) {
    throw new Error("数据必须是对象或数组");
  }

  const dir = path.join(dataDirectory, "events", safeEventId(eventId));
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${name}.json`);
  await withFileLock(filePath, () => atomicWrite(filePath, value));
}

/** 赛事级原子更新；适用于并发报名、组队申请和赛程调整。 */
export async function updateEventData<T>(
  eventId: string,
  name: string,
  fallback: T,
  updater: (current: T) => T | Promise<T>,
): Promise<T> {
  const dir = path.join(dataDirectory, "events", safeEventId(eventId));
  const filePath = path.join(dir, `${name}.json`);
  return withFileLock(filePath, async () => {
    await mkdir(dir, { recursive: true });
    let current = fallback;
    try {
      current = JSON.parse(await readFile(filePath, "utf8")) as T;
    } catch {
      // 新赛事首次写入时使用传入的空状态。
    }
    const next = await updater(current);
    if (typeof next !== "object" || next === null) throw new Error("数据必须是对象或数组");
    await atomicWrite(filePath, next);
    return next;
  });
}
