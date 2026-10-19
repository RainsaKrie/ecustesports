// =====================
// RPT-03 赛果凭证（MatchEvidence）领域类型（对应 ADR v1.0 第 3 节 + 工作包 02 §5）
// 私有比赛凭证存储：不复用公开海报空间（event-assets），对象路径只用不透明 ID。
// 纯类型与常量，无 IO、无副作用。
// =====================

/** 允许的凭证 MIME（仅 JPG/PNG/WebP，对齐工作包 §5 推荐限制） */
export const ALLOWED_EVIDENCE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type EvidenceMimeType = (typeof ALLOWED_EVIDENCE_MIME_TYPES)[number];

/** 单张最大 5MB，对齐 event-assets 与工作包 §5 */
export const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;

/** 单场初始最多 5 张（工作包 §5） */
export const MAX_EVIDENCE_PER_MATCH = 5;

/** 申诉保留期：当届结束 + 7 天后冷存归档（ADR 决策 8） */
export const APPEAL_RETENTION_DAYS = 7;

/** MIME → 文件扩展名（用于不透明对象路径的收尾） */
export const EVIDENCE_MIME_EXTENSION: Record<EvidenceMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * 赛果凭证（MatchEvidence）。
 * 与公开海报空间（event-assets）隔离：objectPath 只含事件 ID + 服务端生成的不透明 ID，
 * 绝不包含 displayName / refereeId / matchId / 学号 / 手机号 等任何可定位身份的字段（ADR §3 冻结）。
 */
export interface MatchEvidence {
  id: string;
  eventId: string;
  matchId: string;
  /** 挂到的提交记录；草稿阶段未挂时为空 */
  submissionId?: string;
  /** 不透明对象路径（不含 PII） */
  objectPath: string;
  mimeType: EvidenceMimeType;
  sizeBytes: number;
  /** 文件内容的 sha256（hex，64 位小写），用于查重与完整性校验 */
  sha256: string;
  uploadedByRefereeId: string;
  createdAt: string;
  /** 删除期限：当届结束 + 申诉保留期（computeEvidenceExpiry 计算） */
  expiresAt: string;
}

/** 凭证台账：承载一场或一届上传的全部凭证，供查重、数量上限与孤儿清理 */
export interface EvidenceLedger {
  evidence: MatchEvidence[];
}

/** 上传凭证的输入（raw 层，尚未挂 submission） */
export interface RegisterEvidenceInput {
  eventId: string;
  matchId: string;
  mimeType: string; // 调用方传字符串，由校验函数收窄到 EvidenceMimeType
  sizeBytes: number;
  sha256: string;
  uploadedByRefereeId: string;
  /** 当届结束时间（用于计算 expiresAt）；缺省由调用方给出赛事周期 */
  eventEndsAt: string;
  /** 稳定证据 ID；不传则由实现生成（幂等要求调用方重试时传同一 ID） */
  evidenceId?: string;
}

/** 挂载到提交记录的输入 */
export interface AttachEvidenceInput {
  evidenceId: string;
  submissionId: string;
  /** 该提交对应的比赛，用于校验凭证与提交同属一场 */
  matchId: string;
}

/** 文件校验结果：合法时返回收窄后的 MIME 与实际检查项 */
export type EvidenceFileCheck =
  | { ok: true; mimeType: EvidenceMimeType }
  | { ok: false; error: string; code: string };