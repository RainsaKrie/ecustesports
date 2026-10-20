import { getConfiguredEvents } from "@/lib/configured-events";
import { getSiteConfig } from "@/lib/site-config";
import Container from "@/components/layout/Container";
import EventCard from "@/components/events/EventCard";

/** 赛事列表（2026-10-20 按 v8 基准改版）：Hero → 分区标题 → 双列卡片（玻璃 + 折角）。 */
export default async function EventsPage() {
  const config = await getSiteConfig();
  const events = getConfiguredEvents(config);

  return (
    <Container className="ui-page">
      <header className="ui-hero">
        <p className="ui-eyebrow">{config.eventList.eyebrow}</p>
        <h1>
          {config.eventList.title}
          <em>.</em>
        </h1>
        <p className="ui-sub">{config.eventList.description}</p>
      </header>

      <div className="ui-sec">
        <h2>赛事列表</h2>
        <span>{String(events.length).padStart(2, "0")} 场</span>
      </div>

      {events.length > 0 ? (
        <div className="ui-grid ui-grid-2 mt-4">
          {events.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      ) : (
        <div className="ui-empty mt-4">暂无已发布赛事</div>
      )}
    </Container>
  );
}
