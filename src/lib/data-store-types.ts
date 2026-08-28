export type DataUpdater<T> = (current: T) => T | Promise<T>;

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
