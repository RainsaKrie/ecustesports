// =====================
// 通用数据文件存储
// 站点级：data/{name}.json（如 site-config.json）
// 赛事级：data/events/{eventId}/{name}.json（如 schedule.json）
// 原子写入（临时文件 + rename），避免写入中断损坏文件
// =====================

import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";

const dataDirectory = path.join(process.cwd(), "data");

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
  const tmpPath = `${filePath}.tmp`;
  // 先写临时文件，再原子替换，避免写入中断留下半截文件
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmpPath, filePath);
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
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmpPath, filePath);
}
