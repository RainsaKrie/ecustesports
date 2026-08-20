import Link from "next/link";
import { Fragment } from "react";
import { getConfiguredEvents } from "@/lib/configured-events";
import { getEvent, getSiteConfig } from "@/lib/site-config";
import { getEventStage } from "@/lib/scheduling/stage";
import { readEventData } from "@/lib/data-store";
import { initialSchedule, type ScheduleState } from "@/lib/scheduling/schedule-data";
import EventsCarousel from "@/components/events/EventsCarousel";
import EventCard from "@/components/events/EventCard";
import Container from "@/components/layout/Container";
import Button from "@/components/ui/Button";

export default async function Home() {
  const config = await getSiteConfig();
  const events = getConfiguredEvents(config);
  const current = events[0];
  const cfgEvent = getEvent(config);
  // 阶段判定（自动 + 手动覆盖）
  const schedule = await readEventData<ScheduleState>(cfgEvent.id, "schedule", initialSchedule());
  const hasSchedule = Array.isArray(schedule.matches) && schedule.matches.length > 0;
  const stage = getEventStage({
    status: current.status,
    registrationStart: cfgEvent.registrationStart,
    registrationEnd: cfgEvent.registrationEnd,
    hasSchedule,
  });

  return (
    <div className="home-shell">
      {/* 主视觉：当前赛事海报作底板（替代原 hero-stage + live-panel）*/}
      <EventsCarousel events={events} height="min-h-[80vh]" stage={stage} />

      <div className="signal-strip" aria-label="赛事信息导航">
        <Container className="signal-strip__inner">
          {["赛事手册", "选手名单", "队伍名单", "赛程", "对阵图"].map((item, index) => (
            <Fragment key={`${item}-${index}`}>
              {index > 0 && <i />}
              <Link href={`/events/${current.id}?tab=${encodeURIComponent(item)}`} className="transition-opacity hover:opacity-75">
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
              <p className="section-kicker"><span /> {config.home.journeyKicker}</p>
              <h2>{config.home.journeyTitleTop}<br />{config.home.journeyTitleBottom}</h2>
            </div>
            <p className="section-heading__aside">{config.home.journeyAside}</p>
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
                <p>{capability.description}</p>
              </article>
            ))}
          </div>
        </Container>
      </section>

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
            <p className="section-kicker section-kicker--light"><span /> {config.home.closingKicker}</p>
            <h2>{config.home.closingTitle}</h2>
          </div>
          <Button href={`/events/${cfgEvent.id}`} size="lg">
            {config.home.closingCta} <span aria-hidden="true">↗</span>
          </Button>
        </Container>
      </section>
    </div>
  );
}