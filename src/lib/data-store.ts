// 统一数据接口：本地开发使用 JSON，Vercel 预发布与生产使用 Supabase。
// 路由不感知具体存储，避免两套业务逻辑分叉。

import { fileDataStore } from "@/lib/file-data-store";
import { supabaseDataStore } from "@/lib/supabase-data-store";
import type { DataStoreDriver, DataUpdater } from "@/lib/data-store-types";
import { isHostedRuntime } from "@/lib/deployment";

type DataBackend = "file" | "supabase";

function selectedBackend(): DataBackend {
  const configured = process.env.DATA_BACKEND?.trim().toLowerCase();
  if (configured === "file" || configured === "supabase") return configured;
  if (configured) throw new Error(`不支持的数据后端：${configured}`);

  // 本地开发保持兼容；任何 Vercel 环境必须显式选择，防止误写临时文件系统。
  if (isHostedRuntime()) {
    throw new Error("Vercel 环境必须显式设置 DATA_BACKEND=supabase");
  }
  return "file";
}

function driver(): DataStoreDriver {
  return selectedBackend() === "supabase" ? supabaseDataStore : fileDataStore;
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

export async function deleteEventData(eventId: string): Promise<void> {
  return driver().deleteEvent(eventId);
}
