// 统一数据接口：本地开发使用 JSON，Vercel 预发布与生产使用 Supabase。
// 路由不感知具体存储，避免两套业务逻辑分叉。

import { fileDataStore } from "@/lib/file-data-store";
import { supabaseDataStore } from "@/lib/supabase-data-store";
import type {
  DataBatchUpdater,
  DataDocumentBatch,
  DataStoreDriver,
  DataUpdater,
} from "@/lib/data-store-types";
import { resolveDataBackend } from "@/lib/data-backend";

function driver(): DataStoreDriver {
  return resolveDataBackend() === "supabase" ? supabaseDataStore : fileDataStore;
}

export async function readData<T>(name: string, fallback: T): Promise<T> {
  return driver().read("site", "", name, fallback);
}

export async function writeData<T>(name: string, value: T): Promise<void> {
  return driver().write("site", "", name, value);
}

export async function updateData<T>(name: string, fallback: T, updater: DataUpdater<T>): Promise<T> {
  return driver().update("site", "", name, fallback, updater);
}

export async function readEventData<T>(eventId: string, name: string, fallback: T): Promise<T> {
  return driver().read("event", eventId, name, fallback);
}

export async function writeEventData<T>(eventId: string, name: string, value: T): Promise<void> {
  return driver().write("event", eventId, name, value);
}

export async function updateEventData<T>(
  eventId: string,
  name: string,
  fallback: T,
  updater: DataUpdater<T>,
): Promise<T> {
  return driver().update("event", eventId, name, fallback, updater);
}

/** 多文档原子更新：生产由 PostgreSQL 事务保证，本地由赛事级写锁保证。 */
export async function updateEventDataBatch<T extends Record<string, unknown>>(
  eventId: string,
  documents: DataDocumentBatch<T>,
  updater: DataBatchUpdater<T>,
): Promise<T> {
  return driver().updateMany("event", eventId, documents, updater);
}

export async function deleteEventData(eventId: string): Promise<void> {
  return driver().deleteEvent(eventId);
}
