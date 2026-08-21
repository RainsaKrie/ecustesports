"use client";

import { useCallback, useEffect, useState } from "react";

export interface PublicRegistrationSummary {
  playerCount: number;
  teamCount: number;
  playerRegistrationClosed: boolean;
  teamRegistrationClosed: boolean;
}

const EMPTY: PublicRegistrationSummary = {
  playerCount: 0,
  teamCount: 0,
  playerRegistrationClosed: false,
  teamRegistrationClosed: false,
};

export function participantTokenKey(eventId: string): string {
  return `participant-token:${eventId}`;
}

export function usePublicRegistration(eventId: string) {
  const [state, setState] = useState<PublicRegistrationSummary>(EMPTY);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/public/registration?eventId=${encodeURIComponent(eventId)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("参赛信息加载失败");
    setState(await response.json() as PublicRegistrationSummary);
  }, [eventId]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/public/registration?eventId=${encodeURIComponent(eventId)}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("参赛信息加载失败")))
      .then((result: PublicRegistrationSummary) => {
        if (!cancelled) setState(result);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [eventId]);

  return { state, loading, refresh };
}
