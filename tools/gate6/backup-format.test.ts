// =====================
// SYS-02 备份格式与校验算法测试
// 运行：npm run test:gate6-backup
// =====================

import {
  BACKUP_SCHEMA_VERSION,
  arrayLength,
  checksum,
  documentKey,
  stable,
  verifyBackup,
  type BackupDocument,
} from "./backup-format";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `（${detail}）` : ""}`); }
}

const EXPORTED_AT = "2026-09-11T12:00:00.000Z";

function document(
  scope: "site" | "event",
  name: string,
  payload: unknown,
  eventId = "",
): BackupDocument {
  return { scope, eventId, name, sha256: checksum(payload), payload };
}

function backup(documents: BackupDocument[]) {
  return { schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: EXPORTED_AT, source: "test", documents };
}

const REGISTRATION = { players: [{ id: "p1" }, { id: "p2" }], teams: [{ id: "t1" }] };
const SCHEDULE = { matches: [{ id: "m1" }] };

console.log("\n== 组1 · 规范化序列化 ==");
{
  check("键顺序不同但内容相同 → 序列化一致",
    stable({ b: 1, a: 2 }) === stable({ a: 2, b: 1 }));
  check("嵌套对象同样与键顺序无关",
    stable({ x: { n: 1, m: 2 } }) === stable({ x: { m: 2, n: 1 } }));
  check("数组顺序不同 → 序列化不同",
    stable([1, 2]) !== stable([2, 1]));
  check("字符串与数字区分开",
    stable("1") !== stable(1));
  check("null 可被序列化",
    stable(null) === "null");
}

console.log("\n== 组2 · 文档校验和 ==");
{
  check("相同内容得到相同校验和",
    checksum(REGISTRATION) === checksum({ teams: [{ id: "t1" }], players: [{ id: "p1" }, { id: "p2" }] }));
  check("内容变化 → 校验和变化",
    checksum(REGISTRATION) !== checksum({ ...REGISTRATION, players: [{ id: "p1" }] }));
  check("校验和为 64 位小写十六进制",
    /^[0-9a-f]{64}$/.test(checksum(REGISTRATION)));
}

console.log("\n== 组3 · 完好备份可通过 ==");
{
  const file = backup([
    document("site", "site-config", { brand: "华理" }),
    document("event", "registration", REGISTRATION, "evt-1"),
    document("event", "schedule", SCHEDULE, "evt-1"),
  ]);
  const result = verifyBackup(file);
  check("完好备份判定为通过", result.ok, JSON.stringify(result.problems));
  check("文档数正确", result.documentCount === 3);
  check("全部文档校验和匹配", result.matched === 3);
  check("无重复键", result.duplicateKeys.length === 0);
  check("无问题记录", result.problems.length === 0);
}

console.log("\n== 组4 · 能发现被改动的内容 ==");
{
  const file = backup([document("event", "registration", REGISTRATION, "evt-1")]);
  const tampered = JSON.parse(JSON.stringify(file)) as ReturnType<typeof backup>;
  (tampered.documents[0].payload as { players: unknown[] }).players.push({ id: "p3" });
  const result = verifyBackup(tampered);
  check("内容被改动 → 判定为不通过", !result.ok);
  check("定位到具体哪一份文档", result.mismatches.length === 1);
  check("记录期望与实际的校验和",
    result.mismatches[0].expected === checksum(REGISTRATION)
    && result.mismatches[0].actual === checksum((tampered.documents[0].payload)));
  check("键名包含赛事与文档名", result.mismatches[0].key === "event/evt-1/registration");
}

console.log("\n== 组5 · 能发现结构问题 ==");
{
  const bad = verifyBackup(null);
  check("非对象输入被拒绝", !bad.ok && bad.problems.includes("备份内容不是对象"));

  const noDocs = verifyBackup({ schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: EXPORTED_AT });
  check("documents 非数组被拒绝", !noDocs.ok && noDocs.problems.includes("documents 不是数组"));

  const empty = verifyBackup({ schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: EXPORTED_AT, documents: [] });
  check("空 documents 被提示", !empty.ok && empty.problems.includes("documents 为空"));

  const noVersion = verifyBackup({ exportedAt: EXPORTED_AT, documents: [document("site", "site-config", {})] });
  check("缺少 schemaVersion 被提示", !noVersion.ok && noVersion.problems.includes("缺少 schemaVersion"));

  const wrongVersion = verifyBackup({ schemaVersion: 99, exportedAt: EXPORTED_AT, documents: [document("site", "site-config", {})] });
  check("版本不符被提示", !wrongVersion.ok && wrongVersion.problems.some((p) => p.includes("只校验")));

  const badSha = backup([document("site", "site-config", {})]);
  badSha.documents[0].sha256 = "not-a-hash";
  const badShaResult = verifyBackup(badSha);
  check("非法 sha256 被提示", !badShaResult.ok && badShaResult.problems.some((p) => p.includes("64 位小写十六进制")));

  const noPayload = backup([document("site", "site-config", {})]);
  delete (noPayload.documents[0] as { payload?: unknown }).payload;
  const noPayloadResult = verifyBackup(noPayload);
  check("缺少 payload 被提示", !noPayloadResult.ok && noPayloadResult.problems.some((p) => p.includes("缺少 payload")));

  const dup = backup([
    document("event", "registration", REGISTRATION, "evt-1"),
    document("event", "registration", REGISTRATION, "evt-1"),
  ]);
  const dupResult = verifyBackup(dup);
  check("重复文档被提示", !dupResult.ok && dupResult.duplicateKeys.length === 1);
}

console.log("\n== 组6 · 报告字段工具 ==");
{
  check("站点文档键使用 __site__ 占位",
    documentKey({ scope: "site", eventId: "", name: "site-config" }) === "site/__site__/site-config");
  check("赛事文档键保留赛事 ID",
    documentKey({ scope: "event", eventId: "evt-1", name: "schedule" }) === "event/evt-1/schedule");
  check("数组长度可统计", arrayLength(REGISTRATION, "players") === 2);
  check("非数组字段返回 0", arrayLength(REGISTRATION, "missing") === 0);
  check("非对象返回 0", arrayLength(null, "players") === 0);
}

console.log(`\n结果：通过 ${pass} / ${pass + fail}`);
if (fail > 0) process.exit(1);
