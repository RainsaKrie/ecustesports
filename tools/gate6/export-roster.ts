// =====================
// 导出赛事名单（只读，2026-10-17）
//
// 用途：给赛果识别评测集提供「队名 → 选手游戏昵称」，模型靠昵称把结算页的底色对应到队伍。
//
// 用法（口令只从本机环境变量读，不写文件、不回显）：
//   ADMIN_PASSWORD=你的口令 npm run ops:export-roster
// 产出：.workbuddy/ai-dataset/roster.json（**只含队名与游戏昵称**，不含 QQ / 学号 / 学院）
//
// ★ 为什么不在公开接口拿：公开报名接口按隐私设计**不返回选手昵称**（已实测，36 队 0 昵称）。
// =====================

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE = (process.env.BASE ?? "https://ecustesports.top").replace(/\/$/, "");
const EVENT_ID = process.env.EVENT_ID ?? "event-1";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const OUT = path.join(process.cwd(), ".workbuddy", "ai-dataset", "roster.json");

if (!PASSWORD) {
  console.error("缺少 ADMIN_PASSWORD。例：ADMIN_PASSWORD=xxx npm run ops:export-roster");
  process.exit(2);
}

/** 游戏昵称去掉 `#` 标签（评测集要求，带 `#` 会被校验器拒绝） */
const stripTag = (value: unknown) => String(value ?? "").split("#")[0].trim();

async function main() {
  const login = await fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE, referer: `${BASE}/admin` },
    body: JSON.stringify({ password: PASSWORD }),
  });
  if (!login.ok) {
    console.error(`登录失败 HTTP ${login.status}（口令不对或站点不可达）`);
    process.exit(1);
  }
  const cookie = (login.headers.getSetCookie?.() ?? []).map((item) => item.split(";")[0]).join("; ");
  const response = await fetch(`${BASE}/api/data/registration?eventId=${encodeURIComponent(EVENT_ID)}`, {
    headers: { cookie, origin: BASE, referer: `${BASE}/admin` },
    cache: "no-store",
  });
  if (!response.ok) {
    console.error(`读取报名数据失败 HTTP ${response.status}`);
    process.exit(1);
  }
  const data = (await response.json()) as {
    teams?: Array<{ id: string; name: string }>;
    players?: Array<{ teamId?: string; gameId?: string; role?: string }>;
  };
  const teamName = new Map((data.teams ?? []).map((team) => [team.id, team.name]));
  const teams = (data.teams ?? []).map((team) => ({
    name: team.name,
    players: (data.players ?? [])
      .filter((player) => player.teamId === team.id)
      .map((player) => ({ nick: stripTag(player.gameId), role: player.role ?? "" }))
      .filter((player) => player.nick.length > 0),
  }));
  const missing = teams.filter((team) => team.players.length === 0);
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), eventId: EVENT_ID, teams }, null, 2), "utf8");
  console.log(`队伍 ${teams.length} 支，有昵称的 ${teams.filter((t) => t.players.length > 0).length} 支`);
  console.log(`已写入 ${path.relative(process.cwd(), OUT)}（不含 QQ / 学号）`);
  if (missing.length > 0) console.log(`没有昵称的队伍：${missing.map((t) => t.name).join("、")}`);
  void teamName;
}

main().catch((error) => {
  console.error("导出失败：", error instanceof Error ? error.message : error);
  process.exit(1);
});
