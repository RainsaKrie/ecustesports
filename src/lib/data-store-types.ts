export type DataUpdater<T> = (current: T) => T | Promise<T>;

export type DataDocumentBatch<T extends Record<string, unknown>> = {
  [K in keyof T]: { name: string; fallback: T[K] };
};

/**
 * 批量更新器返回需要写入的字段；未返回的字段只参与版本校验，不产生无意义写入。
 * 这允许把权限台账作为只读前置条件，与赛程/赛果在同一并发快照内校验。
 */
export type DataBatchUpdater<T extends Record<string, unknown>> = (
  current: Readonly<T>,
) => Partial<T> | Promise<Partial<T>>;

export interface DataStoreDriver {
  read<T>(scope: "site" | "event", eventId: string, name: string, fallback: T): Promise<T>;
  write<T>(scope: "site" | "event", eventId: string, name: string, value: T): Promise<void>;
  update<T>(
    scope: "site" | "event",
    eventId: string,
    name: string,
    fallback: T,
    updater: DataUpdater<T>,
  ): Promise<T>;
  updateMany<T extends Record<string, unknown>>(
    scope: "site" | "event",
    eventId: string,
    documents: DataDocumentBatch<T>,
    updater: DataBatchUpdater<T>,
  ): Promise<T>;
  deleteEvent(eventId: string): Promise<void>;
}

export function assertDocumentValue(value: unknown): void {
  if (typeof value !== "object" || value === null) {
    throw new Error("数据必须是对象或数组");
  }
}

export function assertSafeEventId(eventId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,60}$/.test(eventId)) {
    throw new Error("赛事 ID 不合法");
  }
  return eventId;
}

export function assertSafeDocumentName(name: string): string {
  if (!/^[a-zA-Z0-9_-]{1,60}$/.test(name)) {
    throw new Error("数据文档名称不合法");
  }
  return name;
}
