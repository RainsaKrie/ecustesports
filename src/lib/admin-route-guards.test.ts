// =====================
// SYS-04 守卫测试：管理员写路由的鉴权层级与审计覆盖
//
// 为什么写成测试而不是只写在文档里：
//   缺口 A（路由只有一层鉴权）与缺口 B（写操作无留痕）的**根因是同一个**
//   —— 新增路由时没人提醒要加这两样。审计报告一旦归档就没人再翻，
//   而测试会在 CI 里拦住下一次遗漏。
//
// 这类测试断言的是**架构约束**（哪些文件必须包含什么调用），不是实现细节，
// 所以用静态读源码的方式是合适的；代价是重构时可能需同步调整本文件。
//
// 依据：docs/10-后续开发规划/14-SYS-04高风险操作审计与安全补齐_v1.0.md
// =====================

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ADMIN_API_ROOT = path.join(process.cwd(), "src", "app", "api", "admin");

function listRouteFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listRouteFiles(full, acc);
    else if (entry.name === "route.ts") acc.push(full);
  }
  return acc;
}

const routeFiles = listRouteFiles(ADMIN_API_ROOT);
assert.ok(routeFiles.length >= 10, `应能枚举到管理员路由，实际 ${routeFiles.length} 个`);

const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"];
const source = new Map<string, string>();
for (const file of routeFiles) source.set(file, readFileSync(file, "utf8"));

/** 相对路径，用于报错信息可读 */
const rel = (file: string) => path.relative(process.cwd(), file).replace(/\\/g, "/");

const hasWriteMethod = (text: string) =>
  WRITE_METHODS.some((m) => new RegExp(`export\\s+async\\s+function\\s+${m}\\s*\\(`).test(text));

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
 * 显式豁免：这两个接口**本来就不该**有路由级鉴权。
 * 写在这里是为了让"豁免"是可见的决定，而不是漏检。
 */
const AUTH_EXEMPT = new Map<string, string>([
  ["src/app/api/admin/login/route.ts", "登录接口本身即会话入口，鉴权由密码校验承担"],
  ["src/app/api/admin/logout/route.ts", "只清调用者自己的会话 cookie，无副作用；未登录调用也应正常返回"],
]);

let checked = 0;

// ---------------------------------------------------------------
console.log("== 组1 · 每个管理员写路由都要有路由级鉴权（缺口 A） ==");
const writeRoutes = [...source.entries()].filter(([, text]) => hasWriteMethod(text));
assert.ok(writeRoutes.length >= 10, `管理员写路由数量异常：${writeRoutes.length}`);

const withoutAuth: string[] = [];
for (const [file, text] of writeRoutes) {
  const key = rel(file);
  checked += 1;
  if (AUTH_EXEMPT.has(key)) {
    // 豁免项反过来断言：确实**没有**加鉴权，避免将来有人"顺手"加上破坏语义
    assert.equal(hasRouteAuth(text), false, `${key} 在豁免名单里，不应出现路由级鉴权`);
    continue;
  }
  if (!hasRouteAuth(text)) withoutAuth.push(key);
}

assert.deepEqual(
  withoutAuth,
  [],
  `以下管理员写路由缺少路由级鉴权（应加 isAdmin/verifySessionToken，或登记到 AUTH_EXEMPT 并说明理由）：\n  ${withoutAuth.join("\n  ")}`,
);
console.log(`  ✓ ${writeRoutes.length} 个写路由全部满足（其中 ${AUTH_EXEMPT.size} 个显式豁免）`);

// ---------------------------------------------------------------
console.log("== 组2 · 高风险写路由必须有审计（缺口 B） ==");

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
console.log("== 组3 · 审计不得记录敏感原文 ==");

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
console.log("== 组4 · 公开读接口不得被误加鉴权 ==");

/**
 * `site-config` 的 GET 是「不登录也能只读核实线上配置」的唯一入口
 * （用它确认生产配置的实际值，是排查「配置值对但页面显示不对」的起点）。
 * 这里锁住该能力，防止后来者为了"统一风格"给它加鉴权。
 */
const siteConfig = source.get(path.join(ADMIN_API_ROOT, "site-config", "route.ts"));
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
console.log("== 组5 · 上传错误不得泄露内部信息 ==");

/**
 * `asset-store` 会抛两类错误：用户输入校验（该展示）与内部故障（不该外泄）。
 * 路由层必须区分，否则「缺少 SUPABASE_SECRET_KEY」「HTTP 500：<上游响应>」
 * 这类内部细节会直接回给调用方。
 */
const upload = source.get(path.join(ADMIN_API_ROOT, "upload", "route.ts"));
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
console.log("== 组6 · 限流兜底必须覆盖全部写路由 ==");

/**
 * proxy 用 `find` + `startsWith` 取**首个**匹配的规则，
 * 因此存在一条兜底规则（prefix `/api`）时，任何写路由都不会"无限流"。
 * 这里断言兜底规则存在且排在最后 —— 若有人把兜底挪到前面，所有接口都会退化成 180/10min。
 */
const proxy = readFileSync(path.join(process.cwd(), "src", "proxy.ts"), "utf8");
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
console.log(`${checked} 项路由检查 + 6 组架构断言全部通过（SYS-04 守卫）`);
