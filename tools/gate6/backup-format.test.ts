// =====================
// 备份格式与校验 · 纯函数单测
//
// 这套断言的用处很具体：**一份备份文件到底还能不能用**。
// 所以除了「完好备份判通过」，重点全在「坏在哪、能不能指到具体那一份」——
// 只报一句「校验失败」对拿它救命的人没有帮助。
//
// 用法：npm run test:backup-format
// =====================

import {
  BACKUP_SCHEMA_VERSION,
  checksum,
  documentKey,
  stable,
  verifyBackup,
  type BackupDocument,
} from "./backup-format";

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${detail ? `（${detail}）` : ""}`);
  }
}

function group(title: string) {
  console.log("");
  console.log(`== ${title} ==`);
}

// ── 夹具 ──────────────────────────────────────────────────

const REGISTRATION = { players: [{ id: "P-1", name: "甲" }, { id: "P-2", name: "乙" }], teams: [{ id: "T-1" }] };
const SCHEDULE = { version: 75, matches: [{ id: "M01", status: "已完成", winnerTeamId: "T-1" }] };

/** 造一份形状正确的备份；传 overrides 可以逐份替换 payload 或字段。 */
function makeBackup(overrides: Record<string, unknown> = {}) {
  // 显式标注 documents 的类型：否则 TS 会把 sha256 收窄成 string，
  // 组4 想塞 `sha256: null`（「导出时即不存在」）就编不过。
  const documents: BackupDocument[] = [
    { scope: "site", eventId: "", name: "site-config", sha256: checksum({ brand: { mark: "ECUST" } }), payload: { brand: { mark: "ECUST" } } },
    { scope: "event", eventId: "event-1", name: "registration", sha256: checksum(REGISTRATION), payload: REGISTRATION },
    { scope: "event", eventId: "event-1", name: "schedule", sha256: checksum(SCHEDULE), payload: SCHEDULE },
  ];
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: "2026-10-12T06:40:00.000Z",
    source: "生产",
    documents,
    ...overrides,
  };
}

// ── 组 1 · 完好备份 ───────────────────────────────────────

group("组1 · 完好的备份应当通过");
{
  const result = verifyBackup(makeBackup());
  check("整体通过", result.ok, result.problems.join("；"));
  check("checked 数 = 可校验文档数", result.checked === 3, String(result.checked));
  check("没有问题清单", result.problems.length === 0, result.problems.join("；"));
  check("schemaVersion 被读出来", result.schemaVersion === BACKUP_SCHEMA_VERSION, String(result.schemaVersion));
  check("逐份都是 ok", result.results.every((r) => r.status === "ok"), JSON.stringify(result.results.map((r) => r.status)));
}

// ── 组 2 · 内容被改过：要能定位到哪一份 ────────────────────

group("组2 · 内容被改过时，必须指到具体是哪一份");
{
  const backup = makeBackup();
  // 只动 schedule 的 payload，registration 保持原样
  backup.documents[2].payload = { version: 76, matches: [{ id: "M01", status: "已完成", winnerTeamId: "T-9" }] };
  const result = verifyBackup(backup);

  check("整体不通过", !result.ok);
  const mismatched = result.results.filter((r) => r.status === "checksum-mismatch");
  check("恰好一份对不上", mismatched.length === 1, String(mismatched.length));
  check(
    "指到的是被改的那一份（按标识，不按下标）",
    mismatched[0]?.key === "event/event-1/schedule",
    String(mismatched[0]?.key),
  );
  check(
    "没被改的那两份仍然判 ok",
    result.results.filter((r) => r.status === "ok").length === 2,
    JSON.stringify(result.results.map((r) => r.status)),
  );
  check("问题清单里写出了是哪一份", result.problems.some((p) => p.includes("event/event-1/schedule")), result.problems.join("；"));

  // 这条断言要检查的是**人读的那一行**（problems），不是机器字段（detail）：
  // 拿它救命的人只看得到 problems，两个前缀必须出现在他眼前，否则他没法逐位比对。
  const problemLine = result.problems.find((p) => p.includes("event/event-1/schedule")) ?? "";
  const prefixes = problemLine.match(/[0-9a-f]{12}…/g) ?? [];
  check(
    "问题清单里带了两个不同的校验和前缀，方便逐位比对",
    prefixes.length === 2 && prefixes[0] !== prefixes[1],
    problemLine,
  );
}

// ── 组 3 · 形状问题各自成条 ───────────────────────────────

group("组3 · 形状不对时要分开说，不能一句「校验失败」");
{
  const notObject = verifyBackup("这不是备份");
  check("不是对象 → 拦下", !notObject.ok && notObject.problems[0] === "备份不是一个对象", notObject.problems.join("；"));

  const noDocuments = verifyBackup(makeBackup({ documents: undefined }));
  check("documents 不是数组 → 拦下", !noDocuments.ok && noDocuments.problems.includes("documents 不是数组"), noDocuments.problems.join("；"));

  const empty = verifyBackup(makeBackup({ documents: [] }));
  check("空备份 → 拦下（空备份等于没有备份）", !empty.ok && empty.problems.some((p) => p.includes("空备份")), empty.problems.join("；"));

  const noSchema = verifyBackup(makeBackup({ schemaVersion: undefined }));
  check("缺 schemaVersion → 拦下", !noSchema.ok && noSchema.problems.includes("缺少 schemaVersion"), noSchema.problems.join("；"));

  const wrongSchema = verifyBackup(makeBackup({ schemaVersion: 99 }));
  check("schemaVersion 不认识 → 拦下并说明只认哪个", !wrongSchema.ok && wrongSchema.problems.some((p) => p.includes("本工具只认")), wrongSchema.problems.join("；"));

  const noSource = verifyBackup(makeBackup({ source: undefined }));
  check("缺 source → 拦下（不知道这份备份来自哪里）", !noSource.ok && noSource.problems.some((p) => p.includes("source")), noSource.problems.join("；"));

  const noExportedAt = verifyBackup(makeBackup({ exportedAt: undefined }));
  check("缺 exportedAt → 拦下", !noExportedAt.ok && noExportedAt.problems.some((p) => p.includes("exportedAt")), noExportedAt.problems.join("；"));

  const badEntry = makeBackup();
  badEntry.documents[1].name = "";
  const noName = verifyBackup(badEntry);
  check("条目缺 name → 拦下", !noName.ok && noName.problems.some((p) => p.includes("缺少 name")), noName.problems.join("；"));

  const badScope = makeBackup();
  (badScope.documents[1] as { scope: string }).scope = "workspace";
  const scope = verifyBackup(badScope);
  check("scope 非法 → 拦下", !scope.ok && scope.problems.some((p) => p.includes("scope")), scope.problems.join("；"));

  const noPayload = makeBackup();
  delete (noPayload.documents[1] as { payload?: unknown }).payload;
  const payload = verifyBackup(noPayload);
  check("有 sha256 却没有 payload → 拦下（不能拿一个空内容冒充通过）", !payload.ok && payload.problems.some((p) => p.includes("没有 payload")), payload.problems.join("；"));

  const badSha = makeBackup();
  (badSha.documents[1] as { sha256: unknown }).sha256 = 12345;
  const sha = verifyBackup(badSha);
  check("sha256 类型不对 → 拦下", !sha.ok && sha.problems.some((p) => p.includes("sha256")), sha.problems.join("；"));
}

// ── 组 4 · 重复键与「导出时就缺失」 ────────────────────────

group("组4 · 重复键 · 缺失文档");
{
  const duplicate = makeBackup();
  duplicate.documents.push({ ...duplicate.documents[1] });
  const result = verifyBackup(duplicate);
  check("同一份文档出现两次 → 拦下", !result.ok && result.problems.some((p) => p.includes("出现了两次")), result.problems.join("；"));

  const absentOne = makeBackup();
  absentOne.documents.push({ scope: "event", eventId: "event-1", name: "bp", sha256: null });
  const withAbsent = verifyBackup(absentOne);
  check("缺失文档记成 absent 且不算失败", withAbsent.ok, withAbsent.problems.join("；"));
  check("absent 的条目确实被标出来", withAbsent.results.some((r) => r.key === "event/event-1/bp" && r.status === "absent"), JSON.stringify(withAbsent.results));
  check("absent 不计入 checked", withAbsent.checked === 3, String(withAbsent.checked));

  const allAbsent = verifyBackup({
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: "2026-10-12T06:40:00.000Z",
    source: "生产",
    documents: [{ scope: "event", eventId: "event-1", name: "bp", sha256: null }],
  });
  check("全都 absent → 仍然不通过（没有任何可校验的内容）", !allAbsent.ok && allAbsent.problems.some((p) => p.includes("没有任何可校验的文档")), allAbsent.problems.join("；"));
}

// ── 组 5 · 算法本身：与键顺序无关 ─────────────────────────

group("组5 · 校验和必须与键顺序无关（否则同一份数据会算出两个值）");
{
  check("键顺序不同的同一份数据 → 同一个结果", stable({ a: 1, b: 2 }) === stable({ b: 2, a: 1 }), `${stable({ a: 1, b: 2 })} vs ${stable({ b: 2, a: 1 })}`);
  check("嵌套层的键顺序也无关", stable({ x: { p: 1, q: 2 } }) === stable({ x: { q: 2, p: 1 } }));
  check("数组顺序有关（数组是有序的）", stable([1, 2]) !== stable([2, 1]));
  check("校验和随之稳定", checksum({ a: 1, b: [2, { c: 3, d: null }] }) === checksum({ b: [2, { d: null, c: 3 }], a: 1 }));
  check("null 与字符串 \"null\" 不是一回事", checksum(null) !== checksum("null"));
  check("数字 1 与字符串 \"1\" 不是一回事", checksum(1) !== checksum("1"));

  // 真实改动必须改变化验和 —— 这是整件事成立的前提
  const before = checksum(SCHEDULE);
  const after = checksum({ ...SCHEDULE, version: 76 });
  check("版本号从 75 变 76 → 校验和变了", before !== after);

  check("站点级文档的键用 __site__ 占位", documentKey({ scope: "site", eventId: "", name: "site-config" }) === "site/__site__/site-config", documentKey({ scope: "site", eventId: "", name: "site-config" }));
  check("赛事级文档的键带赛事 ID", documentKey({ scope: "event", eventId: "event-1", name: "schedule" }) === "event/event-1/schedule");
}

console.log("");
console.log(`结果：通过 ${pass} / ${pass + fail}`);
if (fail > 0) {
  console.error(`${fail} 项未通过`);
  process.exit(1);
}
