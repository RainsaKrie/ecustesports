import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import AdminSidebar from "@/components/admin/AdminSidebar";
import { getSiteConfig } from "@/lib/site-config";
import { getEventStage } from "@/lib/domains/schedule/stage";
import { getOperationsModules, getStageGuidance, type ModuleWithState } from "@/lib/operations-data";
import { readEventData } from "@/lib/data-store";
import { emptySchedule, type ScheduleState } from "@/lib/domains/schedule/schedule-data";
import { initialRegistration, normalizeRegistrationState, type RegistrationState } from "@/lib/domains/registration/data";
import type { EventStage } from "@/lib/domains/schedule/stage";
import { publicationChecklist } from "@/lib/domains/content/publication-check";
import { resolveSupportedFormat } from "@/lib/domains/schedule/format-support";
import { resolveEventProgress } from "@/lib/domains/schedule/event-progress";
import { scheduleModeOf } from "@/lib/domains/schedule/schedule-mode";
import { postEventPublicContentIssues } from "@/lib/domains/content/status";

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
    frozen: registrationState.teamRegistrationClosed,
    matchCount: schedule.matches.length,
    hasFormat,
  });
  // 「赛事是不是真的打完了」由这里统一算（与服务端结束赛事的校验共用同一份判断）：
  // 现有比赛全完成 **且** 赛制每个阶段都已经有比赛。只看场次数会把「录完入围赛」误判成「赛事结束」。
  const progress = resolveEventProgress(event.stageConfigs ?? [], schedule.matches);
  const guidance = getStageGuidance(stage, {
    eventId: event.id,
    visibility: event.visibility,
    publishIssues: publicationChecklist(event).filter((item) => !item.ok).map((item) => item.detail),
    activeTeamCount: activeTeams.length,
    confirmedTeamCount: confirmedTeams.length,
    requiredTeamCount,
    pendingReviewCount: activePlayers.filter((player) => player.reviewStatus === "需修改" || player.reviewStatus === "已拒绝").length,
    hasFormat,
    matchCount: schedule.matches.length,
    unscheduledMatchCount: schedule.matches.filter((match) => match.status === "待排期").length,
    completedMatchCount: schedule.matches.filter((match) => match.status === "已完成").length,
    scheduleMode: scheduleModeOf(event),
    stagesNotStarted: progress.stagesNotStarted,
    raceFinished: progress.finished,
    pendingRescheduleCount: schedule.requests.filter((request) => request.status === "待审批").length,
    publicContentIssues: postEventPublicContentIssues(event, config.brand.footerStatus),
  });

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col lg:flex-row">
      <AdminSidebar event={event} stage={stage} modules={modules} guidance={guidance} />
      <main className="min-w-0 flex-1 admin-content">
        {/* 后台用 1500，公开面用 1360 —— **有意不一致**：后台是数据表与多列表单，需要更宽；
        公开面是阅读与比赛行，1360 已够。改宽度时不要顺手把这两处统一。 */}
        <div className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
