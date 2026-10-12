// =====================
// 备份文件的格式与校验（纯函数，不碰文件、不碰网络）
//
// 为什么单独一份：备份的**生成端**（backup-restore.ts）与**校验端**必须共用同一套算法。
// 各自写一份 `stable()` / `checksum()` 的后果是两边悄悄走偏 —— 校验工具会对一份完好的备份
// 报错，从此没人再相信它。所以这里放唯一的算法来源，两端都 import。
//
// 纯函数的好处：可以拿合成样例直接单测，不必连库、不必有凭据。
// =====================

import { createHash } from "node:crypto";

export const BACKUP_SCHEMA_VERSION = 1;

/** 稳定的字符串化：与对象的键顺序无关。 */
export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** 逐份文档的校验和。 */
export function checksum(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

export interface BackupDocument {
  scope: "site" | "event";
  eventId: string;
  name: string;
  /** `null` 表示这份文档在导出时就不存在（例如一场还没做过 BP 的赛事没有 bp 文档） */
  sha256: string | null;
  payload?: unknown;
}

export interface BackupFile {
  schemaVersion: number;
  exportedAt: string;
  source: string;
  documents: BackupDocument[];
}

export type DocumentStatus = "ok" | "absent" | "checksum-mismatch" | "malformed";

export interface DocumentVerification {
  key: string;
  status: DocumentStatus;
  detail?: string;
}

export interface BackupVerification {
  ok: boolean;
  schemaVersion: number | null;
  checked: number;
  results: DocumentVerification[];
  /** 人能照着看的问题清单；空数组表示全部通过 */
  problems: string[];
}

/** `scope/eventId/name` 拼成可读的键；站点级文档用 `__site__` 代替赛事 ID。 */
export function documentKey(document: Pick<BackupDocument, "scope" | "eventId" | "name">): string {
  return `${document.scope}/${document.scope === "site" ? "__site__" : document.eventId || "__missing__"}/${document.name}`;
}

/**
 * 校验一份备份的**内容**（形状 + 重复键 + 逐份校验和）。
 *
 * 刻意做成纯函数：拿一个 JSON 对象进来，返回结论。这样「文件坏了」与「内容被改过」
 * 能分得开 —— 前者在解析阶段就该拦下，这里只judge解析后的对象。
 */
export function verifyBackup(input: unknown): BackupVerification {
  const problems: string[] = [];
  const results: DocumentVerification[] = [];

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      ok: false,
      schemaVersion: null,
      checked: 0,
      results,
      problems: ["备份不是一个对象"],
    };
  }

  const file = input as Partial<BackupFile>;
  const schemaVersion = typeof file.schemaVersion === "number" ? file.schemaVersion : null;
  if (schemaVersion === null) problems.push("缺少 schemaVersion");
  else if (schemaVersion !== BACKUP_SCHEMA_VERSION) {
    problems.push(`schemaVersion 是 ${schemaVersion}，本工具只认 ${BACKUP_SCHEMA_VERSION}`);
  }
  if (typeof file.exportedAt !== "string" || !file.exportedAt) problems.push("缺少 exportedAt");
  if (typeof file.source !== "string" || !file.source) problems.push("缺少 source（不知道这份备份来自哪里）");

  if (!Array.isArray(file.documents)) {
    problems.push("documents 不是数组");
    return { ok: false, schemaVersion, checked: 0, results, problems };
  }
  if (file.documents.length === 0) problems.push("documents 是空的 —— 空备份等同于没有备份");

  const seen = new Set<string>();
  for (const raw of file.documents) {
    if (!raw || typeof raw !== "object") {
      results.push({ key: "(无法识别的条目)", status: "malformed", detail: "条目不是对象" });
      continue;
    }
    const document = raw as Partial<BackupDocument>;
    const key = documentKey({
      scope: document.scope === "site" ? "site" : "event",
      eventId: typeof document.eventId === "string" ? document.eventId : "",
      name: typeof document.name === "string" ? document.name : "",
    });

    if (document.scope !== "site" && document.scope !== "event") {
      results.push({ key, status: "malformed", detail: `scope 既不是 site 也不是 event（${String(document.scope)}）` });
      continue;
    }
    if (typeof document.name !== "string" || !document.name) {
      results.push({ key, status: "malformed", detail: "缺少 name" });
      continue;
    }
    if (seen.has(key)) {
      results.push({ key, status: "malformed", detail: "同一份文档出现了两次" });
      continue;
    }
    seen.add(key);

    // 导出时就缺失的文档：明确记成 absent，不算失败（一场还没做 BP 的赛事本来就没有 bp）
    if (document.sha256 === null) {
      results.push({ key, status: "absent", detail: "导出时即不存在" });
      continue;
    }
    if (typeof document.sha256 !== "string" || !document.sha256) {
      results.push({ key, status: "malformed", detail: "sha256 既不是字符串也不是 null" });
      continue;
    }
    if (!("payload" in document)) {
      results.push({ key, status: "malformed", detail: "有 sha256 但没有 payload" });
      continue;
    }

    const actual = checksum(document.payload);
    if (actual === document.sha256) results.push({ key, status: "ok" });
    else {
      results.push({
        key,
        status: "checksum-mismatch",
        detail: `记录的是 ${document.sha256.slice(0, 12)}…，重算得到 ${actual.slice(0, 12)}…`,
      });
    }
  }

  for (const result of results) {
    if (result.status === "checksum-mismatch") problems.push(`${result.key}：校验和对不上（${result.detail}）`);
    else if (result.status === "malformed") problems.push(`${result.key}：${result.detail}`);
  }

  const checked = results.filter((result) => result.status !== "absent").length;
  return {
    ok: problems.length === 0 && checked > 0,
    schemaVersion,
    checked,
    results,
    problems: checked === 0 && problems.length === 0 ? ["没有任何可校验的文档"] : problems,
  };
}
