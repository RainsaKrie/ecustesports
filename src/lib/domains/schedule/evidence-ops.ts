// =====================
// RPT-03 赛果凭证（MatchEvidence）纯函数（对应工作包 02 §5）
// 私有凭证存储的领域规则：文件校验、不透明路径、数量上限、查重、挂载、孤儿清理、过期计算。
// 无 Supabase、无 HTTP、无数据库。每个操作返回新的完整 EvidenceLedger，调用方用它替换旧状态。
// =====================

import { createHash, randomBytes } from "node:crypto";
import {
  ALLOWED_EVIDENCE_MIME_TYPES,
  APPEAL_RETENTION_DAYS,
  EVIDENCE_MIME_EXTENSION,
  MAX_EVIDENCE_BYTES,
  MAX_EVIDENCE_PER_MATCH,
  type AttachEvidenceInput,
  type EvidenceFileCheck,
  type EvidenceLedger,
  type EvidenceMimeType,
  type MatchEvidence,
  type RegisterEvidenceInput,
} from "./evidence-domain.ts";

function now(): string {
  return new Date().toISOString();
}

function newEvidenceId(): string {
  return `EVD-${randomBytes(12).toString("hex")}`;
}

/** 操作结果：成功返回新 ledger + 值，失败返回错误码（对齐 RPT-01/02 的 OpResult 纪律） */
export type EvidenceOpResult<T = undefined> =
  | { ok: true; state: EvidenceLedger; value?: T; reason?: string }
  | { ok: false; error: string; code?: string; state?: undefined; value?: undefined };

export function emptyEvidenceLedger(): EvidenceLedger {
  return { evidence: [] };
}

/** 收紧 MIME：只接受 JPG/PNG/WebP，其余拒绝 */
export function isEvidenceMimeType(mime: string): mime is EvidenceMimeType {
  return (ALLOWED_EVIDENCE_MIME_TYPES as readonly string[]).includes(mime);
}

/** 校验图片文件头（magic bytes），与 asset-store 的 hasImageSignature 逻辑一致 */
export function verifyImageSignature(bytes: Uint8Array, mimeType: EvidenceMimeType): boolean {
  if (mimeType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
  }
  if (mimeType === "image/webp") {
    return bytes.length >= 12
      && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
      && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  }
  return false;
}

/** 校验 sha256：64 位小写 hex */
export function isSha256Hex(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

/**
 * 文件校验（工作包 §5「假扩展名和错误文件签名被拒」）。
 * 顺序：MIME 合法 → 大小在 (0, 5MB] → 散列 64 位 hex →（给 bytes 时）文件签名匹配。
 */
export function checkEvidenceFile(input: {
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  bytes?: Uint8Array;
}): EvidenceFileCheck {
  if (!isEvidenceMimeType(input.mimeType)) {
    return { ok: false, error: "仅支持 JPG、PNG 或 WebP 图片", code: "UNSUPPORTED_MIME" };
  }
  if (input.sizeBytes <= 0) {
    return { ok: false, error: "文件为空", code: "EMPTY_FILE" };
  }
  if (!Number.isSafeInteger(input.sizeBytes)) {
    return { ok: false, error: "文件大小不合法", code: "INVALID_FILE_SIZE" };
  }
  if (input.sizeBytes > MAX_EVIDENCE_BYTES) {
    return { ok: false, error: `单张凭证不能超过 ${MAX_EVIDENCE_BYTES / 1024 / 1024}MB`, code: "FILE_TOO_LARGE" };
  }
  if (!isSha256Hex(input.sha256)) {
    return { ok: false, error: "文件散列格式不合法", code: "INVALID_SHA256" };
  }
  if (input.bytes && !verifyImageSignature(input.bytes, input.mimeType)) {
    return { ok: false, error: "文件内容与图片格式不一致", code: "SIGNATURE_MISMATCH" };
  }
  return { ok: true, mimeType: input.mimeType };
}

/**
 * 生成不透明对象路径：`match-evidence/{eventId}/{不透明ID}.{ext}`。
 * 只含 eventId + 随机 ID，绝不包含 matchId / refereeId / 展示名（ADR §3）。
 */
export function buildOpaqueObjectPath(eventId: string, mimeType: EvidenceMimeType, evidenceId: string): string {
  const ext = EVIDENCE_MIME_EXTENSION[mimeType];
  return `match-evidence/${eventId}/${evidenceId}.${ext}`;
}

/** 删除期限 = 当届结束 + 申诉保留期（ADR 决策 8：当届结束 + 7 天） */
export function computeEvidenceExpiry(eventEndsAt: string): string {
  const end = Date.parse(eventEndsAt);
  if (!Number.isFinite(end)) throw new Error("赛事结束时间格式不合法");
  const expiry = end + APPEAL_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return new Date(expiry).toISOString();
}

/** 生成一条 MatchEvidence 记录（供注册时构造，单点收口字段） */
function buildEvidenceRecord(input: RegisterEvidenceInput, mimeType: EvidenceMimeType, evidenceId: string): MatchEvidence {
  return {
    id: evidenceId,
    eventId: input.eventId,
    matchId: input.matchId,
    submissionId: undefined,
    objectPath: buildOpaqueObjectPath(input.eventId, mimeType, evidenceId),
    mimeType,
    sizeBytes: input.sizeBytes,
    sha256: input.sha256,
    uploadedByRefereeId: input.uploadedByRefereeId,
    createdAt: now(),
    expiresAt: computeEvidenceExpiry(input.eventEndsAt),
  };
}

/**
 * 注册一张凭证（草稿阶段，未挂提交）。
 * 校验文件 → 同 ID 幂等 → 同场同散列查重幂等 → 单场数量上限 → 生成记录。
 */
export function registerEvidenceOp(
  input: RegisterEvidenceInput,
  ledger: EvidenceLedger,
): EvidenceOpResult<{ evidenceId: string; objectPath: string; expiresAt: string }> {
  const mime = checkEvidenceFile({ mimeType: input.mimeType, sizeBytes: input.sizeBytes, sha256: input.sha256 });
  if (!mime.ok) return { ok: false, error: mime.error, code: mime.code };
  if (!Number.isFinite(Date.parse(input.eventEndsAt))) {
    return { ok: false, error: "赛事结束时间未配置或格式不合法", code: "INVALID_EVENT_END" };
  }

  // 同凭证 ID 已存在 → 幂等返回（重试不重复注册）
  const byId = ledger.evidence.find((e) => e.id === input.evidenceId);
  if (byId) {
    if (byId.eventId !== input.eventId || byId.matchId !== input.matchId || byId.sha256 !== input.sha256) {
      return { ok: false, error: "凭证 ID 已被其他文件占用", code: "EVIDENCE_ID_CONFLICT" };
    }
    return { ok: true, state: ledger, value: { evidenceId: byId.id, objectPath: byId.objectPath, expiresAt: byId.expiresAt }, reason: "已存在" };
  }

  // 同场同散列重复上传 → 幂等复用（工作包 §5「相同文件散列可用于识别重复上传」）
  const duplicate = ledger.evidence.find((e) => e.matchId === input.matchId && e.sha256 === input.sha256);
  if (duplicate) {
    return { ok: true, state: ledger, value: { evidenceId: duplicate.id, objectPath: duplicate.objectPath, expiresAt: duplicate.expiresAt }, reason: "重复上传" };
  }

  // 单场数量上限
  const sameMatchCount = ledger.evidence.filter((e) => e.matchId === input.matchId).length;
  if (sameMatchCount >= MAX_EVIDENCE_PER_MATCH) {
    return { ok: false, error: `本场比赛凭证数量已达上限（${MAX_EVIDENCE_PER_MATCH} 张）`, code: "TOO_MANY_EVIDENCE" };
  }

  const evidenceId = input.evidenceId ?? newEvidenceId();
  const record = buildEvidenceRecord(input, mime.mimeType, evidenceId);

  return {
    ok: true,
    state: { evidence: [...ledger.evidence, record] },
    value: { evidenceId, objectPath: record.objectPath, expiresAt: record.expiresAt },
  };
}

/**
 * 挂载凭证到提交记录。
 * 校验：凭证存在 → 同属一场比赛 → 未被其他提交占用（同提交幂等）。
 */
export function attachEvidenceOp(
  input: AttachEvidenceInput,
  ledger: EvidenceLedger,
): EvidenceOpResult<{ evidenceId: string }> {
  const record = ledger.evidence.find((e) => e.id === input.evidenceId);
  if (!record) return { ok: false, error: "凭证不存在", code: "EVIDENCE_NOT_FOUND" };

  if (record.matchId !== input.matchId) {
    return { ok: false, error: "凭证与提交不属于同一场比赛", code: "EVIDENCE_MATCH_MISMATCH" };
  }

  // 已挂到同一提交 → 幂等
  if (record.submissionId === input.submissionId) {
    return { ok: true, state: ledger, value: { evidenceId: record.id }, reason: "已挂载" };
  }

  // 已被其他提交占用 → 拒绝（一张凭证只能挂一个提交）
  if (record.submissionId !== undefined) {
    return { ok: false, error: "凭证已挂载到其他提交", code: "EVIDENCE_ALREADY_ATTACHED" };
  }

  return {
    ok: true,
    state: { evidence: ledger.evidence.map((e) => (e.id === input.evidenceId ? { ...e, submissionId: input.submissionId } : e)) },
    value: { evidenceId: record.id },
  };
}

/** 撤销挂载（管理员驳回 / 要求重提时，把凭证退回草稿，供重挂或清理） */
export function detachEvidenceOp(evidenceId: string, ledger: EvidenceLedger): EvidenceOpResult<{ evidenceId: string }> {
  const record = ledger.evidence.find((e) => e.id === evidenceId);
  if (!record) return { ok: false, error: "凭证不存在", code: "EVIDENCE_NOT_FOUND" };
  return {
    ok: true,
    state: { evidence: ledger.evidence.map((e) => (e.id === evidenceId ? { ...e, submissionId: undefined } : e)) },
    value: { evidenceId: record.id },
  };
}

/**
 * 孤儿清理：识别「未挂任何提交」且早于给定时间的凭证。（工作包 §5「失败后孤儿文件有清理策略」）
 * 只返回可清理 ID 清单，不删除 —— 删除动作在 API 层经确认后执行。
 */
export function findOrphanEvidence(ledger: EvidenceLedger, olderThanIso: string): string[] {
  const cutoff = new Date(olderThanIso).getTime();
  return ledger.evidence
    .filter((e) => e.submissionId === undefined && new Date(e.createdAt).getTime() < cutoff)
    .map((e) => e.id);
}

/** 计算 sha256（供 API 层读取 bytes 后、注册前调用） */
export function hashEvidenceBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
