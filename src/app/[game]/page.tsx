import { notFound, redirect } from "next/navigation";
import { getLegacyGame, LEGACY_GAMES } from "@/lib/legacy-site-content";

export function generateStaticParams() {
  return LEGACY_GAMES.map((game) => ({ game: game.slug }));
}

/**
 * 游戏落地页已下线（2026-10-20 决策①）
 *
 * 这四个页面是旧浅色世界（浅底、圆角、阴影、每个游戏一个强调色），
 * 与全站 v8 基准（纯黑 + 单一强调色 + 零圆角）完全相反，重画收益低于直接并到赛事页。
 * 站外或群里流传的旧链接仍然会走到这里 —— 用重定向兜底，不返回 404。
 */
export default async function GamePage({ params }: { params: Promise<{ game: string }> }) {
  const { game: slug } = await params;
  if (!getLegacyGame(slug)) notFound();
  redirect("/events");
}
