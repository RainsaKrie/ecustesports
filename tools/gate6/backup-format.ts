import { createHash } from "node:crypto";

/**
 * 备份文件的格式与校验算法（SYS-02 §5）。
 *
 * 备份生成（backup-restore.ts）与备份校验（backup-verify.ts）必须使用同一套算法，
 * 因此集中放在这里，避免两边各写一份后悄悄走偏、导致校验工具误报。
 */

export const BACKUP_SCHEMA_VERSION = 1;

export interface BackupDocumentSpec {
  scope: "site" | "event";
  eventId: string;
  name: string;
}

export interface BackupDocument extends BackupDocumentSpec {
  sha256: string;
  payload: unknown;
}

export interface BackupFile {
  schemaVersion: number;
  exportedAt: string;
  source: string;
  documents: BackupDocument[];
}

export interface BackupMismatch {
  key: string;
  expected: string;
  actual: string;
}

export interface BackupVerification {
  ok: boolean;
  schemaVersion: number | null;
  exportedAt: string | null;
  documentCount: number;
  matched: number;
  mismatches: BackupMismatch[];
  duplicateKeys: string[];
  problems: string[];
}

/** 把 JSON 值序列化成与键顺序无关的规范字符串。 */
export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** 文档内容校验和。算法变更会让历史备份全部失效，改动前需同步升级 schemaVersion。 */
export function checksum(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

/** 读取数组字段长度，非数组返回 0。用于备份报告里的规模统计。 */
export function arrayLength(value: unknown, key: string): number {
  if (!value || typeof value !== "object") return 0;
  const candidate = (value as Record<string, unknown>)[key];
  return Array.isArray(candidate) ? candidate.length : 0;
}

export function documentKey(spec: { scope: string; eventId: string; name: string }): string {
  return `${spec.scope}/${spec.eventId || "__site__"}/${spec.name}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isHex64(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

/**
 * 只读校验一个已解析的备份对象：形状、重复键、以及每份文档的校验和。
 * 不读写网络与文件系统，纯函数，便于测试。
 */
export function verifyBackup(input: unknown): BackupVerification {
  const problems: string[] = [];
  const mismatches: BackupMismatch[] = [];
  const duplicateKeys: string[] = [];
  const seen = new Set<string>();

  if (!isRecord(input)) {
    return {
      ok: false,
      schemaVersion: null,
      exportedAt: null,
      documentCount: 0,
      matched: 0,
      mismatches,
      duplicateKeys,
      problems: ["备份内容不是对象"],
    };
  }

  const schemaVersion = typeof input.schemaVersion === "number" ? input.schemaVersion : null;
  const exportedAt = typeof input.exportedAt === "string" ? input.exportedAt : null;
  if (schemaVersion === null) problems.push("缺少 schemaVersion");
  else if (schemaVersion !== BACKUP_SCHEMA_VERSION) {
    problems.push(`schemaVersion 为 ${schemaVersion}，本工具只校验 ${BACKUP_SCHEMA_VERSION}`);
  }
  if (exportedAt === null) problems.push("缺少 exportedAt");

  const documents = input.documents;
  if (!Array.isArray(documents)) {
    problems.push("documents 不是数组");
    return { ok: false, schemaVersion, exportedAt, documentCount: 0, matched: 0, mismatches, duplicateKeys, problems };
  }
  if (documents.length === 0) problems.push("documents 为空");

  let matched = 0;
  documents.forEach((entry, index) => {
    if (!isRecord(entry)) {
      problems.push(`第 ${index + 1} 份文档不是对象`);
      return;
    }
    const { scope, eventId, name } = entry;
    if (scope !== "site" && scope !== "event") problems.push(`第 ${index + 1} 份文档 scope 非法`);
    if (typeof eventId !== "string") problems.push(`第 ${index + 1} 份文档 eventId 非法`);
    if (typeof name !== "string" || name === "") problems.push(`第 ${index + 1} 份文档 name 非法`);
    if (!("payload" in entry)) problems.push(`第 ${index + 1} 份文档缺少 payload`);

    const key = documentKey({
      scope: typeof scope === "string" ? scope : "",
      eventId: typeof eventId === "string" ? eventId : "",
      name: typeof name === "string" ? name : "",
    });
    if (seen.has(key)) duplicateKeys.push(key);
    seen.add(key);

    if (!isHex64(entry.sha256)) {
      problems.push(`${key} 的 sha256 不是 64 位小写十六进制`);
      return;
    }
    if (!("payload" in entry)) return;
    const actual = checksum(entry.payload);
    if (actual === entry.sha256) matched += 1;
    else mismatches.push({ key, expected: entry.sha256, actual });
  });

  return {
    ok: problems.length === 0 && mismatches.length === 0 && duplicateKeys.length === 0,
    schemaVersion,
    exportedAt,
    documentCount: documents.length,
    matched,
    mismatches,
    duplicateKeys,
    problems,
  };
}
