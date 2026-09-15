import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import AdminSidebar from "@/components/admin/AdminSidebar";
import { getSiteConfig } from "@/lib/site-config";
import { getEventStage } from "@/lib/scheduling/stage";
import { getOperationsModules, getStageGuidance, type ModuleWithState } from "@/lib/operations-data";
import { readEventData } from "@/lib/data-store";
import { emptySchedule, type ScheduleState } from "@/lib/scheduling/schedule-data";
import { initialRegistration, normalizeRegistrationState, type RegistrationState } from "@/lib/scheduling/registration-data";
import type { EventStage } from "@/lib/scheduling/stage";
import { publicationChecklist } from "@/lib/publication-check";
import { resolveSupportedFormat } from "@/lib/scheduling/format-support";
import { postEventPublicContentIssues } from "@/lib/site-content-status";

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
    readEventData<{ seedPots?: unknown[]; drawOrder?: unknown[] }>(id, "format", { seedPots: [], drawOrder: [] }),
  ]);
  const registrationState = normalizeRegistrationState(registration);
  const activePlayers = registrationState.players.filter((player) => player.status !== "已退赛" && player.reviewStatus !== "已拒绝");
  const activeTeams = registrationState.teams.filter((team) => team.status !== "已退赛");
  const confirmedTeams = activeTeams.filter((team) => team.status === "已冻结");
  const hasFormat = (format.seedPots?.length ?? 0) > 0 || (format.drawOrder?.length ?? 0) > 0;
  const requiredTeamCount = resolveSupportedFormat(event.stageConfigs ?? []).requiredTeams || event.teamCount;
  const stage: EventStage = getEventStage({
    status: event.status,
    registrationStart: event.registrationStart,
    registrationEnd: event.registrationEnd,
    hasSchedule: schedule.matches.length > 0,
  });
  const modules: ModuleWithState[] = getOperationsModules(stage, {
    teamCount: activeTeams.length,
    frozen: registrationState.frozen,
    matchCount: schedule.matches.length,
    hasFormat,
  });
  const guidance = getStageGuidance(stage, {
    eventId: event.id,
    visibility: event.visibility,
    publishIssues: publicationChecklist(event).filter((item) => !item.ok).map((item) => item.detail),
    activeTeamCount: activeTeams.length,
    confirmedTeamCount: confirmedTeams.length,
    requiredTeamCount,
    pendingReviewCount: activePlayers.filter((player) => player.reviewStatus === "待审核" || player.reviewStatus === "需修改").length,
    hasFormat,
    matchCount: schedule.matches.length,
    unscheduledMatchCount: schedule.matches.filter((match) => match.status === "待排期").length,
    completedMatchCount: schedule.matches.filter((match) => match.status === "已完成").length,
    pendingRescheduleCount: schedule.requests.filter((request) => request.status === "待审批").length,
    publicContentIssues: postEventPublicContentIssues(event, config.brand.footerStatus),
  });

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col lg:flex-row">
      <AdminSidebar event={event} stage={stage} modules={modules} guidance={guidance} />
      <main className="min-w-0 flex-1 admin-content">
        <div className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
