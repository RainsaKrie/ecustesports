import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import AdminSidebar from "@/components/admin/AdminSidebar";
import { getSiteConfig } from "@/lib/site-config";
import { getEventStage } from "@/lib/scheduling/stage";
import { getOperationsModules, type ModuleWithState } from "@/lib/operations-data";
import { readEventData } from "@/lib/data-store";
import { emptySchedule, type ScheduleState } from "@/lib/scheduling/schedule-data";
import { initialRegistration, type RegistrationState } from "@/lib/scheduling/registration-data";
import type { EventStage } from "@/lib/scheduling/stage";

export default async function EventWorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const config = await getSiteConfig();
  const event = config.events.find((item) => item.id === id);
  if (!event) notFound();

  const [schedule, registration, format] = await Promise.all([
    readEventData<ScheduleState>(id, "schedule", emptySchedule()),
    readEventData<RegistrationState>(id, "registration", initialRegistration()),
    readEventData<{ seedPots: unknown[] }>(id, "format", { seedPots: [] }),
  ]);
  const stage: EventStage = getEventStage({
    status: event.status,
    registrationStart: event.registrationStart,
    registrationEnd: event.registrationEnd,
    hasSchedule: schedule.matches.length > 0,
  });
  const modules: ModuleWithState[] = getOperationsModules(stage, {
    teamCount: registration.teams.length,
    frozen: registration.frozen,
    matchCount: schedule.matches.length,
    hasFormat: format.seedPots.length > 0,
    pendingNotifications: schedule.notifications.filter((item) => item.status !== "已发送").length,
  });

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col lg:flex-row">
      <AdminSidebar event={event} stage={stage} modules={modules} />
      <main className="min-w-0 flex-1 admin-content">
        <div className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
