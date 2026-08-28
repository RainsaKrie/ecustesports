"use client";

import { useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import { participantTokenKey } from "@/lib/scheduling/usePublicRegistration";
import type { EventStage } from "@/lib/scheduling/stage";

function ActionLink({ href, children, emphasis = false }: { href: string; children: React.ReactNode; emphasis?: boolean }) {
  return (
    <Link
      href={href}
      className={`group flex min-h-12 w-full items-center justify-between border px-4 py-3 text-left text-xs font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff4655] focus-visible:ring-offset-2 ${emphasis
        ? "border-[#ff4655] bg-[#ff4655] text-white hover:border-[#d93746] hover:bg-[#d93746]"
        : "border-black/15 bg-[#fffdf8] text-[#171a1f] hover:border-[#ff4655] hover:bg-[#fff1f2] hover:text-[#c83242]"
      }`}
    >
      <span>{children}</span>
      <span className={`ml-4 text-base leading-none transition-transform group-hover:translate-x-1 ${emphasis ? "text-white" : "text-[#ff4655]"}`} aria-hidden>→</span>
    </Link>
  );
}

function subscribeToParticipantStorage(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

export default function ParticipantStageActions({
  eventId,
  stage,
  ctaHref,
  ctaLabel,
  isPreparing,
  isOngoing,
}: {
  eventId: string;
  stage: EventStage;
  ctaHref: string;
  ctaLabel: string;
  isPreparing: boolean;
  isOngoing: boolean;
}) {
  const getParticipantSnapshot = useCallback(
    () => Boolean(localStorage.getItem(participantTokenKey(eventId))),
    [eventId],
  );
  const hasParticipant = useSyncExternalStore(subscribeToParticipantStorage, getParticipantSnapshot, () => false);

  const participantPrimary = !isPreparing && hasParticipant;

  return (
    <>
      {participantPrimary ? (
        <Button href={`/events/${eventId}/manage`} size="lg" className="w-full">进入参赛中心</Button>
      ) : stage === "报名" ? (
        <Button href={ctaHref} size="lg" className="w-full">{ctaLabel}</Button>
      ) : null}
      {!participantPrimary && (
        <div className="grid w-full gap-2">
          {!isPreparing ? (
          <ActionLink href={`/events/${eventId}/manage`} emphasis>参赛中心</ActionLink>
          ) : null}
          {isOngoing && <ActionLink href={`/events/${eventId}/bracket`}>全屏赛事对阵</ActionLink>}
        </div>
      )}
    </>
  );
}
