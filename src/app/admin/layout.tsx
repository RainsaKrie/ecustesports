import { ReactNode } from "react";
import AdminSidebar from "@/components/admin/AdminSidebar";
import { getEvent, getSiteConfig } from "@/lib/site-config";
import { getEventStage } from "@/lib/scheduling/stage";
import { getOperationsModules, type ModuleWithState } from "@/lib/operations-data";
import { readEventData } from "@/lib/data-store";
import { initialSchedule, type ScheduleState } from "@/lib/scheduling/schedule-data";
import { initialRegistration, type RegistrationState } from "@/lib/scheduling/registration-data";
import type { EventStage } from "@/lib/scheduling/stage";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const config = await getSiteConfig();
  const event = getEvent(config);

  // 计算当前阶段与模块状态（供侧边栏生命周期条 + 状态徽标）
  const schedule = await readEventData<ScheduleState>(event.id, "schedule", initialSchedule());
  const registration = await readEventData<RegistrationState>(event.id, "registration", initialRegistration());
  const format = await readEventData<{ seedPots: unknown[] }>(event.id, "format", { seedPots: [] });
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
    pendingNotifications: schedule.notifications.filter((n) => n.status !== "已发送").length,
  });

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[#f3f0e9]">
      <div className="flex flex-col lg:flex-row">
        <AdminSidebar event={event} stage={stage} modules={modules} />
        <div className="min-w-0 flex-1 admin-content">
          <div className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">{children}</div>
        </div>
      </div>
    </div>
  );
}
