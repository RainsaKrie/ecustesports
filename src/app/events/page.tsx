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
        <p className="font-mono text-xs font-black tracking-[0.16em] text-[#c83242]">{config.eventList.eyebrow}</p>
        <h1 className="mt-3 text-4xl font-black text-slate-950">{config.eventList.title}</h1>
        <p className="mt-4 leading-7 text-slate-600">{config.eventList.description}</p>
      </div>
      {events.length > 0 ? (
        <div className="event-grid">
          {events.map((event) => <EventCard key={event.id} event={event} />)}
        </div>
      ) : (
        <div className="border border-slate-200 bg-white px-6 py-16 text-center">
          <p className="text-lg font-bold text-slate-900">暂无已发布赛事</p>
        </div>
      )}
    </Container>
  );
}
