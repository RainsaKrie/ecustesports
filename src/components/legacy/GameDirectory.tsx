import Link from "next/link";
import { LEGACY_GAMES } from "@/lib/legacy-site-content";

/**
 * 游戏社群目录（2026-10-20 按 v8 基准改版）
 *
 * 旧版是 `.legacy-game-card`：每张卡按游戏取一个强调色（黄/红/绿/青），
 * 与 v8「全站只有一种强调色」直接冲突 —— 一屏出现四种彩色就是"花"。
 * 现在统一成玻璃取景框 + 单一红色眉标。
 *
 * 链接从 `/{slug}`（已改为重定向到 /events）改成直接到 /contact：
 * 游戏落地页下线后，每款游戏的群号在「联系我们」里，那才是这张卡真正的去向。
 * 外层 Container 由调用方（首页）提供，这里只管内容。
 */
export default function GameDirectory() {
  return (
    <section>
      <div className="ui-sec ui-sec--tight">
        <h2>游戏社群</h2>
        <span>{String(LEGACY_GAMES.length).padStart(2, "0")} 个游戏</span>
      </div>

      <div className="ui-grid ui-grid-2 mt-6">
        {LEGACY_GAMES.map((game, index) => (
          <Link key={game.slug} href="/contact" className="ui-frame ui-pad group block">
            <div className="flex items-start justify-between gap-3">
              <span className="font-mono text-[11px] font-bold tracking-[0.18em] text-[var(--pub-red)]">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="font-mono text-[10.5px] tracking-[0.14em] text-[var(--pub-txt-mute)]">{game.eyebrow}</span>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3">
              <strong className="text-[20px] font-black tracking-[-0.01em] text-[var(--pub-txt)]">{game.name}</strong>
              <span aria-hidden className="text-[var(--pub-red)]">↗</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
