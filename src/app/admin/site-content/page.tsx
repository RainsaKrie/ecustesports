import Link from "next/link";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import SiteContentWorkspace from "@/components/admin/SiteContentWorkspace";
import { EmptyState } from "@/components/admin/ui";
import { readEventData } from "@/lib/data-store";
import { emptySchedule, type ScheduleState } from "@/lib/domains/schedule/schedule-data";
import { getSiteConfig } from "@/lib/site-config";
import { postEventPublicContentIssues } from "@/lib/domains/content/status";

interface SiteContentPageProps {
  searchParams: Promise<{ eventId?: string }>;
}

export default async function SiteContentPage({ searchParams }: SiteContentPageProps) {
  const { eventId } = await searchParams;
  const config = await getSiteConfig();
  const event = config.events.find((item) => item.id === eventId)
    ?? config.events.find((item) => item.id === config.currentEventId)
    ?? config.events[0];
  const schedule = event
    ? await readEventData<ScheduleState>(event.id, "schedule", emptySchedule())
    : emptySchedule();
  const finalMatch = [...schedule.matches]
    .reverse()
    .find((match) => match.status === "已完成" && ["总决赛", "决赛"].includes(match.round ?? ""));
  const finalScoreA = finalMatch?.gameResults?.filter((game) => game.teamAScore > game.teamBScore).length ?? 0;
  const finalScoreB = finalMatch?.gameResults?.filter((game) => game.teamBScore > game.teamAScore).length ?? 0;
  const winnerIsA = finalMatch?.winnerTeamId === finalMatch?.teamAId;
  const champion = finalMatch?.winnerTeamId
    ? winnerIsA ? finalMatch.teamAName : finalMatch.teamBName
    : "本届冠军";
  const runnerUp = finalMatch?.winnerTeamId
    ? winnerIsA ? finalMatch.teamBName : finalMatch.teamAName
    : "亚军队伍";
  const championScore = winnerIsA ? finalScoreA : finalScoreB;
  const runnerUpScore = winnerIsA ? finalScoreB : finalScoreA;

  if (!event) {
    return (
      <div className="mx-auto max-w-[1100px] p-4 sm:p-6 lg:p-8">
        <AdminPageHeader eyebrow="公开内容" title="官网内容" />
        <EmptyState
          title="暂无可编辑的赛事"
          description="官网的赛后内容挂在具体赛事下面，所以得先有一个赛事。建好之后回到这里，就能编辑简介、冠军文案和页脚状态了。"
          action={<Link href="/admin/events/new" className="adm-btn adm-btn--primary adm-btn--md">新建赛事</Link>}
        />
      </div>
    );
  }

  const suggestedDescription = finalMatch?.winnerTeamId
    ? `${champion}在总决赛以 ${championScore}:${runnerUpScore} 战胜${runnerUp}，夺得${event.name}冠军。完整赛果与赛事对阵已公布。`
    : `${event.name}已结束，最终赛果与赛事对阵已公布。`;
  const suggestedFooterStatus = finalMatch?.winnerTeamId
    ? `${event.name}已结束 · 冠军：${champion}`
    : `${event.name}已结束`;

  return (
    <div className="mx-auto max-w-[1100px] p-4 sm:p-6 lg:p-8">
      <AdminPageHeader eyebrow="公开内容" title="官网内容" status={event.name} />
      <SiteContentWorkspace
        eventId={event.id}
        eventName={event.name}
        initialDescription={event.description}
        initialFooterStatus={config.brand.footerStatus}
        suggestedDescription={suggestedDescription}
        suggestedFooterStatus={suggestedFooterStatus}
        issues={postEventPublicContentIssues(event, config.brand.footerStatus)}
      />
    </div>
  );
}
