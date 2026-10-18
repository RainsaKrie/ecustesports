"use client";

import Link from "next/link";
import Button from "@/components/ui/Button";
import { useParticipant } from "@/lib/scheduling/useParticipant";
import type { EventStage } from "@/lib/scheduling/stage";

function ActionLink({ href, children, emphasis = false }: { href: string; children: React.ReactNode; emphasis?: boolean }) {
  return (
    <Link
      href={href}
      className={`group flex min-h-12 w-full items-center justify-between gap-2 border px-3 py-3 text-left text-[0.6875rem] font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff4655] focus-visible:ring-offset-2 ${emphasis
        ? "border-[#ff4655] bg-[#ff4655] text-white hover:border-[#c83242] hover:bg-[#c83242]"
        : "border-black/15 bg-[#fffdf8] text-[#171a1f] hover:border-[#ff4655] hover:bg-[#fff1f2] hover:text-[#c83242]"
      }`}
    >
      <span className="min-w-0 whitespace-nowrap">{children}</span>
      <span className={`shrink-0 text-sm leading-none transition-transform group-hover:translate-x-1 ${emphasis ? "text-white" : "text-[#ff4655]"}`} aria-hidden>→</span>
    </Link>
  );
}

export default function ParticipantStageActions({
  eventId,
  stage,
  isPreparing,
  isOngoing,
}: {
  eventId: string;
  stage: EventStage;
  isPreparing: boolean;
  isOngoing: boolean;
}) {
  const participant = useParticipant(eventId);
  const isConnected = Boolean(participant.data);

  if (participant.loading) {
    return <div className="h-[7.5rem] w-full" aria-hidden />;
  }

  return (
    <>
      {isConnected ? (
        <>
          <Button href={`/events/${eventId}/manage?section=team`} size="lg" className="w-full">
            {participant.data?.team ? "我的队伍" : "创建或加入队伍"}
          </Button>
          <div className="grid w-full grid-cols-2 gap-2">
            <ActionLink href={`/events/${eventId}/manage?section=matches`}>我的比赛</ActionLink>
            <ActionLink href={`/events/${eventId}/manage?section=profile`}>报名信息</ActionLink>
          </div>
        </>
      ) : !isPreparing ? (
        <>
          <Button href={`/events/${eventId}/manage?recover=1`} size="lg" className="w-full">参赛登录</Button>
          <div className="grid w-full gap-2">
            {stage === "报名" && <ActionLink href={`/events/${eventId}/manage?section=team&recover=1`} emphasis>创建或加入队伍</ActionLink>}
            {isOngoing && <ActionLink href={`/events/${eventId}/bracket`}>全屏赛事对阵</ActionLink>}
          </div>
        </>
      ) : null}
    </>
  );
}
