import { getConfiguredEvents, toConfiguredEvent } from "@/lib/configured-events";
import { getEvent, getSiteConfig } from "@/lib/site-config";
import { getStatusInfo } from "@/lib/utils";
import { getEventStage, STAGE_CONFIGS } from "@/lib/domains/schedule/stage";
import { readEventData } from "@/lib/data-store";
import { emptySchedule, type ScheduleState } from "@/lib/domains/schedule/schedule-data";
import EventDetailTabs from "@/components/events/EventDetailTabs";
import StageCards, { stageCardsFromMatches } from "@/components/events/StageCards";
import GroupNotice from "@/components/events/GroupNotice";
import ParticipantStageActions from "@/components/events/ParticipantStageActions";
import Container from "@/components/layout/Container";
import Badge from "@/components/ui/Badge";
import { notFound } from "next/navigation";
import Link from "next/link";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/domains/identity/admin-session";

interface EventDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; preview?: string }>;
}

export default async function EventDetailPage({ params, searchParams }: EventDetailPageProps) {
  const { id } = await params;
  const { tab, preview } = await searchParams;
  const config = await getSiteConfig();
  const configured = config.events.find((item) => item.id === id);
  const publicEvent = getConfiguredEvents(config).find((item) => item.id === id);
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const previewMode = preview === "1" && Boolean(configured) && verifySessionToken(token);
  const event = publicEvent ?? (previewMode && configured ? toConfiguredEvent(configured) : undefined);
  if (!event) notFound();
  const cfgEvent = getEvent(config, id);
  const statusInfo = getStatusInfo(event.status);

  // 阶段判定（自动 + 手动覆盖）
  const schedule = await readEventData<ScheduleState>(cfgEvent.id, "schedule", emptySchedule());
  const stageCards = stageCardsFromMatches(schedule.matches);
  const hasSchedule = Array.isArray(schedule.matches) && schedule.matches.length > 0;
  const stage = getEventStage({
    status: event.status,
    registrationStart: cfgEvent.registrationStart,
    registrationEnd: cfgEvent.registrationEnd,
    hasSchedule,
  });
  const stageConfig = STAGE_CONFIGS[stage];

  const nextMatch = [...schedule.matches]
    .filter((match) => match.status !== "已完成" && Boolean(match.startTime))
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())[0];

  const finalMatch = [...schedule.matches]
    .reverse()
    .find((match) => match.status === "已完成" && ["总决赛", "决赛"].includes(match.round ?? ""));
  const finalScoreA = finalMatch?.gameResults?.filter((game) => game.teamAScore > game.teamBScore).length ?? 0;
  const finalScoreB = finalMatch?.gameResults?.filter((game) => game.teamBScore > game.teamAScore).length ?? 0;

  const formatMatchTime = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "时间待确认";
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  };

  const stageContext = (() => {
    if (stage === "报名") return event.registrationLabel || "报名时间待公布";
    if (stage === "比赛" && nextMatch) {
      return `${nextMatch.phase} · ${nextMatch.teamAName} vs ${nextMatch.teamBName} · ${formatMatchTime(nextMatch.startTime)}`;
    }
    if (stage === "赛后" && finalMatch?.winnerTeamId) {
      const winnerIsA = finalMatch.winnerTeamId === finalMatch.teamAId;
      const champion = winnerIsA ? finalMatch.teamAName : finalMatch.teamBName;
      const runnerUp = winnerIsA ? finalMatch.teamBName : finalMatch.teamAName;
      const championScore = winnerIsA ? finalScoreA : finalScoreB;
      const runnerUpScore = winnerIsA ? finalScoreB : finalScoreA;
      return `${champion}夺得冠军 · 总决赛 ${champion} ${championScore}:${runnerUpScore} ${runnerUp}`;
    }
    if (stage === "赛后") return event.stageSummary || "赛事结果已公布";
    return [event.dateLabel, event.stageSummary].filter(Boolean).join(" · ") || "赛事信息待公布";
  })();

  const isPreparing = event.status === "draft";
  return (
    <div className="pub-dark pub-poster relative overflow-hidden">
      {previewMode && (
        <div className="border-b border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-[#9a4808]">
          <Container className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-bold">负责人预览 · {configured?.visibility === "public" ? "已公开" : "未公开"}</p>
            <Link href={`/admin/events/${id}/settings`} className="border border-[#fde68a] bg-[var(--pub-card)] px-3 py-2 text-xs font-black">返回赛事设置</Link>
          </Container>
        </div>
      )}
      {/* Event Header */}
      <div
        className="px-4 sm:px-6 lg:px-8 pt-8 pb-6"
        style={{ background: `linear-gradient(135deg, ${event.coverColor}22, ${event.coverColor}05)` }}
      >
        <Container>
          <div>
            <div>
              <div className="flex items-center gap-3 mb-2">
                <Badge className={statusInfo.color}>{statusInfo.label}</Badge>
                <span className="text-sm font-bold text-[var(--pub-txt-soft)]">{event.game}</span>
              </div>
              <h1 className="text-2xl font-bold text-[var(--pub-txt)] sm:text-3xl">{event.name}</h1>
              <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-[var(--pub-txt)]">{event.description}</p>
            </div>

            <div className="mt-7 border border-[var(--pub-line)] bg-[var(--pub-card)] shadow-[0_16px_45px_rgba(15,25,35,0.08)]">
              <div className="grid lg:grid-cols-[1fr_auto]">
                <div className="border-b border-[var(--pub-line)] p-5 sm:p-7 lg:border-b-0 lg:border-r">
                  <p className="font-mono text-[11px] font-black tracking-[0.18em] text-[#ff4655]">当前阶段任务 · {stage}</p>
                  <h2 className="mt-3 text-xl font-black text-[var(--pub-txt)] sm:text-2xl">{stageConfig.title}</h2>
                  <div className="mt-5 border-l-2 border-[#ff4655] bg-white/[0.06] px-4 py-3">
                    <p className="text-sm font-bold leading-6 text-[var(--pub-txt)]">{stageContext}</p>
                  </div>
                </div>

                <div className="flex min-w-0 flex-col justify-center gap-4 p-5 sm:p-7 lg:w-72">
                  <ParticipantStageActions
                    eventId={event.id}
                    stage={stage}
                    isPreparing={isPreparing}
                    isOngoing={event.status === "ongoing"}
                  />
                </div>
              </div>
            </div>

            {/* 群公告放在阶段卡之后、标签页之前：
                玩家看完「当前该做什么」，紧接着看到「去哪接收后续通知」。
                非报名期也同样显示——赛后仍要通知领奖等事宜。 */}
            {event.eventQqGroup && (
              <div className="mt-5">
                <GroupNotice group={event.eventQqGroup} />
              </div>
            )}
          </div>
        </Container>
      </div>

      {/* Tabs / Content */}
      <Container className="py-8">
        {/* 阶段进度：一进赛事页就知道打到第几阶段（与赛程页顶部同一组件、同一数据推导） */}
        <StageCards className="mb-6" items={stageCards.items} currentIndex={stageCards.currentIndex} />
        <EventDetailTabs key={`${stage}-${tab ?? "default"}`} eventId={id} stage={stage} event={event} initialTab={tab} preview={previewMode} />
      </Container>
    </div>
  );
}
