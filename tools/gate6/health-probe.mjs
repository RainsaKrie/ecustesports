#!/usr/bin/env node
/**
 * 赛事期只读巡检（SYS-02 §2/§3）。
 *
 * 用法：
 *   node tools/gate6/health-probe.mjs
 *   node tools/gate6/health-probe.mjs --base=https://ecustesports.top
 *   node tools/gate6/health-probe.mjs --timeout=8000 --json
 *
 * 只做公开 GET，不带任何密钥、不登录、不写数据。
 * 目的是在比赛日几分钟内判断故障落在哪一层：网络 / 平台 / 前端 / 数据层。
 */

const args = new Map();
for (const raw of process.argv.slice(2)) {
  const [key, ...rest] = raw.replace(/^--/, "").split("=");
  args.set(key, rest.join("=") || "true");
}

const BASE = (args.get("base") || "https://ecustesports.top").replace(/\/+$/, "");
const TIMEOUT = Number(args.get("timeout") || 8000);
const AS_JSON = args.has("json");
const EVENT_ID = args.get("event") || "";

async function probe(label, url) {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { "user-agent": "ecustesports-health-probe/1.0" },
    });
    const body = await response.text();
    return {
      label,
      ok: true,
      status: response.status,
      ms: Date.now() - startedAt,
      bytes: Buffer.byteLength(body),
      contentType: response.headers.get("content-type") || "",
      vercelId: response.headers.get("x-vercel-id") || "",
      cacheControl: response.headers.get("cache-control") || "",
      body,
    };
  } catch (error) {
    return {
      label,
      ok: false,
      status: 0,
      ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "请求失败",
      body: "",
    };
  }
}

function line(text) {
  if (!AS_JSON) process.stdout.write(`${text}\n`);
}

async function main() {
  line(`巡检目标：${BASE}`);
  line(`开始时间：${new Date().toISOString()}`);
  line("");

  const home = await probe("首页", `${BASE}/`);
  const health = await probe("健康接口", `${BASE}/api/health`);
  const schedule = await probe("公开赛程接口", `${BASE}/api/public/schedule${EVENT_ID ? `?eventId=${encodeURIComponent(EVENT_ID)}` : ""}`);

  let healthBody = null;
  let healthParseError = "";
  if (health.ok) {
    try {
      healthBody = JSON.parse(health.body);
    } catch {
      healthParseError = "健康接口返回的不是 JSON";
    }
  }

  const scheduleIsJson = (() => {
    if (!schedule.ok) return false;
    try {
      JSON.parse(schedule.body);
      return true;
    } catch {
      return false;
    }
  })();

  const atPlatform = Boolean(home.vercelId || health.vercelId || schedule.vercelId);
  const backendOk = Boolean(healthBody && healthBody.ok === true);
  const backendChecks = (healthBody && typeof healthBody.checks === "object" && healthBody.checks) || null;
  const htmlLooksLikePage = home.ok
    && home.status === 200
    && home.contentType.includes("text/html")
    && home.bytes > 500;

  let verdict;
  let advice;

  if (!home.ok && !health.ok && !schedule.ok) {
    verdict = "网络或 DNS：三个地址全部连不上";
    advice = [
      "换一个网络（手机热点）重试同一条命令，若恢复即为本地网络或校园网问题。",
      "在浏览器直接打开首页，确认是否为运营商或 DNS 解析问题。",
      "确认自己没开代理；开了代理时请关掉再试。",
    ];
  } else if (!atPlatform) {
    verdict = "平台层可疑：响应里没有 Vercel 标记";
    advice = [
      "打开 Vercel 控制台，看 Deployments 最近一次部署与状态。",
      "确认域名解析还指向 Vercel，没有被改动。",
    ];
  } else if (!backendOk) {
    if (healthParseError) {
      verdict = `应用接口异常：${healthParseError}（HTTP ${health.status}）`;
      advice = ["看 Vercel Functions 日志最近一次错误。", "确认最近一次部署是成功的。"];
    } else if (backendChecks && backendChecks.database === "down" && backendChecks.storage === "down") {
      verdict = "数据层故障：数据库与存储都不可用";
      advice = [
        "打开 Supabase 控制台，确认项目是否被暂停（免费版长期不活跃会自动暂停）。",
        "项目被暂停时点 Restore 恢复，恢复后重跑本命令。",
        "同时启动人工兜底：把最新导出的赛程发到群里。",
      ];
    } else if (backendChecks && backendChecks.database === "down") {
      verdict = "数据层故障：数据库不可用（存储正常）";
      advice = ["打开 Supabase 控制台确认项目状态与用量。", "确认没有把数据库额度用尽。"];
    } else if (backendChecks && backendChecks.storage === "down") {
      verdict = "数据层故障：对象存储不可用（数据库正常）";
      advice = [
        "打开 Supabase 控制台确认 Storage 用量是否超过 1GB 免费额度。",
        "临时关闭海报上传相关操作，赛事主体流程可继续。",
      ];
    } else {
      verdict = `后端异常：健康接口 HTTP ${health.status}，未给出具体能力状态`;
      advice = ["看 Vercel Functions 日志。", "确认生产环境变量没有被改动过。"];
    }
  } else if (!schedule.ok || !scheduleIsJson) {
    verdict = `应用层异常：公开赛程接口 HTTP ${schedule.status}${scheduleIsJson ? "" : "，且返回内容不是 JSON"}`;
    advice = [
      "先确认传入的赛事 ID 是否正确（未传 ID 时返回 404 属正常）。",
      "若传了正确 ID 仍失败，看 Vercel Functions 日志。",
    ];
  } else if (!htmlLooksLikePage) {
    verdict = `前端异常：首页 HTTP ${home.status}，内容不像正常页面`;
    advice = ["确认最近一次部署是否成功。", "强刷一次浏览器（Ctrl+F5）排除旧缓存。"];
  } else {
    verdict = "正常：四层全部通过";
    advice = ["无需处理。若玩家仍反馈异常，属于具体功能问题，按功能排查。"];
  }

  const report = {
    probedAt: new Date().toISOString(),
    base: BASE,
    eventIdProvided: Boolean(EVENT_ID),
    verdict,
    layers: {
      network: home.ok || health.ok || schedule.ok ? "可达" : "不可达",
      platform: atPlatform ? "Vercel" : "未识别",
      frontend: { ok: htmlLooksLikePage, status: home.status, ms: home.ms, bytes: home.bytes, contentType: home.contentType },
      backend: { ok: backendOk, status: health.status, ms: health.ms, checks: backendChecks, parseError: healthParseError },
      publicRead: { ok: schedule.ok && scheduleIsJson, status: schedule.status, ms: schedule.ms },
    },
    advice,
  };

  if (AS_JSON) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    line("—— 分层结果 ——");
    line(`网络      ${report.layers.network}`);
    line(`平台      ${report.layers.platform}`);
    line(`前端      首页 HTTP ${home.status}，${home.ms}ms，${home.bytes}B${htmlLooksLikePage ? "" : "（异常）"}`);
    line(`后端      健康接口 HTTP ${health.status}，${health.ms}ms${backendChecks ? `，database=${backendChecks.database} storage=${backendChecks.storage}` : ""}`);
    line(`公开读取  赛程接口 HTTP ${schedule.status}，${schedule.ms}ms${scheduleIsJson ? "" : "（非 JSON）"}`);
    if (!EVENT_ID) {
      line("          （未指定赛事 ID，此处返回 404 属正常；加 --event=<赛事ID> 可测真实读取）");
    }
    line("");
    line(`判断：${verdict}`);
    line("");
    line("建议动作：");
    for (const item of advice) line(`  · ${item}`);
  }

  process.exitCode = verdict.startsWith("正常") ? 0 : 2;
}

void main().catch((error) => {
  process.stderr.write(`巡检脚本自身出错：${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
