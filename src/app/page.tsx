import Link from "next/link";
import { Fragment } from "react";
import { getConfiguredEvents } from "@/lib/configured-events";
import { getEvent } from "@/lib/site-config";
import { getEventStage, STAGE_CONFIGS } from "@/lib/scheduling/stage";
import {
  getPublicSchedule,
  getPublicSiteConfig,
} from "@/lib/public-data-cache";
import EventsCarousel from "@/components/events/EventsCarousel";
import EventCard from "@/components/events/EventCard";
import Container from "@/components/layout/Container";
import Button from "@/components/ui/Button";
import GameDirectory from "@/components/legacy/GameDirectory";

export const revalidate = 5;

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

  return (
    <div className="home-shell">
      {/* 主视觉：当前赛事海报作底板（替代原 hero-stage + live-panel）*/}
      {current ? (
        <EventsCarousel events={events} height="min-h-[80vh]" stage={stage} />
      ) : (
        <section className="grid min-h-[70vh] place-items-center bg-[#09111a] px-6 text-center text-white">
          <div className="max-w-2xl">
            <p className="font-mono text-xs font-black tracking-[0.18em] text-[#ff4655]">ECUST ESPORTS</p>
            <h1 className="mt-5 text-4xl font-black sm:text-6xl">下一场校内赛，正在筹备</h1>
            <Link href="/events" className="mt-8 inline-flex bg-[#ff4655] px-6 py-3 text-sm font-black">查看赛事</Link>
          </div>
        </section>
      )}

      <div className="signal-strip" aria-label="赛事信息导航">
        <Container className="signal-strip__inner">
          {["赛事手册", "选手名单", "队伍名单", "赛程", "对阵图"].map((item, index) => (
            <Fragment key={`${item}-${index}`}>
              {index > 0 && <i />}
              <Link href={current ? `/events/${current.id}?tab=${encodeURIComponent(item)}` : "/events"} className="transition-opacity hover:opacity-75">
                {item}
              </Link>
            </Fragment>
          ))}
        </Container>
      </div>

      <section className="capability-section">
        <Container>
          <div className="section-heading">
            <div>
              <p className="section-kicker"><span /> {journeyKicker}</p>
              <h2>{journeyTitleTop}<br />{journeyTitleBottom}</h2>
            </div>
          </div>

          <div className="capability-grid">
            {config.home.cards.map((capability) => (
              <article key={capability.index} className="capability-card">
                <div className="capability-card__top">
                  <span className="capability-card__index">{capability.index}</span>
                  <span className="capability-card__cross" aria-hidden="true">＋</span>
                </div>
                <p className="capability-card__meta">{capability.meta}</p>
                <h3>{capability.title}</h3>
              </article>
            ))}
          </div>
        </Container>
      </section>

      <GameDirectory />

      {events.length > 1 && (
        <section className="event-section">
          <Container>
            <div className="section-heading section-heading--events">
              <div>
                <p className="section-kicker"><span /> {config.home.historyKicker}</p>
                <h2>{config.home.historyTitle}</h2>
              </div>
              <Link href="/events" className="text-link">
                {config.home.historyLink} <span aria-hidden="true">↗</span>
              </Link>
            </div>

            <div className="event-grid">
              {events.slice(1).map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          </Container>
        </section>
      )}

      <section className="closing-cta">
        <Container className="closing-cta__inner">
          <div>
            <p className="section-kicker section-kicker--light"><span /> {closingKicker}</p>
            <h2>{closingTitle}</h2>
          </div>
          <Button href={closingHref} size="lg">
            {closingCta} <span aria-hidden="true">↗</span>
          </Button>
        </Container>
      </section>
    </div>
  );
}
