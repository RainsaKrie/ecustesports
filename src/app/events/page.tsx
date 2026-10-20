import { getConfiguredEvents } from "@/lib/configured-events";
import { getSiteConfig } from "@/lib/site-config";
import Container from "@/components/layout/Container";
import EventCard from "@/components/events/EventCard";

export default async function EventsPage() {
  const config = await getSiteConfig();
  const events = getConfiguredEvents(config);

  return (
    <Container className="py-12 sm:py-16">
      <div className="mb-10 max-w-3xl">
        <p className="font-mono text-xs font-black tracking-[0.16em] text-[var(--pub-red)]">{config.eventList.eyebrow}</p>
        <h1 className="mt-3 text-4xl font-black text-[var(--pub-txt)]">{config.eventList.title}</h1>
        <p className="mt-4 leading-7 text-[var(--pub-txt-soft)]">{config.eventList.description}</p>
      </div>
      {events.length > 0 ? (
        <div className="event-grid">
          {events.map((event) => <EventCard key={event.id} event={event} />)}
        </div>
      ) : (
        <div className="border border-[var(--pub-line)] bg-[var(--pub-card)] px-6 py-16 text-center">
          <p className="text-lg font-bold text-[var(--pub-txt)]">暂无已发布赛事</p>
        </div>
      )}
    </Container>
  );
}
