// =====================
// 路由守卫测试：全部 API 写路由的鉴权归属
//
// 为什么写成测试而不是只写在文档里：
//   缺口 A（路由只有一层鉴权）与缺口 B（写操作无留痕）的**根因是同一个**
//   —— 新增路由时没人提醒要加这两样。审计报告一旦归档就没人再翻，
//   而测试会在 CI 里拦住下一次遗漏。
//
// 2026-10-12 扩展：原来只枚举 `src/app/api/admin`，另 16 个路由（data / referee / public）
// 不在检查范围内。现在枚举全部 API 路由，并新增一份**冻结的写路由清单** ——
// 新增或删除任何写路由都会让组 0 变红，逼作者显式登记它的鉴权方式。
//
// 这类测试断言的是**架构约束**（哪些文件必须包含什么调用），不是实现细节，
// 所以用静态读源码的方式是合适的；代价是重构时可能需同步调整本文件。
//
// 依据：docs/10-后续开发规划/14-SYS-04高风险操作审计与安全补齐_v1.0.md
//       docs/10-后续开发规划/17-代码审计与架构优化方案_v1.0.md
// =====================

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const API_ROOT = path.join(process.cwd(), "src", "app", "api");

function listRouteFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listRouteFiles(full, acc);
    else if (entry.name === "route.ts") acc.push(full);
  }
  return acc;
}

const routeFiles = listRouteFiles(API_ROOT);
assert.ok(routeFiles.length >= 20, `应能枚举到 API 路由，实际 ${routeFiles.length} 个`);

const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"];
const source = new Map<string, string>();
for (const file of routeFiles) source.set(file, readFileSync(file, "utf8"));

/** 相对路径，用于报错信息可读 */
const rel = (file: string) => path.relative(process.cwd(), file).replace(/\\/g, "/");

/** 路由的 URL 路径，由文件位置推导（`src/app/api/a/b/route.ts` → `/api/a/b`） */
const urlPathOf = (file: string) => path.dirname(rel(file)).replace(/^src\/app/, "");

const methodsOf = (text: string): string[] =>
  WRITE_METHODS.filter((m) => new RegExp(`export\\s+async\\s+function\\s+${m}\\s*\\(`).test(text));

/**
 * 判断路由是否**真的调用了**鉴权。
 *
 * ⚠️ 这里必须先剔除本地函数定义再找引用 —— 本文件第一版只检查"是否出现 isAdmin 这个名字"，
 * 结果**测不出"删掉鉴权调用但保留函数定义"这种回退**（变异验证时发现测试恒真）。
 * 教训：断言"用了某能力"时，不能只看名字存在，要看调用真的发生。
 */
function hasRouteAuth(text: string): boolean {
  const withoutLocalDefinition = text.replace(
    /function\s+isAdmin\s*\([^)]*\)\s*:\s*boolean\s*\{[\s\S]*?\n\}/,
    "",
  );
  return /\bisAdmin\s*\(|\bverifySessionToken\s*\(/.test(withoutLocalDefinition);
}
const hasAudit = (text: string) => /recordOperationAuditSafely\s*\(/.test(text);

/**
 * 显式豁免：这些接口**本来就不该**有路由级鉴权。
 * 写在这里是为了让"豁免"是可见的决定，而不是漏检。
 */
const AUTH_EXEMPT = new Map<string, string>([
  ["/api/admin/login", "登录接口本身即会话入口，鉴权由密码校验承担"],
  ["/api/admin/logout", "只清调用者自己的会话 cookie，无副作用；未登录调用也应正常返回"],
]);

/**
 * 公开写路由的自鉴权登记表。
 *
 * 代理层用 `PUBLIC_WRITE_PATHS` 放行这些路径（不要求管理员会话），
 * 因此**每一条都必须自己解决身份问题**。这张表把「怎么解决的」记录下来，
 * 并用 `marker` 断言路由文件里真的出现了对应调用 —— 光登记不实现同样会被拦下。
 *
 * `marker` 为 null 表示这个接口确实没有可查的既有身份（玩家入口本身），
 * 此时必须写明安全性由什么承担。
 */
const SELF_AUTH = new Map<string, { marker: string | null; reason: string }>([
  ["/api/data/bp", {
    marker: "findParticipant(",
    reason: "队长用参赛管理码推进本方 BP 步骤；管理员走会话 cookie。身份由服务端按操作推导，不接受客户端传队伍 ID。",
  }],
  ["/api/public/participant", {
    marker: "findParticipant(",
    reason: "选手改自己的资料，身份由参赛管理码 token 推导。",
  }],
  ["/api/public/participant/recover", {
    marker: "recoverParticipantAccess(",
    reason: "玩家入口：用学号 + 报名手机号匹配来换发新管理码，没有可查的既有身份。已单独限流 6 次/15 分钟。",
  }],
  ["/api/public/register", {
    marker: null,
    reason: "玩家入口：报名建档本身。没有既有身份，安全性由字段校验与限流承担。",
  }],
  ["/api/public/schedule/request", {
    marker: "findParticipant(",
    reason: "队长提交/确认约赛时间，身份由参赛管理码推导，并校验是否为本场参赛队长。",
  }],
  ["/api/public/team", {
    marker: "findParticipant(",
    reason: "组队与入队操作，身份由参赛管理码推导。",
  }],
  ["/api/public/team/request", {
    marker: "findParticipant(",
    reason: "组队申请与邀请，身份由参赛管理码推导。",
  }],
  ["/api/referee/login", {
    marker: "readRefereeCredential(",
    reason: "裁判凭证校验入口本身，只回布尔值，不暴露内部身份。",
  }],
  ["/api/referee/submit", {
    marker: "readRefereeCredential(",
    reason: "裁判提交赛果，身份由凭证推导，并校验该场是否分配给本人。",
  }],
  ["/api/referee/upload", {
    marker: "readRefereeCredential(",
    reason: "裁判上传凭证草稿，身份由凭证推导。",
  }],
  ["/api/referee/recognize", {
    marker: "readRefereeCredential(",
    reason: "传图识图：先鉴权再取上下文并调模型，未分配的场次直接拒绝，不浪费模型额度。",
  }],
  ["/api/referee/claim", {
    marker: "readRefereeCredential(",
    reason: "裁判自助认领/释放比赛，身份由凭证推导。",
  }],
]);

/** 靠代理层会话保护、且路由内再校验一次的写路由。 */
const SESSION_GUARDED_WRITE_ROUTES = new Map<string, string>([
  ["/api/data/format", "代理层要求管理员会话；路由内再校验一次作为双保险"],
  ["/api/data/schedule", "同 format：代理层 + 路由内双保险"],
]);

/**
 * 冻结的全部写路由清单（路径 + 方法，方法名按字母序）。
 *
 * 组 0 断言实际清单与它完全一致。**新增写路由时这里会红** ——
 * 请把它补进来，并同时确认它的鉴权归属（管理员会话 / 公开白名单 + 自鉴权登记）。
 */
const FROZEN_WRITE_ROUTES: Array<[string, string]> = [
  ["/api/admin/events", "DELETE,PATCH,POST"],
  ["/api/admin/events/format", "POST"],
  ["/api/admin/events/publication", "POST"],
  ["/api/admin/events/stage", "POST"],
  ["/api/admin/events/switch", "POST"],
  ["/api/admin/login", "POST"],
  ["/api/admin/logout", "POST"],
  ["/api/admin/referees", "POST"],
  ["/api/admin/registration", "POST"],
  ["/api/admin/review", "POST"],
  ["/api/admin/rule-library", "PUT"],
  ["/api/admin/site-config", "PUT"],
  ["/api/admin/site-content", "PATCH"],
  ["/api/admin/upload", "POST"],
  ["/api/data/bp", "POST"],
  ["/api/data/format", "POST"],
  ["/api/data/schedule", "POST"],
  ["/api/public/participant", "PATCH"],
  ["/api/public/participant/recover", "POST"],
  ["/api/public/register", "POST"],
  ["/api/public/schedule/request", "PATCH,POST"],
  ["/api/public/team", "POST"],
  ["/api/public/team/request", "PATCH,POST"],
  ["/api/referee/claim", "POST"],
  ["/api/referee/login", "POST"],
  ["/api/referee/recognize", "POST"],
  ["/api/referee/submit", "POST"],
  ["/api/referee/upload", "POST"],
];

const actualWriteRoutes = new Map<string, string>();
for (const [file, text] of source.entries()) {
  const methods = methodsOf(text);
  if (methods.length > 0) actualWriteRoutes.set(urlPathOf(file), [...methods].sort().join(","));
}

const proxy = readFileSync(path.join(process.cwd(), "src", "proxy.ts"), "utf8");
const publicBlock = proxy.match(/const PUBLIC_WRITE_PATHS = \[([\s\S]*?)\];/)?.[1] ?? "";
const PUBLIC_WRITE_PATHS = [...publicBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

let checked = 0;

// ---------------------------------------------------------------
console.log("== 组0 · 写路由清单必须与冻结清单一致（新增/删除都会红） ==");

const frozenKeys = FROZEN_WRITE_ROUTES.map(([p, m]) => `${p} ${m}`);
const actualKeys = [...actualWriteRoutes.entries()].map(([p, m]) => `${p} ${m}`).sort();
assert.deepEqual(
  actualKeys,
  [...frozenKeys].sort(),
  "写路由清单与冻结清单不一致。新增路由请登记进 FROZEN_WRITE_ROUTES 并确认其鉴权归属；"
    + "删除路由请一并移除登记。",
);
console.log(`  ✓ ${actualKeys.length} 个写路由与冻结清单一致`);

// ---------------------------------------------------------------
console.log("== 组1 · 管理员写路由必须有路由级鉴权（缺口 A） ==");
const adminWriteRoutes = [...actualWriteRoutes.keys()].filter((p) => p.startsWith("/api/admin"));
assert.ok(adminWriteRoutes.length >= 10, `管理员写路由数量异常：${adminWriteRoutes.length}`);

const withoutAuth: string[] = [];
for (const key of adminWriteRoutes) {
  checked += 1;
  const text = source.get(path.join(process.cwd(), "src", "app", ...key.split("/").filter(Boolean), "route.ts"));
  assert.ok(text, `应能取到 ${key} 的源码`);
  if (AUTH_EXEMPT.has(key)) {
    // 豁免项反过来断言：确实**没有**加鉴权，避免将来有人"顺手"加上破坏语义
    assert.equal(hasRouteAuth(text!), false, `${key} 在豁免名单里，不应出现路由级鉴权`);
    continue;
  }
  if (!hasRouteAuth(text!)) withoutAuth.push(key);
}

assert.deepEqual(
  withoutAuth,
  [],
  `以下管理员写路由缺少路由级鉴权（应加 isAdmin/verifySessionToken，或登记到 AUTH_EXEMPT 并说明理由）：\n  ${withoutAuth.join("\n  ")}`,
);
console.log(`  ✓ ${adminWriteRoutes.length} 个管理员写路由全部满足（其中 ${AUTH_EXEMPT.size} 个显式豁免）`);

// ---------------------------------------------------------------
console.log("== 组2 · 公开写路由必须登记自鉴权方式，且真的实现了 ==");

const publicWriteRoutes = PUBLIC_WRITE_PATHS.filter((p) => !p.startsWith("/api/admin"));
const unregistered = publicWriteRoutes.filter((p) => !SELF_AUTH.has(p));
assert.deepEqual(
  unregistered,
  [],
  `以下公开写路由未登记自鉴权方式（请补进 SELF_AUTH 并说明身份从哪里来）：\n  ${unregistered.join("\n  ")}`,
);

const markerMissing: string[] = [];
checked += publicWriteRoutes.length;
for (const key of publicWriteRoutes) {
  const spec = SELF_AUTH.get(key)!;
  if (spec.marker === null) continue;
  const file = path.join(process.cwd(), "src", "app", ...key.split("/").filter(Boolean), "route.ts");
  const text = source.get(file);
  assert.ok(text, `应能取到 ${key} 的源码`);
  if (!text!.includes(spec.marker)) {
    markerMissing.push(`${key} 登记的自鉴权标记 ${spec.marker} 在源码里找不到`);
  }
}
assert.deepEqual(
  markerMissing,
  [],
  `登记了自鉴权但源码里找不到对应调用（登记与实际不符）：\n  ${markerMissing.join("\n  ")}`,
);
console.log(`  ✓ ${publicWriteRoutes.length} 个公开写路由均已登记，且自鉴权调用确实存在`);

// ---------------------------------------------------------------
console.log("== 组3 · 公开白名单不得残留已删除的路由 ==");

const staleEntries = PUBLIC_WRITE_PATHS.filter((p) => !actualWriteRoutes.has(p));
assert.deepEqual(
  staleEntries,
  [],
  `PUBLIC_WRITE_PATHS 里的路径已不存在对应写路由（路由被删了但白名单没清）：\n  ${staleEntries.join("\n  ")}`,
);
console.log(`  ✓ 公开白名单 ${PUBLIC_WRITE_PATHS.length} 条全部有对应路由`);

// ---------------------------------------------------------------
console.log("== 组4 · 非管理员、也不在公开白名单的写路由必须挂会话校验 ==");

const sessionGuarded = [...actualWriteRoutes.keys()]
  .filter((p) => !p.startsWith("/api/admin") && !PUBLIC_WRITE_PATHS.includes(p));

const unlisted = sessionGuarded.filter((p) => !SESSION_GUARDED_WRITE_ROUTES.has(p));
assert.deepEqual(
  unlisted,
  [],
  `以下写路由既不在公开白名单、也没登记进 SESSION_GUARDED_WRITE_ROUTES。`
    + `它们靠代理层要求管理员会话（安全），但请显式登记以便复核：\n  ${unlisted.join("\n  ")}`,
);

for (const key of sessionGuarded) {
  checked += 1;
  const text = source.get(path.join(process.cwd(), "src", "app", ...key.split("/").filter(Boolean), "route.ts"))!;
  assert.match(text, /verifySessionToken\s*\(/, `${key} 应保留路由内的会话校验（与代理层构成双保险）`);
}
console.log(`  ✓ ${sessionGuarded.length} 个路由靠代理层会话保护，且路由内均有二次校验`);

// ---------------------------------------------------------------
console.log("== 组5 · 高风险写路由必须有审计（缺口 B） ==");

/** 高风险清单：这些操作会改动跨赛事生效或影响官网公开内容，必须可归因 */
const MUST_AUDIT = [
  "src/app/api/admin/events/route.ts",
  "src/app/api/admin/events/publication/route.ts",
  "src/app/api/admin/events/stage/route.ts",
  "src/app/api/admin/events/format/route.ts",
  "src/app/api/admin/events/switch/route.ts",
  "src/app/api/admin/rule-library/route.ts",
  "src/app/api/admin/site-config/route.ts",
  "src/app/api/admin/site-content/route.ts",
  "src/app/api/admin/upload/route.ts",
];

const missingAudit: string[] = [];
for (const key of MUST_AUDIT) {
  const text = source.get(path.join(process.cwd(), key));
  if (text === undefined) { missingAudit.push(`${key}（文件不存在）`); continue; }
  if (!hasAudit(text)) missingAudit.push(key);
}
assert.deepEqual(
  missingAudit,
  [],
  `以下高风险写路由缺少审计调用 recordOperationAuditSafely：\n  ${missingAudit.join("\n  ")}`,
);
console.log(`  ✓ ${MUST_AUDIT.length} 个高风险写路由均已接入审计`);

// ---------------------------------------------------------------
console.log("== 组6 · 审计不得记录敏感原文 ==");

// 从审计调用处往前 400 字符看它写了什么参数；断言不含明显敏感键名。
const FORBIDDEN_METADATA_KEYS = ["password", "credential", "token", "studentId", "phone", "secret", "apiKey"];
const offenders: string[] = [];
for (const [file, text] of source.entries()) {
  const key = rel(file);
  for (const match of text.matchAll(/recordOperationAuditSafely\s*\(([\s\S]{0,400}?)\);/g)) {
    const call = match[1];
    for (const forbidden of FORBIDDEN_METADATA_KEYS) {
      if (new RegExp(`\\b${forbidden}\\b`, "i").test(call)) {
        offenders.push(`${key} 的审计调用里出现 ${forbidden}`);
      }
    }
  }
}
assert.deepEqual(offenders, [], `审计参数疑似包含敏感字段：\n  ${offenders.join("\n  ")}`);
console.log("  ✓ 审计调用未出现密码/凭证/token/学号/手机号等字段名");

// ---------------------------------------------------------------
console.log("== 组7 · 公开读接口不得被误加鉴权 ==");

/**
 * `site-config` 的 GET 是「不登录也能只读核实线上配置」的唯一入口
 * （用它确认生产配置的实际值，是排查「配置值对但页面显示不对」的起点）。
 * 这里锁住该能力，防止后来者为了"统一风格"给它加鉴权。
 */
const siteConfig = source.get(path.join(API_ROOT, "admin", "site-config", "route.ts"));
assert.ok(siteConfig, "site-config 路由应存在");
const getBlock = siteConfig.match(/export\s+async\s+function\s+GET[\s\S]*?\n}/)?.[0] ?? "";
assert.ok(getBlock.length > 0, "应能取到 site-config 的 GET 定义");
assert.equal(
  /isAdmin|verifySessionToken/.test(getBlock),
  false,
  "site-config 的 GET 必须保持公开（线上只读核实的唯一入口），不得加鉴权",
);
assert.match(siteConfig, /export\s+async\s+function\s+PUT/, "site-config 仍应有 PUT");
console.log("  ✓ site-config GET 保持公开，PUT 保留（且已单独鉴权）");

// ---------------------------------------------------------------
console.log("== 组8 · 上传错误不得泄露内部信息 ==");

/**
 * `asset-store` 会抛两类错误：用户输入校验（该展示）与内部故障（不该外泄）。
 * 路由层必须区分，否则「缺少 SUPABASE_SECRET_KEY」「HTTP 500：<上游响应>」
 * 这类内部细节会直接回给调用方。
 */
const upload = source.get(path.join(API_ROOT, "admin", "upload", "route.ts"));
assert.ok(upload, "upload 路由应存在");
assert.match(
  upload,
  /instanceof\s+AssetValidationError/,
  "upload 路由应按 AssetValidationError 区分业务校验错误，其余泛化",
);
assert.match(
  upload,
  /图片上传失败，请重试。/,
  "upload 路由应有泛化兜底文案",
);
console.log("  ✓ upload 路由按业务/内部错误分流，内部故障不外泄");

const assetStore = readFileSync(path.join(process.cwd(), "src", "lib", "asset-store.ts"), "utf8");
const validationThrows = [...assetStore.matchAll(/throw new AssetValidationError\(/g)].length;
assert.ok(validationThrows >= 3, `asset-store 应至少有 3 处业务校验抛 AssetValidationError，实际 ${validationThrows}`);
// 内部错误必须是普通 Error
assert.match(assetStore, /throw new Error\("图片存储缺少 Supabase 配置"\)/, "缺配置应保持普通 Error（由路由泛化）");
console.log(`  ✓ asset-store 区分两类错误（业务校验 ${validationThrows} 处用 AssetValidationError）`);

// ---------------------------------------------------------------
console.log("== 组9 · 限流兜底必须覆盖全部写路由 ==");

/**
 * proxy 用 `find` + `startsWith` 取**首个**匹配的规则，
 * 因此存在一条兜底规则（prefix `/api`）时，任何写路由都不会"无限流"。
 * 这里断言兜底规则存在且排在最后 —— 若有人把兜底挪到前面，所有接口都会退化成 180/10min。
 *
 * 另：兜底只保证"有限流"，不保证限流强度合适。窄前缀必须排在宽前缀之前才生效。
 */
const limitBlock = proxy.match(/const WRITE_LIMITS[\s\S]*?\];/)?.[0] ?? "";
assert.ok(limitBlock.length > 0, "应能取到 WRITE_LIMITS 定义");
const prefixes = [...limitBlock.matchAll(/prefix:\s*"([^"]+)"/g)].map((m) => m[1]);
assert.ok(prefixes.length >= 8, `限流规则数量异常：${prefixes.length}`);
assert.equal(prefixes[prefixes.length - 1], "/api", "兜底规则 /api 必须排在最后（顺序即优先级，宽前缀在后）");
// 窄前缀必须排在宽前缀之前，否则永久不生效
const refereeLogin = prefixes.indexOf("/api/referee/login");
const refereeWide = prefixes.indexOf("/api/referee");
assert.ok(refereeLogin >= 0 && refereeWide >= 0, "应同时存在 /api/referee/login 与 /api/referee");
assert.ok(refereeLogin < refereeWide, "/api/referee/login 必须排在 /api/referee 之前，否则更严的登录限流永不生效");
assert.equal(prefixes.filter((p) => p === "/api").length, 1, "兜底规则只应有一条");
console.log(`  ✓ ${prefixes.length} 条限流规则，窄前缀在前、兜底 /api 在最后`);

// ---------------------------------------------------------------
console.log("");
console.log(`${checked} 项路由检查 + 9 组架构断言全部通过`);
