import Image from "next/image";
import Link from "next/link";
import { getConfiguredEvents } from "@/lib/configured-events";
import { getEvent } from "@/lib/site-config";
import { getEventStage, STAGE_CONFIGS } from "@/lib/domains/schedule/stage";
import { getPublicSchedule, getPublicSiteConfig } from "@/lib/public-data-cache";
import EventCard from "@/components/events/EventCard";
import Container from "@/components/layout/Container";
import Button from "@/components/ui/Button";
import GameDirectory from "@/components/legacy/GameDirectory";

export const revalidate = 5;

/**
 * 首页（2026-10-20 按 v8 基准改版）
 *
 * 旧版主视觉是全屏海报轮播（EventsCarousel，80vh），下面是红底信息条、能力卡、
 * 游戏目录、红底收尾 CTA —— 一屏里三种底色、四种游戏强调色、两块大面积红。
 *
 * v8 的首页只有一种底色、一种强调色：
 *   Hero（海报做底 + mono 眉标 + clamp 大标题 + 红句号 + 数字条 + 两个 CTA）
 *   → 资料直达（标签行）
 *   → 参赛路径（大编排标题 + 四张取景框卡）
 *   → 游戏社群（取景框卡）
 *   → 收尾（一块取景框 + 主按钮）
 */
export default async function Home() {
  const config = await getPublicSiteConfig();
  const events = getConfiguredEvents(config);
  const current = events[0];
  const cfgEvent = current ? getEvent(config, current.id) : null;
  // 阶段判定（自动 + 手动覆盖）
  const schedule = cfgEvent ? await getPublicSchedule(cfgEvent.id) : { version: 1, matches: [] };
  const hasSchedule = Array.isArray(schedule.matches) && schedule.matches.length > 0;
  const stage = getEventStage({
    status: current?.status ?? "draft",
    registrationStart: cfgEvent?.registrationStart,
    registrationEnd: cfgEvent?.registrationEnd,
    hasSchedule,
  });
  const stageConfig = STAGE_CONFIGS[stage];
  const isPostEvent = stage === "赛后";
  const journeyKicker = isPostEvent ? "TOURNAMENT COMPLETE" : config.home.journeyKicker;
  const journeyTitleTop = isPostEvent ? "从报名，" : config.home.journeyTitleTop;
  const journeyTitleBottom = isPostEvent ? "走到冠军诞生。" : config.home.journeyTitleBottom;
  const closingKicker = isPostEvent ? "FINAL RESULT" : config.home.closingKicker;
  const closingTitle = isPostEvent ? "本届冠军已经诞生。" : config.home.closingTitle;
  const closingCta = isPostEvent ? "查看完整赛果" : config.home.closingCta;
  const closingHref = cfgEvent
    ? isPostEvent
      ? stageConfig.ctaHref.replace("{id}", cfgEvent.id)
      : `/events/${cfgEvent.id}`
    : "/events";

  const matches = Array.isArray(schedule.matches) ? schedule.matches : [];
  const totalMatches = matches.length;
  const doneMatches = matches.filter((match) => match.status === "已完成").length;
  const primaryHref = cfgEvent ? stageConfig.ctaHref.replace("{id}", cfgEvent.id) : "/events";
  const quickLinks = ["赛事手册", "选手名单", "队伍名单", "赛程", "对阵图"];

  return (
    <div>
      {/* 主视觉：当前赛事海报做底（有图用图，没图退回几何海报底）*/}
      <section className="relative overflow-hidden border-b border-[var(--pub-line-soft)]">
        {current?.posterImage && (
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <Image
              src={current.posterImage}
              alt=""
              fill
              priority
              sizes="100vw"
              className="object-cover object-center opacity-45"
            />
            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(10,11,13,0.95)_0%,rgba(10,11,13,0.72)_52%,rgba(10,11,13,0.96)_100%)]" />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,11,13,0.25)_0%,transparent_30%,rgba(10,11,13,0.92)_100%)]" />
          </div>
        )}
        <Container className="ui-page relative">
          <header className="ui-hero">
            <p className="ui-eyebrow">{config.home.kicker}</p>
            <h1>
              {config.home.headlineTop}
              <br />
              {config.home.headlineBottom}
              <em>.</em>
            </h1>
            <p className="ui-sub">{config.home.description}</p>

            <div className="ui-stats">
              <div className="ui-stat">
                <div className="v">{current?.teamCount ?? 0}</div>
                <div className="k">参赛队伍</div>
              </div>
              <div className="ui-stat">
                <div className="v">{totalMatches}</div>
                <div className="k">赛事场次</div>
              </div>
              <div className="ui-stat hot">
                <div className="v">{doneMatches}</div>
                <div className="k">已完成</div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button href={primaryHref} size="lg">{config.home.primaryCta}</Button>
              <Button href="/events" variant="secondary" size="lg">{config.home.secondaryCta}</Button>
            </div>
          </header>
        </Container>
      </section>

      {/* 资料直达：v8 的 .ui-tag 行，替掉原来的红底 signal-strip */}
      <Container className="ui-section">
        <nav aria-label="赛事资料直达" className="flex flex-wrap items-center gap-2">
          {quickLinks.map((item) => (
            <Link
              key={item}
              href={current ? `/events/${current.id}?tab=${encodeURIComponent(item)}` : "/events"}
              className="ui-tag hover:border-[var(--pub-red)] hover:text-[var(--pub-red)]"
            >
              {item}
            </Link>
          ))}
        </nav>
      </Container>

      {/* 参赛路径 */}
      <Container className="ui-section">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="ui-eyebrow">{journeyKicker}</p>
            <h2 className="mt-2 text-[clamp(26px,3.4vw,40px)] font-black leading-[1.08] tracking-[-0.03em] text-[var(--pub-txt)]">
              {journeyTitleTop}
              <br />
              {journeyTitleBottom}
            </h2>
          </div>
          <p className="max-w-[42ch] text-[13.5px] leading-6 text-[var(--pub-txt-soft)]">{config.home.journeyAside}</p>
        </div>

        <div className="ui-grid ui-grid-2 mt-6">
          {config.home.cards.map((capability) => (
            <article key={capability.index} className="ui-frame ui-pad">
              <div className="flex items-start justify-between gap-3">
                <span className="font-mono text-[11px] font-bold tracking-[0.18em] text-[var(--pub-red)]">{capability.index}</span>
                <span aria-hidden className="text-[var(--pub-txt-mute)]">＋</span>
              </div>
              <p className="mt-6 font-mono text-[10.5px] font-bold tracking-[0.16em] text-[var(--pub-txt-mute)]">{capability.meta}</p>
              <h3 className="mt-2 text-[20px] font-black tracking-[-0.01em] text-[var(--pub-txt)]">{capability.title}</h3>
              <p className="mt-2 text-[13px] leading-6 text-[var(--pub-txt-soft)]">{capability.description}</p>
            </article>
          ))}
        </div>
      </Container>

      {/* 游戏社群 */}
      <Container className="ui-section">
        <GameDirectory />
      </Container>

      {/* 历史赛事（只有一个赛事时不渲染）*/}
      {events.length > 1 && (
        <Container className="ui-section">
          <div className="ui-sec ui-sec--tight">
            <h2>{config.home.historyTitle}</h2>
            <span>{config.home.historyKicker}</span>
          </div>
          <div className="ui-grid ui-grid-2 mt-6">
            {events.slice(1).map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
          <div className="mt-5">
            <Link href="/events" className="text-[13px] font-bold text-[var(--pub-red)] hover:underline">
              {config.home.historyLink} →
            </Link>
          </div>
        </Container>
      )}

      {/* 收尾：一块取景框 + 主按钮（原来的整块红底） */}
      <Container className="ui-section ui-page-end">
        <div className="ui-frame ui-pad">
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div>
              <p className="ui-eyebrow">{closingKicker}</p>
              <h2 className="mt-2 text-[clamp(22px,3vw,32px)] font-black tracking-[-0.02em] text-[var(--pub-txt)]">
                {closingTitle}
              </h2>
            </div>
            <Button href={closingHref} size="lg">
              {closingCta} <span aria-hidden>↗</span>
            </Button>
          </div>
        </div>
      </Container>
    </div>
  );
}
