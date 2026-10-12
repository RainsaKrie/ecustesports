// =====================
// 校验一份**已经躺在磁盘上**的备份文件还能不能用
//
// 这个命令只读一个本地文件：不连库、不要凭据、不收任何网络参数。
// 所以它**在比赛进行中也能随时跑** —— 那正是你最想知道「我那份备份还作数吗」的时刻。
//
// 它与 `backup-restore.ts` 共用同一套算法（`./backup-format`）：
// 两处各写一份 `stable/checksum` 的后果是校验工具会对完好的备份报错，从此没人再信它。
//
// 用法：
//   npm run ops:verify-backup -- D:/ecustbaks/ecust-2026-10-12.json
//   npm run ops:verify-backup -- --selftest         自检这套命令本身（不需要任何文件）
//
// 退出码：0 = 这份备份可用；1 = 不可用（文件在，但内容不可信）；2 = 用法/路径问题（没读内容）
// =====================

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BACKUP_SCHEMA_VERSION,
  checksum,
  verifyBackup,
  type BackupVerification,
} from "./backup-format";

/** 真出事时最要紧的两份。缺了它们，「有备份」是假的。 */
const CORE_DOCUMENT_NAMES = ["registration", "schedule"];

interface VerifyOptions {
  allowRepoPath: boolean;
  cwd: string;
}

interface RunOutcome {
  exitCode: number;
  lines: string[];
}

function normalize(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

/** 路径是不是落在项目仓库里。Windows 上大小写不敏感，必须先归一再比。 */
function isInsideRepo(target: string, cwd: string): boolean {
  const root = normalize(path.resolve(cwd));
  const resolved = normalize(path.resolve(target));
  return resolved === root || resolved.startsWith(root + path.sep);
}

function metaOf(parsed: unknown): { exportedAt: string | null; source: string | null } {
  if (!parsed || typeof parsed !== "object") return { exportedAt: null, source: null };
  const record = parsed as Record<string, unknown>;
  return {
    exportedAt: typeof record.exportedAt === "string" ? record.exportedAt : null,
    source: typeof record.source === "string" ? record.source : null,
  };
}

/**
 * 备份有多旧。
 *
 * 这条只在**内容已经通过校验**之后才说，因为它是提醒不是判罚：
 * 一份三天前导出的完好备份，校验当然通过 —— 但比赛期间数据天天在变，它可能已经不够新了。
 */
function ageNote(exportedAt: string | null): string | null {
  if (!exportedAt) return null;
  const when = Date.parse(exportedAt);
  if (Number.isNaN(when)) return `导出时间「${exportedAt}」不是能识别的时间格式。`;
  const hours = (Date.now() - when) / 3_600_000;
  if (hours < -1) return `导出时间在未来（${exportedAt}）—— 导出那台机器的时钟可能不对。`;
  if (hours >= 24) return `这份备份是 ${Math.floor(hours / 24)} 天前导出的；比赛期间数据在变，确认它够新，否则再导一份。`;
  return null;
}

/**
 * 缺了核心文档要单独说 —— 「校验通过」不等于「这份备份够用」。
 *
 * 判据是「这份里有哪几份**可用**」，而不是「有没有被标成 absent」：
 * 一份备份少掉 schedule 有两种长相 —— 导出时标了 `sha256: null`，或者文件里压根没这一条。
 * 只看 absent 标记会漏掉后一种，而它恰恰是「备份少了一份」最常见的样子（自检抓到过）。
 */
function coreWarnings(verified: BackupVerification): string[] {
  const usableKeys = verified.results
    .filter((result) => result.status === "ok")
    .map((result) => result.key);
  return CORE_DOCUMENT_NAMES
    .filter((name) => !usableKeys.some((key) => key.endsWith(`/${name}`)))
    .map((name) => `这份备份里没有可用的 ${name} —— 真出事时你恢复不出${name === "registration" ? "报名与队伍" : "赛程"}，先确认这是有意的。`);
}

/**
 * 校验一个路径。整段逻辑收在一个函数里，是为了让 `--selftest` 能直接调它 ——
 * 校验的是**这个命令真实的判断**，而不是另写一版仿制品。
 */
function runVerify(rawPath: string | undefined, options: VerifyOptions): RunOutcome {
  if (!rawPath) {
    return {
      exitCode: 2,
      lines: [
        "用法：npm run ops:verify-backup -- <仓库外的备份文件路径>",
        "      （不接任何网络参数；也可以加 --selftest 自检这套命令本身）",
      ],
    };
  }

  const resolved = path.resolve(rawPath);
  if (!options.allowRepoPath && isInsideRepo(resolved, options.cwd)) {
    return {
      exitCode: 2,
      lines: [
        `这个路径在项目仓库里：${resolved}`,
        "仓库里出现备份文件，多半是测试夹具而不是真的备份 —— 校验它只会给你虚假的安心。",
        "确认要对它校验，请加 --allow-repo-path。",
      ],
    };
  }

  if (!existsSync(resolved)) {
    return {
      exitCode: 1,
      lines: [
        `找不到这个文件：${resolved}`,
        "备份没落在你以为的地方 —— 先确认路径，别急着据此判断「备份坏了」。",
      ],
    };
  }

  const text = readFileSync(resolved, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      exitCode: 1,
      lines: [
        `这个文件不是合法 JSON：${resolved}`,
        `文件大小 ${Buffer.byteLength(text)} 字节。`,
        error instanceof Error ? error.message : String(error),
        "写了一半被打断、或者磁盘满，都会留下这种文件。",
      ],
    };
  }

  const verified = verifyBackup(parsed);
  const meta = metaOf(parsed);
  const lines: string[] = [];
  const okKeys = verified.results.filter((result) => result.status === "ok").map((result) => result.key);
  const absentKeys = verified.results.filter((result) => result.status === "absent").map((result) => result.key);

  lines.push(verified.ok ? `备份可用：${resolved}` : `备份不可用：${resolved}`);
  lines.push(`  导出时间：${meta.exportedAt ?? "（读不出来）"}`);
  lines.push(`  来源：${meta.source ?? "（读不出来）"}    格式版本：${verified.schemaVersion ?? "（读不出来）"}`);

  if (okKeys.length > 0) lines.push(`通过 ${okKeys.length} 份：${okKeys.join("、")}`);
  if (absentKeys.length > 0) {
    lines.push(`导出时就不存在 ${absentKeys.length} 份：${absentKeys.join("、")}`);
  }

  if (!verified.ok) {
    lines.push("问题：");
    for (const problem of verified.problems) lines.push(`  · ${problem}`);
    lines.push("这份备份的**内容**不可信，别拿它去恢复；重新导一份。");
    return { exitCode: 1, lines };
  }

  const note = ageNote(meta.exportedAt);
  if (note) lines.push(`注意：${note}`);
  for (const warning of coreWarnings(verified)) lines.push(`注意：${warning}`);
  return { exitCode: 0, lines };
}

// ── 自检：不碰网络、不碰仓库，只在一个临时目录里造几份合成备份 ──────────────

function selftest(): RunOutcome {
  const lines: string[] = [];
  let pass = 0;
  let fail = 0;
  const check = (name: string, ok: boolean, detail = "") => {
    if (ok) {
      pass += 1;
      lines.push(`  ✓ ${name}`);
    } else {
      fail += 1;
      lines.push(`  ✗ ${name}${detail ? `（${detail}）` : ""}`);
    }
  };

  const dir = mkdtempSync(path.join(tmpdir(), "ecust-backup-selftest-"));
  const cwd = process.cwd();

  const REGISTRATION = { players: [{ id: "P-1", name: "甲" }], teams: [{ id: "T-1" }] };
  const SCHEDULE = { version: 75, matches: [{ id: "M01", status: "已完成", winnerTeamId: "T-1" }] };
  const sound = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    source: "自检合成",
    documents: [
      { scope: "event", eventId: "event-1", name: "registration", sha256: checksum(REGISTRATION), payload: REGISTRATION },
      { scope: "event", eventId: "event-1", name: "schedule", sha256: checksum(SCHEDULE), payload: SCHEDULE },
    ],
  };

  const soundPath = path.join(dir, "sound.json");
  writeFileSync(soundPath, JSON.stringify(sound, null, 2), "utf8");

  const tamperedPath = path.join(dir, "tampered.json");
  writeFileSync(
    tamperedPath,
    JSON.stringify({
      ...sound,
      // 只动 schedule，registration 一字不改
      documents: [sound.documents[0], { ...sound.documents[1], payload: { ...SCHEDULE, version: 76 } }],
    }, null, 2),
    "utf8",
  );

  const brokenPath = path.join(dir, "broken.json");
  writeFileSync(brokenPath, "{ 这不是 JSON", "utf8");

  const inRepoPath = path.join(cwd, "data", "site-config.json");

  lines.push("== 组1 · 完好的备份应当通过 ==");
  const okRun = runVerify(soundPath, { allowRepoPath: false, cwd });
  check("退出码 0", okRun.exitCode === 0, okRun.lines.join(" | "));
  check("结论是「备份可用」", okRun.lines.some((line) => line.startsWith("备份可用：")), okRun.lines.join(" | "));
  check("报出通过几份", okRun.lines.some((line) => /^通过 2 份：/.test(line)), okRun.lines.join(" | "));
  check("报出导出时间与来源", okRun.lines.some((line) => line.includes("导出时间：")) && okRun.lines.some((line) => line.includes("来源：自检合成")), okRun.lines.join(" | "));

  lines.push("== 组2 · 内容被改过：必须指到具体那一份 ==");
  const badRun = runVerify(tamperedPath, { allowRepoPath: false, cwd });
  check("退出码 1", badRun.exitCode === 1, String(badRun.exitCode));
  check("结论是「备份不可用」", badRun.lines.some((line) => line.startsWith("备份不可用：")), badRun.lines.join(" | "));
  check("点名对不上的是 schedule", badRun.lines.some((line) => line.includes("event/event-1/schedule") && line.includes("校验和对不上")), badRun.lines.join(" | "));
  check("同时说明 registration 仍然是好的", badRun.lines.some((line) => line.startsWith("通过 1 份：") && line.includes("registration")), badRun.lines.join(" | "));

  lines.push("== 组3 · 路径与文件本身的毛病要好懂 ==");
  const noPath = runVerify(undefined, { allowRepoPath: false, cwd });
  check("不给路径 → 退出码 2 且说明用法", noPath.exitCode === 2 && noPath.lines.some((line) => line.includes("用法")), noPath.lines.join(" | "));

  const repoRun = runVerify(inRepoPath, { allowRepoPath: false, cwd });
  check("仓库内的路径 → 拒绝", repoRun.exitCode === 2 && repoRun.lines.some((line) => line.includes("项目仓库")), repoRun.lines.join(" | "));
  check("并给出绕过办法", repoRun.lines.some((line) => line.includes("--allow-repo-path")), repoRun.lines.join(" | "));

  const allowedRun = runVerify(inRepoPath, { allowRepoPath: true, cwd });
  check("加了 --allow-repo-path 就不再拦（不再是退出码 2）", allowedRun.exitCode !== 2, allowedRun.lines.join(" | "));

  const missingRun = runVerify(path.join(dir, "never-existed.json"), { allowRepoPath: false, cwd });
  check("文件不存在 → 退出码 1 且说「找不到」", missingRun.exitCode === 1 && missingRun.lines.some((line) => line.includes("找不到")), missingRun.lines.join(" | "));
  check("并提醒别据此判断备份坏了", missingRun.lines.some((line) => line.includes("别急着")), missingRun.lines.join(" | "));

  const brokenRun = runVerify(brokenPath, { allowRepoPath: false, cwd });
  check("不是 JSON → 退出码 1 且说清", brokenRun.exitCode === 1 && brokenRun.lines.some((line) => line.includes("不是合法 JSON")), brokenRun.lines.join(" | "));
  check("并报出文件大小（0 字节是一条线索）", brokenRun.lines.some((line) => /文件大小 \d+ 字节/.test(line)), brokenRun.lines.join(" | "));

  lines.push("== 组4 · 缺核心文档：能通过，但要单独提醒 ==");

  // 长相一：文件里压根没有 schedule 这一条
  const noSchedulePath = path.join(dir, "no-schedule.json");
  writeFileSync(noSchedulePath, JSON.stringify({ ...sound, documents: [sound.documents[0]] }, null, 2), "utf8");
  const missingEntryRun = runVerify(noSchedulePath, { allowRepoPath: false, cwd });
  check("少一条不算失败 → 退出码 0", missingEntryRun.exitCode === 0, missingEntryRun.lines.join(" | "));
  check("但明确提醒没有可用的 schedule", missingEntryRun.lines.some((line) => line.includes("没有可用的 schedule")), missingEntryRun.lines.join(" | "));
  // 反面也要查：registration 明明好好的，不能一起被提醒。
  // 只查「提醒了 schedule」的话，「把每一份都提醒一遍」也能骗过这条断言。
  check("没有误报 registration", !missingEntryRun.lines.some((line) => line.includes("没有可用的 registration")), missingEntryRun.lines.join(" | "));

  // 长相二：导出时把它标成了 sha256=null
  const absentMarkedPath = path.join(dir, "absent-marked.json");
  writeFileSync(
    absentMarkedPath,
    JSON.stringify({
      ...sound,
      documents: [sound.documents[0], { scope: "event", eventId: "event-1", name: "schedule", sha256: null }],
    }, null, 2),
    "utf8",
  );
  const absentRun = runVerify(absentMarkedPath, { allowRepoPath: false, cwd });
  check("标成缺失也不算失败 → 退出码 0", absentRun.exitCode === 0, absentRun.lines.join(" | "));
  check("同样提醒没有可用的 schedule（两种长相都要认）", absentRun.lines.some((line) => line.includes("没有可用的 schedule")), absentRun.lines.join(" | "));
  check("这里也没有误报 registration", !absentRun.lines.some((line) => line.includes("没有可用的 registration")), absentRun.lines.join(" | "));
  check("并列出导出时就不存在的是哪几份", absentRun.lines.some((line) => line.startsWith("导出时就不存在 1 份：") && line.includes("schedule")), absentRun.lines.join(" | "));

  rmSync(dir, { recursive: true, force: true });

  lines.push("");
  lines.push(`结果：通过 ${pass} / ${pass + fail}`);
  return { exitCode: fail > 0 ? 1 : 0, lines };
}

// ── 入口 ────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((raw) => raw.startsWith("--")));
  const positional = argv.filter((raw) => !raw.startsWith("--"));

  const outcome = flags.has("--selftest")
    ? selftest()
    : runVerify(positional[0], { allowRepoPath: flags.has("--allow-repo-path"), cwd: process.cwd() });

  for (const line of outcome.lines) process.stdout.write(`${line}\n`);
  process.exitCode = outcome.exitCode;
}

main();
