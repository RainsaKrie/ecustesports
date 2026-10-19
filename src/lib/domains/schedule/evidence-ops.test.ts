// =====================
// RPT-03 赛果凭证纯函数测试
// 运行：npx tsx src/lib/domains/schedule/evidence-ops.test.ts
// =====================

import {
  attachEvidenceOp,
  buildOpaqueObjectPath,
  checkEvidenceFile,
  computeEvidenceExpiry,
  detachEvidenceOp,
  emptyEvidenceLedger,
  findOrphanEvidence,
  hashEvidenceBytes,
  isSha256Hex,
  registerEvidenceOp,
  verifyImageSignature,
  type EvidenceOpResult,
} from "./evidence-ops.ts";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `（${detail}）` : ""}`); }
}

const EVENT = "evt-1";
const MATCH = "M1";
const REFEREE = "ref-1";
const EVENT_ENDS = "2026-10-08T12:00:00.000Z"; // 当届结束
const SHA = "a".repeat(64); // 合法 64 位 hex（用 'a' 占位）

function input(overrides: Partial<Parameters<typeof registerEvidenceOp>[0]> = {}) {
  return { eventId: EVENT, matchId: MATCH, mimeType: "image/png", sizeBytes: 1024, sha256: SHA, uploadedByRefereeId: REFEREE, eventEndsAt: EVENT_ENDS, ...overrides };
}

// 合法的 PNG 文件头（8 字节签名）
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function pngBytes(len = 64) {
  const b = new Uint8Array(len);
  b.set(PNG_SIGNATURE, 0);
  return b;
}

console.log("== 组1 · 文件校验 ==");
{
  check("合法 PNG 通过", checkEvidenceFile({ mimeType: "image/png", sizeBytes: 64, sha256: SHA, bytes: pngBytes() }).ok);
  check("不支持的 MIME 被拒", (() => {
    const r = checkEvidenceFile({ mimeType: "image/gif", sizeBytes: 64, sha256: SHA });
    return !r.ok && r.code === "UNSUPPORTED_MIME";
  })());
  check("空文件被拒", (() => {
    const r = checkEvidenceFile({ mimeType: "image/png", sizeBytes: 0, sha256: SHA });
    return !r.ok && r.code === "EMPTY_FILE";
  })());
  check("非整数文件大小被拒", (() => {
    const r = checkEvidenceFile({ mimeType: "image/png", sizeBytes: 1.5, sha256: SHA });
    return !r.ok && r.code === "INVALID_FILE_SIZE";
  })());
  check("超 5MB 被拒", (() => {
    const r = checkEvidenceFile({ mimeType: "image/png", sizeBytes: 5 * 1024 * 1024 + 1, sha256: SHA });
    return !r.ok && r.code === "FILE_TOO_LARGE";
  })());
  check("恰好 5MB 允许", checkEvidenceFile({ mimeType: "image/png", sizeBytes: 5 * 1024 * 1024, sha256: SHA }).ok);
  check("散列格式不合法被拒", (() => {
    const r = checkEvidenceFile({ mimeType: "image/png", sizeBytes: 64, sha256: "not-a-hash" });
    return !r.ok && r.code === "INVALID_SHA256";
  })());
  check("假扩展名（JPEG 头报 PNG）被拒", (() => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const r = checkEvidenceFile({ mimeType: "image/png", sizeBytes: 4, sha256: SHA, bytes: jpeg });
    return !r.ok && r.code === "SIGNATURE_MISMATCH";
  })());
  check("verifyImageSignature 识别 JPEG/PNG/WebP", (() => {
    const jpg = verifyImageSignature(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg");
    const png = verifyImageSignature(pngBytes(), "image/png");
    const webp = verifyImageSignature(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), "image/webp");
    return jpg && png && webp;
  })());
}

console.log("\n== 组2 · 不透明路径（不含 PII） ==");
{
  check("路径只含 eventId + 不透明 ID", (() => {
    const p = buildOpaqueObjectPath(EVENT, "image/png", "EVD-abc");
    return p.startsWith(`match-evidence/${EVENT}/EVD-`) && p.endsWith(".png") && !p.includes(MATCH) && !p.includes(REFEREE);
  })());
  check("路径不含昵称/学号/手机号占位", (() => {
    const p = buildOpaqueObjectPath(EVENT, "image/jpeg", "EVD-xyz");
    return !/[a-zA-Z]{4,}[^\-]/.test(p.replace("match-evidence/", "").replace(EVENT, "").replace(".jpg", ""));
  })());
}

console.log("\n== 组3 · 注册与数量上限 ==");
{
  check("注册成功返回不透明路径 + 过期时间", (() => {
    const r = registerEvidenceOp(input(), emptyEvidenceLedger()) as EvidenceOpResult<{ objectPath: string; expiresAt: string }>;
    return r.ok && r.state!.evidence.length === 1 && r.value!.objectPath.startsWith(`match-evidence/${EVENT}/`);
  })());
  check("过期时间 = 当届结束 + 7 天", (() => {
    const exp = computeEvidenceExpiry(EVENT_ENDS);
    const diff = new Date(exp).getTime() - new Date(EVENT_ENDS).getTime();
    return diff === 7 * 24 * 60 * 60 * 1000;
  })());
  check("赛事结束时间无效时拒绝注册", (() => {
    const result = registerEvidenceOp(input({ eventEndsAt: "not-a-date" }), emptyEvidenceLedger());
    return !result.ok && result.code === "INVALID_EVENT_END";
  })());
  check("单场最多 5 张，第 6 张被拒", (() => {
    let l = emptyEvidenceLedger();
    for (let i = 0; i < 5; i++) {
      l = registerEvidenceOp(input({ sha256: "a".repeat(63) + i.toString(16) }), l).state!;
    }
    const sixth = registerEvidenceOp(input({ sha256: "b".repeat(64) }), l);
    return !sixth.ok && sixth.code === "TOO_MANY_EVIDENCE";
  })());
  check("不同比赛各自计数", (() => {
    let l = emptyEvidenceLedger();
    for (let i = 0; i < 5; i++) {
      l = registerEvidenceOp(input({ sha256: "a".repeat(63) + i.toString(16) }), l).state!;
    }
    const otherMatch = registerEvidenceOp(input({ matchId: "M2", sha256: "c".repeat(64) }), l);
    return otherMatch.ok;
  })());
}

console.log("\n== 组4 · 查重幂等 ==");
{
  check("同 ID 重试幂等（不新增记录）", (() => {
    let l = emptyEvidenceLedger();
    const first = registerEvidenceOp(input({ evidenceId: "EVD-fixed" }), l);
    l = first.state!;
    const again = registerEvidenceOp(input({ evidenceId: "EVD-fixed" }), l);
    return again.ok && again.state!.evidence.length === 1;
  })());
  check("同 ID 但不同文件被拒绝", (() => {
    const first = registerEvidenceOp(input({ evidenceId: "EVD-fixed" }), emptyEvidenceLedger());
    const conflict = registerEvidenceOp(input({ evidenceId: "EVD-fixed", sha256: "b".repeat(64) }), first.state!);
    return !conflict.ok && conflict.code === "EVIDENCE_ID_CONFLICT";
  })());
  check("同场同散列重复上传 → 复用已上传", (() => {
    let l = emptyEvidenceLedger();
    const first = registerEvidenceOp(input(), l);
    l = first.state!;
    const dupe = registerEvidenceOp(input(), l);
    return dupe.ok && dupe.reason === "重复上传" && dupe.state!.evidence.length === 1;
  })());
  check("不同场同散列不算重复", (() => {
    let l = emptyEvidenceLedger();
    l = registerEvidenceOp(input(), l).state!;
    const other = registerEvidenceOp(input({ matchId: "M2" }), l);
    return other.ok && other.state!.evidence.length === 2;
  })());
}

console.log("\n== 组5 · 挂载与撤挂 ==");
{
  check("挂载到同场提交", (() => {
    let l = emptyEvidenceLedger();
    const reg = registerEvidenceOp(input(), l);
    l = reg.state!;
    const id = reg.value!.evidenceId;
    const at = attachEvidenceOp({ evidenceId: id, submissionId: "SUB-1", matchId: MATCH }, l);
    return at.ok && at.state!.evidence[0].submissionId === "SUB-1";
  })());
  check("挂到不同场提交被拒", (() => {
    const l = emptyEvidenceLedger();
    const reg = registerEvidenceOp(input(), l);
    const at = attachEvidenceOp({ evidenceId: reg.value!.evidenceId, submissionId: "SUB-1", matchId: "M2" }, reg.state!);
    return !at.ok && at.code === "EVIDENCE_MATCH_MISMATCH";
  })());
  check("重复挂到同一提交幂等", (() => {
    let l = emptyEvidenceLedger();
    const reg = registerEvidenceOp(input(), l);
    l = reg.state!;
    const id = reg.value!.evidenceId;
    l = attachEvidenceOp({ evidenceId: id, submissionId: "SUB-1", matchId: MATCH }, l).state!;
    const again = attachEvidenceOp({ evidenceId: id, submissionId: "SUB-1", matchId: MATCH }, l);
    return again.ok && again.reason === "已挂载";
  })());
  check("已挂其他提交 → 拒绝", (() => {
    let l = emptyEvidenceLedger();
    const reg = registerEvidenceOp(input(), l);
    l = reg.state!;
    const id = reg.value!.evidenceId;
    l = attachEvidenceOp({ evidenceId: id, submissionId: "SUB-1", matchId: MATCH }, l).state!;
    const other = attachEvidenceOp({ evidenceId: id, submissionId: "SUB-2", matchId: MATCH }, l);
    return !other.ok && other.code === "EVIDENCE_ALREADY_ATTACHED";
  })());
  check("撤挂后回到草稿（submissionId 清空）", (() => {
    let l = emptyEvidenceLedger();
    const reg = registerEvidenceOp(input(), l);
    l = reg.state!;
    const id = reg.value!.evidenceId;
    l = attachEvidenceOp({ evidenceId: id, submissionId: "SUB-1", matchId: MATCH }, l).state!;
    const det = detachEvidenceOp(id, l);
    return det.ok && det.state!.evidence[0].submissionId === undefined;
  })());
}

console.log("\n== 组6 · 孤儿清理 ==");
{
  check("未挂载且超时 → 判孤儿", (() => {
    const l = emptyEvidenceLedger();
    const reg = registerEvidenceOp(input(), l);
    // 制造孤儿：直接把注册记录放进去，不挂载
    const orphans = findOrphanEvidence(reg.state!, "2030-01-01T00:00:00.000Z");
    return orphans.length === 1;
  })());
  check("已挂载的凭证不算孤儿", (() => {
    let l = emptyEvidenceLedger();
    const reg = registerEvidenceOp(input(), l);
    l = reg.state!;
    const id = reg.value!.evidenceId;
    l = attachEvidenceOp({ evidenceId: id, submissionId: "SUB-1", matchId: MATCH }, l).state!;
    return findOrphanEvidence(l, "2030-01-01T00:00:00.000Z").length === 0;
  })());
  check("未超时的不算孤儿", (() => {
    const l = emptyEvidenceLedger();
    const reg = registerEvidenceOp(input(), l);
    return findOrphanEvidence(reg.state!, "2000-01-01T00:00:00.000Z").length === 0;
  })());
}

console.log("\n== 组7 · 散列工具 ==");
{
  check("isSha256Hex 识别 64 位 hex", isSha256Hex("a".repeat(64)) && !isSha256Hex("a".repeat(63)));
  check("hashEvidenceBytes 返回 64 位 hex", isSha256Hex(hashEvidenceBytes(pngBytes())));
  check("相同内容同散列", hashEvidenceBytes(pngBytes()) === hashEvidenceBytes(pngBytes()));
}

console.log(`\n结果：通过 ${pass} / ${pass + fail}`);
if (fail > 0) process.exit(1);
