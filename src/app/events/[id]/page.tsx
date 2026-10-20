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
import { notFound } from "next/navigation";
import Link from "next/link";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/domains/identity/admin-session";

interface EventDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; preview?: string }>;
}

/**
 * 赛事详情（2026-10-20 按 v8 基准改版）
 *
 * 改动要点：
 *   1. 页面级 Hero 接管标题 —— 以前标题只在 PublicSchedule 的赛程 tab 里，
 *      页面本身只有一个 24–30px 的 h1，等于"进赛事页没有主视觉"。
 *   2. 去掉按赛事的 coverColor 渐变（v8 只允许一种强调色），状态改 .ui-tag。
 *   3. 新增数字条：参赛队伍 / 赛事场次 / 已完成（真实数据推导，不是手填）。
 *   4. 「当前阶段任务」改成玻璃取景框卡 + 左侧红条说明（v8 的框线语言）。
 */
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

  const totalMatches = schedule.matches.length;
  const doneMatches = schedule.matches.filter((match) => match.status === "已完成").length;

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
    <div className="relative">
      {previewMode && (
        <div className="border-b border-[var(--pub-red)] bg-[var(--pub-card)] px-4 py-3 text-[var(--pub-red)]">
          <Container className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-xs font-bold">负责人预览 · {configured?.visibility === "public" ? "已公开" : "未公开"}</p>
            <Link href={`/admin/events/${id}/settings`} className="border border-[var(--pub-red)] bg-[var(--pub-card)] px-3 py-2 text-xs font-black">返回赛事设置</Link>
          </Container>
        </div>
      )}

      <Container className="ui-page">
        <header className="ui-hero">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`ui-tag${event.status === "ongoing" ? " live" : ""}`}>{statusInfo.label}</span>
            <span className="font-mono text-[11.5px] tracking-[0.14em] text-[var(--pub-txt-mute)]">{event.game} / ECUST</span>
          </div>
          <h1>
            {event.name}
            <em>.</em>
          </h1>
          <p className="ui-sub">{event.description}</p>

          <div className="ui-stats">
            <div className="ui-stat">
              <div className="v">{event.teamCount}</div>
              <div className="k">参赛队伍</div>
            </div>
            <div className="ui-stat">
              <div className="v">{totalMatches}</div>
              <div className="k">赛事场次</div>
            </div>
            <div className="ui-stat hot">
              <div className="v">{doneMatches}</div>
              <div className="k">已完成</div>
            </div>
          </div>
        </header>

        {/* 当前阶段任务：一进页面就知道现在该做什么、卡在哪 */}
        <div className="ui-frame ui-pad mt-6">
          <div className="grid gap-6 lg:grid-cols-[1fr_auto]">
            <div>
              <p className="ui-eyebrow">当前阶段任务 · {stage}</p>
              <h2 className="mt-2 text-[22px] font-black tracking-[-0.01em] text-[var(--pub-txt)]">{stageConfig.title}</h2>
              <p className="ui-note mt-3 text-[13.5px] font-bold leading-6 text-[var(--pub-txt)]">{stageContext}</p>
            </div>
            <div className="flex min-w-0 flex-col justify-center gap-3 lg:w-64">
              <ParticipantStageActions
                eventId={event.id}
                stage={stage}
                isPreparing={isPreparing}
                isOngoing={event.status === "ongoing"}
              />
            </div>
          </div>
        </div>

        {/* 群公告放在阶段卡之后、标签页之前：看完「该做什么」，紧接着「去哪收通知」 */}
        {event.eventQqGroup && (
          <div className="mt-4">
            <GroupNotice group={event.eventQqGroup} />
          </div>
        )}

        {/* 阶段进度：一进赛事页就知道打到第几阶段（与赛程页同一组件、同一数据推导） */}
        <StageCards className="mt-10" items={stageCards.items} currentIndex={stageCards.currentIndex} />

        <div className="mt-8">
          <EventDetailTabs key={`${stage}-${tab ?? "default"}`} eventId={id} stage={stage} event={event} initialTab={tab} preview={previewMode} />
        </div>
      </Container>
    </div>
  );
}
