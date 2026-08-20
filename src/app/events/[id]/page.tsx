import { getConfiguredEvents } from "@/lib/configured-events";
import { getEvent, getSiteConfig } from "@/lib/site-config";
import { getStatusInfo } from "@/lib/utils";
import { getEventStage } from "@/lib/scheduling/stage";
import { readEventData } from "@/lib/data-store";
import { initialSchedule, type ScheduleState } from "@/lib/scheduling/schedule-data";
import EventDetailTabs from "@/components/events/EventDetailTabs";
import Container from "@/components/layout/Container";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { notFound } from "next/navigation";

interface EventDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}

export default async function EventDetailPage({ params, searchParams }: EventDetailPageProps) {
  const { id } = await params;
  const { tab } = await searchParams;
  const config = await getSiteConfig();
  const events = getConfiguredEvents(config);
  const event = events.find((item) => item.id === id);
  if (!event) notFound();
  const cfgEvent = getEvent(config, id);
  const statusInfo = getStatusInfo(event.status);

  // 阶段判定（自动 + 手动覆盖）
  const schedule = await readEventData<ScheduleState>(cfgEvent.id, "schedule", initialSchedule());
  const hasSchedule = Array.isArray(schedule.matches) && schedule.matches.length > 0;
  const stage = getEventStage({
    status: event.status,
    registrationStart: cfgEvent.registrationStart,
    registrationEnd: cfgEvent.registrationEnd,
    hasSchedule,
  });

  const isPreparing = event.status === "draft";
  const isArchive = event.status === "archived";
  const hasPublishedCompetitionData = !isPreparing && !isArchive;

  return (
    <div>
      {/* Event Header */}
      <div
        className="px-4 sm:px-6 lg:px-8 pt-8 pb-6"
        style={{ background: `linear-gradient(135deg, ${event.coverColor}22, ${event.coverColor}05)` }}
      >
        <Container>
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <Badge className={statusInfo.color}>{statusInfo.label}</Badge>
                <span className="text-sm text-gray-500">{event.game}</span>
              </div>
              <h1 className="text-3xl font-bold text-gray-900">{event.name}</h1>
              <p className="text-gray-600 mt-2 max-w-2xl">{event.description}</p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              {event.status === "registration" && (
                <Button href={`/events/${event.id}/register`} size="lg">
                  立即报名
                </Button>
              )}
              {isPreparing && (
                <Button href={`/events/${event.id}`} size="lg">
                  查看参赛须知
                </Button>
              )}
              {event.status === "ongoing" && (
                <Button href={`/events/${event.id}/bracket`} variant="outline" size="lg">
                  全屏对阵图
                </Button>
              )}
              {hasPublishedCompetitionData && (
                <Button href={`/events/${event.id}/report`} variant="ghost" size="lg">
                  赛事回顾
                </Button>
              )}
            </div>
          </div>
        </Container>
      </div>

      {/* Tabs / Content */}
      <Container className="py-8">
        <EventDetailTabs eventId={id} stage={stage} initialTab={tab} />
      </Container>
    </div>
  );
}
