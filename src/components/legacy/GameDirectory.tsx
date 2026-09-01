import Link from "next/link";
import { LEGACY_GAMES } from "@/lib/legacy-site-content";

export default function GameDirectory() {
  return (
    <section className="legacy-directory">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="legacy-directory__heading">
          <div>
            <p className="section-kicker"><span /> ECUST GAME COMMUNITY</p>
            <h2>找到你的<br />主场。</h2>
          </div>
          <p>从校内赛事到游戏社群，华理电竞部为每一种热爱保留一个入口。</p>
        </div>
        <div className="legacy-directory__grid">
          {LEGACY_GAMES.map((game, index) => (
            <Link
              key={game.slug}
              href={`/${game.slug}`}
              className="legacy-game-card"
              style={{ "--game-accent": game.accent } as React.CSSProperties}
            >
              <span className="legacy-game-card__index">{String(index + 1).padStart(2, "0")}</span>
              <span className="legacy-game-card__eyebrow">{game.eyebrow}</span>
              <strong>{game.name}</strong>
              <span className="legacy-game-card__arrow" aria-hidden="true">↗</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
