import {
  assertDocumentValue,
  assertSafeDocumentName,
  assertSafeEventId,
  type DataBatchUpdater,
  type DataDocumentBatch,
  type DataStoreDriver,
  type DataUpdater,
} from "@/lib/data-store-types";
import { normalizeSupabaseProjectUrl } from "@/lib/supabase-config";

interface DocumentRow<T> {
  payload: T;
  version: number;
}

const MAX_UPDATE_ATTEMPTS = 40;
const MAX_READ_ATTEMPTS = 3;
const READ_RETRY_DELAYS_MS = [80, 180];

function config(): { url: string; secret: string } {
  const url = normalizeSupabaseProjectUrl(process.env.SUPABASE_URL);
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) {
    throw new Error("Supabase 数据层缺少 SUPABASE_URL 或 SUPABASE_SECRET_KEY");
  }
  return { url, secret };
}

function identity(scope: "site" | "event", eventId: string, name: string) {
  const safeName = assertSafeDocumentName(name);
  return {
    scope,
    eventId: scope === "site" ? "__site__" : assertSafeEventId(eventId),
    name: safeName,
  };
}

function headers(prefer?: string): HeadersInit {
  const { secret } = config();
  return {
    apikey: secret,
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

function documentsUrl(filters?: Record<string, string>): string {
  const { url } = config();
  const endpoint = new URL(`${url}/rest/v1/app_documents`);
  for (const [key, value] of Object.entries(filters ?? {})) {
    endpoint.searchParams.set(key, value);
  }
  return endpoint.toString();
}

async function responseError(response: Response): Promise<Error> {
  const detail = await response.text().catch(() => "");
  return new Error(`Supabase 数据请求失败（HTTP ${response.status}）${detail ? `：${detail.slice(0, 300)}` : ""}`);
}

function isRetryableReadStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function waitBeforeReadRetry(attempt: number): Promise<void> {
  const baseDelay = READ_RETRY_DELAYS_MS[attempt] ?? READ_RETRY_DELAYS_MS.at(-1) ?? 180;
  const jitter = Math.floor(Math.random() * 40);
  await new Promise((resolve) => setTimeout(resolve, baseDelay + jitter));
}

async function waitBeforeUpdateRetry(attempt: number): Promise<void> {
  const baseDelay = Math.min(8 + attempt * 4, 80);
  const jitter = Math.floor(Math.random() * 60);
  await new Promise((resolve) => setTimeout(resolve, baseDelay + jitter));
}

async function readRow<T>(scope: "site" | "event", eventId: string, name: string): Promise<DocumentRow<T> | null> {
  const id = identity(scope, eventId, name);
  const url = documentsUrl({
    scope: `eq.${id.scope}`,
    event_id: `eq.${id.eventId}`,
    name: `eq.${id.name}`,
    select: "payload,version",
    limit: "1",
  });

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_READ_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: headers(),
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      });
    } catch (error) {
      lastError = error;
      if (attempt === MAX_READ_ATTEMPTS - 1) throw error;
      await waitBeforeReadRetry(attempt);
      continue;
    }

    if (response.ok) {
      const rows = (await response.json()) as DocumentRow<T>[];
      return rows[0] ?? null;
    }

    lastError = await responseError(response);
    if (!isRetryableReadStatus(response.status) || attempt === MAX_READ_ATTEMPTS - 1) {
      throw lastError;
    }
    await waitBeforeReadRetry(attempt);
  }

  throw lastError instanceof Error ? lastError : new Error("Supabase 数据读取失败");
}

async function insertIfMissing<T>(scope: "site" | "event", eventId: string, name: string, value: T): Promise<boolean> {
  const id = identity(scope, eventId, name);
  const response = await fetch(documentsUrl({ on_conflict: "scope,event_id,name", select: "version" }), {
    method: "POST",
    headers: headers("resolution=ignore-duplicates,return=representation"),
    body: JSON.stringify({
      scope: id.scope,
      event_id: id.eventId,
      name: id.name,
      payload: value,
      version: 1,
    }),
  });
  if (!response.ok) throw await responseError(response);
  const rows = (await response.json()) as Array<{ version: number }>;
  return rows.length === 1;
}

async function compareAndSwap<T>(
  scope: "site" | "event",
  eventId: string,
  name: string,
  version: number,
  value: T,
): Promise<boolean> {
  const id = identity(scope, eventId, name);
  const response = await fetch(
    documentsUrl({
      scope: `eq.${id.scope}`,
      event_id: `eq.${id.eventId}`,
      name: `eq.${id.name}`,
      version: `eq.${version}`,
      select: "version",
    }),
    {
      method: "PATCH",
      headers: headers("return=representation"),
      body: JSON.stringify({ payload: value, version: version + 1, updated_at: new Date().toISOString() }),
    },
  );
  if (!response.ok) throw await responseError(response);
  const rows = (await response.json()) as Array<{ version: number }>;
  return rows.length === 1;
}

async function compareAndSwapMany(
  scope: "site" | "event",
  eventId: string,
  expectedVersions: Record<string, number>,
  updates: Record<string, unknown>,
): Promise<boolean> {
  const id = identity(scope, eventId, "batch");
  const { url } = config();
  const response = await fetch(`${url}/rest/v1/rpc/update_app_documents_atomic`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      p_scope: id.scope,
      p_event_id: id.eventId,
      p_expected_versions: expectedVersions,
      p_updates: updates,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (detail) {
      try {
        const parsed = JSON.parse(detail) as { code?: unknown };
        if (parsed.code === "40001") return false;
      } catch {
        // 非 JSON 错误交给统一错误处理。
      }
    }
    throw new Error(`Supabase 数据请求失败（HTTP ${response.status}）${detail ? `：${detail.slice(0, 300)}` : ""}`);
  }
  return (await response.json()) === true;
}

export const supabaseDataStore: DataStoreDriver = {
  async read<T>(scope: "site" | "event", eventId: string, name: string, fallback: T): Promise<T> {
    const row = await readRow<T>(scope, eventId, name);
    return row?.payload ?? fallback;
  },

  async write<T>(scope: "site" | "event", eventId: string, name: string, value: T): Promise<void> {
    assertDocumentValue(value);
    for (let attempt = 0; attempt < MAX_UPDATE_ATTEMPTS; attempt += 1) {
      const row = await readRow<T>(scope, eventId, name);
      if (!row) {
        if (await insertIfMissing(scope, eventId, name, value)) return;
        await waitBeforeUpdateRetry(attempt);
        continue;
      }
      if (await compareAndSwap(scope, eventId, name, row.version, value)) return;
      await waitBeforeUpdateRetry(attempt);
    }
    throw new Error("数据已被其他操作连续修改，请刷新后重试");
  },

  async update<T>(
    scope: "site" | "event",
    eventId: string,
    name: string,
    fallback: T,
    updater: DataUpdater<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < MAX_UPDATE_ATTEMPTS; attempt += 1) {
      const row = await readRow<T>(scope, eventId, name);
      const current = row?.payload ?? fallback;
      const next = await updater(current);
      assertDocumentValue(next);

      if (!row) {
        if (await insertIfMissing(scope, eventId, name, next)) return next;
        await waitBeforeUpdateRetry(attempt);
        continue;
      }

      if (await compareAndSwap(scope, eventId, name, row.version, next)) return next;
      await waitBeforeUpdateRetry(attempt);
    }
    throw new Error("数据已被其他操作连续修改，请刷新后重试");
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

    for (let attempt = 0; attempt < MAX_UPDATE_ATTEMPTS; attempt += 1) {
      const rows = await Promise.all(entries.map(([, spec]) => readRow<unknown>(scope, eventId, spec.name)));
      const currentValues: Record<string, unknown> = {};
      const expectedVersions: Record<string, number> = {};
      entries.forEach(([key, spec], index) => {
        const row = rows[index];
        currentValues[key] = (row?.payload ?? spec.fallback) as T[typeof key];
        expectedVersions[spec.name] = row?.version ?? 0;
      });

      const current = currentValues as T;
      const patch = await updater(current);
      const knownKeys = new Set(entries.map(([key]) => key));
      const updates: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(patch) as Array<[keyof T & string, T[keyof T]]>) {
        if (!knownKeys.has(key)) throw new Error(`批量更新包含未知文档：${key}`);
        assertDocumentValue(value);
        updates[documents[key].name] = value;
      }

      if (await compareAndSwapMany(scope, eventId, expectedVersions, updates)) {
        return { ...current, ...patch } as T;
      }
      await waitBeforeUpdateRetry(attempt);
    }
    throw new Error("数据已被其他操作连续修改，请刷新后重试");
  },

  async deleteEvent(eventId: string): Promise<void> {
    const safeId = assertSafeEventId(eventId);
    const response = await fetch(documentsUrl({ event_id: `eq.${safeId}` }), {
      method: "DELETE",
      headers: headers("return=minimal"),
    });
    if (!response.ok) throw await responseError(response);
  },
};
