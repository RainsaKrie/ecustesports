import Link from "next/link";
import type { LegacyGame } from "@/lib/legacy-site-content";

export default function GameLanding({ game }: { game: LegacyGame }) {
  return (
    <div className="min-h-screen" style={{ background: game.background }}>
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* 背景装饰 */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0" style={{
            backgroundImage: `radial-gradient(circle at 2px 2px, ${game.accent} 1px, transparent 0)`,
            backgroundSize: '48px 48px'
          }} />
        </div>

        <div className="relative mx-auto max-w-6xl px-6 py-20 md:py-32">
          {/* Eyebrow */}
          <div className="mb-4 inline-block rounded-full px-4 py-1.5 text-xs font-black tracking-wider"
               style={{
                 backgroundColor: `${game.accent}20`,
                 color: game.accent,
                 border: `1px solid ${game.accent}40`
               }}>
            {game.eyebrow}
          </div>

          {/* 标题 */}
          <h1 className="mb-6 text-5xl font-black leading-tight text-white md:text-7xl">
            {game.name}
            <span className="block text-3xl font-light italic opacity-80 md:text-4xl"
                  style={{ color: game.accent }}>
              {game.tagline}
            </span>
          </h1>

          {/* 描述 */}
          <p className="mb-8 max-w-2xl text-lg leading-relaxed text-white/80">
            {game.description}
          </p>

          {/* 特性标签 */}
          <div className="mb-10 flex flex-wrap gap-2">
            {game.features?.map((feature) => (
              <span key={feature}
                    className="rounded-full px-3 py-1 text-sm font-bold"
                    style={{
                      backgroundColor: `${game.accent}15`,
                      color: game.accent,
                      border: `1px solid ${game.accent}30`
                    }}>
                {feature}
              </span>
            ))}
          </div>

          {/* CTA 按钮 */}
          <div className="flex flex-wrap gap-4">
            <Link href="/contact"
               className="rounded-full px-8 py-3 font-black transition-all hover:scale-105"
               style={{
                 backgroundColor: game.accent,
                 color: '#0f1923',
                 boxShadow: `0 4px 20px ${game.accent}40`
               }}>
              查看社群
            </Link>
            <Link href="/events"
                  className="rounded-full border-2 px-8 py-3 font-black text-white transition-all hover:bg-white/10"
                  style={{ borderColor: game.accent }}>
              查看赛事
            </Link>
          </div>
        </div>

        {/* 装饰性渐变 */}
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[var(--paper)] to-transparent" />
      </section>

      {/* 赛事信息区 */}
      <section className="bg-[var(--paper)] py-16">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-8 md:grid-cols-2">
            {/* 当前赛事 */}
            <div className="rounded-2xl border border-[var(--pub-line-soft)] bg-[var(--pub-card)] p-8 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-2xl font-black" style={{ color: game.accent }}>
                  {game.tournament}
                </h2>
                <span className="rounded-full px-3 py-1 text-xs font-bold"
                      style={{
                        backgroundColor: `${game.accent}20`,
                        color: game.accent,
                      }}>
                  {game.status}
                </span>
              </div>
              <p className="mb-6 text-sm text-[var(--ink)]/60">
                赛事报名与赛程以赛事页面的最新状态为准。
              </p>
              <Link href="/events"
                    className="inline-flex items-center gap-2 font-bold transition-colors"
                    style={{ color: game.accent }}>
                查看详情
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M6 3L11 8L6 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </Link>
            </div>

            {/* 社群信息 */}
            <div className="rounded-2xl border border-[var(--pub-line-soft)] bg-[var(--pub-card)] p-8 shadow-sm">
              <h2 className="mb-4 text-2xl font-black text-[var(--ink)]">
                加入社群
              </h2>
              <p className="mb-4 text-sm text-[var(--ink)]/60">
                与华理玩家一起交流，获取最新赛事资讯，组队开黑。
              </p>
              <div className="mb-6 flex items-center gap-3">
                <span className="text-sm font-bold text-[var(--ink)]/60">QQ 群号</span>
                <code className="rounded bg-black/5 px-3 py-1 font-mono text-sm font-bold"
                      style={{ color: game.accent }}>
                  {game.community}
                </code>
              </div>
              <Link href="/contact"
                 className="inline-block rounded-full border-2 px-6 py-2 text-sm font-black transition-all hover:bg-black/5"
                 style={{
                   borderColor: game.accent,
                   color: game.accent
                 }}>
                查看全部社群
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 最新动态 */}
      <section className="bg-[var(--paper-deep)] py-16">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="mb-8 text-3xl font-black text-[var(--ink)]">最新动态</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {game.news.map((item, idx) => (
              <div key={idx}
                   className="group rounded-xl border border-[var(--pub-line-soft)] bg-[var(--pub-card)] p-6 transition-all hover:shadow-lg">
                <div className="mb-3 h-1 w-12 rounded-full"
                     style={{ backgroundColor: game.accent }} />
                <h3 className="font-bold leading-snug text-[var(--ink)] group-hover:underline">
                  {item}
                </h3>
              </div>
            ))}
          </div>
          <div className="mt-8 text-center">
            <Link href="/news"
                  className="inline-flex items-center gap-2 font-bold transition-colors"
                  style={{ color: game.accent }}>
              查看更多公告
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M6 3L11 8L6 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Link>
          </div>
        </div>
      </section>

      {/* 底部渐变装饰 */}
      <div className="h-16" style={{
        background: `linear-gradient(to bottom, ${game.background.split('(')[0]}(to bottom, transparent, ${game.accent}10))`
      }} />
    </div>
  );
}
