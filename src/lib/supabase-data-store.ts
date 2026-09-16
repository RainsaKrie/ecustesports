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

/**
 * 时钟偏差故障（PGRST303）的专用重试。
 *
 * Supabase 平台在请求时现场铸造 token，其 `iat` 可能比验证器时钟快 30 秒以上，
 * 被 PostgREST 拒绝（它只容忍 30 秒偏差）。**同一个 token 过一两秒就能通过**，
 * 所以这类失败必须等待后重试，而不是立刻抛错。
 *
 * 普通重试的 80/180ms 太短，跨不过这个窗口；因此单独给一组更长的延迟，
 * 并把尝试次数从 3 提到 4（总等待约 4.5 秒）。
 */
const CLOCK_SKEW_ATTEMPTS = 4;
const CLOCK_SKEW_RETRY_DELAYS_MS = [1000, 1500, 2000];

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

/**
 * 带 PostgREST 错误码的请求错误。
 *
 * 需要 code 是因为 **401 不能一概而论**：`PGRST303`（时钟偏差）值得重试，
 * 而其它 401（凭证真错）必须立即失败。只看 HTTP 状态码无法区分这两者。
 */
class SupabaseRequestError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, detail: string, code?: string) {
    super(`Supabase 数据请求失败（HTTP ${status}）${detail ? `：${detail.slice(0, 300)}` : ""}`);
    this.name = "SupabaseRequestError";
    this.status = status;
    this.code = code;
  }
}

async function responseError(response: Response): Promise<SupabaseRequestError> {
  const detail = await response.text().catch(() => "");
  let code: string | undefined;
  if (detail) {
    try {
      const parsed = JSON.parse(detail) as { code?: unknown };
      if (typeof parsed.code === "string") code = parsed.code;
    } catch {
      // 非 JSON 响应体：没有可用的错误码，交给统一错误处理。
    }
  }
  return new SupabaseRequestError(response.status, detail, code);
}

/**
 * 判定读取失败是否值得重试。
 *
 * 除 429 与 5xx 外，**还要重试 401 + PGRST303**：那是 Supabase 平台的时钟偏差故障
 * （status.supabase.com 的「401 errors due to JWT rejections」，2026-08 起多次发生），
 * 平台现场铸造的 token 的 iat 落在验证器时钟之后超过 30 秒，被 PostgREST 拒绝。
 * 同一个 token 过一两秒即可通过 —— 有报告指出「两个并发请求带同一 token，一个 401、一个 200」。
 *
 * ⚠️ 只对 PGRST303 放宽。**其它 401 必须立即失败**，否则会把「凭证配错」这类
 * 真实配置问题伪装成「偶发网络抖动」，排查难度大幅上升。
 */
function isRetryableReadStatus(status: number, code?: string): boolean {
  if (status === 429 || status >= 500) return true;
  return status === 401 && code === "PGRST303";
}

async function waitBeforeReadRetry(attempt: number, clockSkew = false): Promise<void> {
  const delays = clockSkew ? CLOCK_SKEW_RETRY_DELAYS_MS : READ_RETRY_DELAYS_MS;
  const baseDelay = delays[attempt] ?? delays.at(-1) ?? 180;
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
  // 一旦遇到时钟偏差故障，本次读取就切换到「更多次 + 更长等待」的重试策略。
  let clockSkewSeen = false;
  for (let attempt = 0; ; attempt += 1) {
    const maxAttempts = clockSkewSeen ? CLOCK_SKEW_ATTEMPTS : MAX_READ_ATTEMPTS;
    if (attempt >= maxAttempts) break;

    let response: Response;
    try {
      response = await fetch(url, {
        headers: headers(),
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      });
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts - 1) throw error;
      await waitBeforeReadRetry(attempt, clockSkewSeen);
      continue;
    }

    if (response.ok) {
      const rows = (await response.json()) as DocumentRow<T>[];
      return rows[0] ?? null;
    }

    const failure = await responseError(response);
    lastError = failure;

    // 平台的时钟偏差故障：token 的 iat 太新被拒，等一下再试就能过。
    const clockSkew = failure.status === 401 && failure.code === "PGRST303";
    if (clockSkew) clockSkewSeen = true;

    const limit = clockSkewSeen ? CLOCK_SKEW_ATTEMPTS : MAX_READ_ATTEMPTS;
    if (!isRetryableReadStatus(failure.status, failure.code) || attempt >= limit - 1) {
      throw lastError;
    }
    await waitBeforeReadRetry(attempt, clockSkewSeen);
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
