"use client";

import { useCallback, useEffect, useState } from "react";
import type { RegistrationPlayer, RegistrationTeam, TeamRequest } from "./registration-data";
import type { RescheduleRecord, ScheduleMatch } from "./schedule-data";
import type { BOType, SchedulingConfig } from "./rule-engine";
import { participantTokenKey } from "./usePublicRegistration";

export interface ParticipantTeam extends RegistrationTeam {
  members: Array<Pick<RegistrationPlayer, "id" | "gameId" | "rank" | "role">>;
}

export interface ParticipantTeamRequest extends TeamRequest {
  canResolve: boolean;
  direction: "incoming" | "outgoing";
  teamName: string;
  playerGameId: string;
}

export interface ParticipantScheduleRequest extends RescheduleRecord {
  teamAName: string;
  teamBName: string;
  boType: BOType;
  phase: string;
  canConfirm: boolean;
  initiatedByMyTeam: boolean;
}

export interface ParticipantView {
  player: RegistrationPlayer;
  team?: ParticipantTeam;
  isCaptain: boolean;
  requests: ParticipantTeamRequest[];
  nextMatch?: ScheduleMatch;
  scheduleRequests: ParticipantScheduleRequest[];
  scheduleConfig: SchedulingConfig;
  scheduleConfigConfirmed: boolean;
  scheduleVersion: number;
  teams: Array<{
    id: string;
    name: string;
    status: RegistrationTeam["status"];
    starterCount: number;
    substituteCount: number;
    coachCount: number;
  }>;
  teamRegistrationClosed: boolean;
}

export function useParticipant(eventId: string) {
  const [token, setToken] = useState("");
  const [data, setData] = useState<ParticipantView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (credential: string) => {
    const response = await fetch(`/api/public/participant?eventId=${encodeURIComponent(eventId)}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${credential}` },
    });
    const result = await response.json() as ParticipantView & { message?: string };
    if (!response.ok) {
      if (response.status === 401) {
        localStorage.removeItem(participantTokenKey(eventId));
        setToken("");
      }
      throw new Error(result.message ?? "参赛管理码无效。");
    }
    setData(result);
    return result;
  }, [eventId]);

  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      const stored = localStorage.getItem(participantTokenKey(eventId)) ?? "";
      await Promise.resolve();
      if (cancelled) return;
      setToken(stored);
      if (!stored) {
        setLoading(false);
        return;
      }
      load(stored).catch((reason) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : "参赛信息加载失败。");
        setData(null);
      }).finally(() => {
        if (!cancelled) setLoading(false);
      });
    }
    void hydrate();
    return () => { cancelled = true; };
  }, [eventId, load]);

  const connect = useCallback(async (credential: string) => {
    const value = credential.trim();
    setLoading(true);
    setError("");
    try {
      const result = await load(value);
      localStorage.setItem(participantTokenKey(eventId), value);
      setToken(value);
      return result;
    } finally {
      setLoading(false);
    }
  }, [eventId, load]);

  const disconnect = useCallback(() => {
    localStorage.removeItem(participantTokenKey(eventId));
    setToken("");
    setData(null);
    setError("");
  }, [eventId]);

  const mutate = useCallback(async (url: string, method: "POST" | "PATCH", body: Record<string, unknown>) => {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...body, eventId }),
    });
    const result = await response.json() as { message?: string };
    if (!response.ok) throw new Error(result.message ?? "操作失败，请稍后重试。");
    await load(token);
    return result;
  }, [eventId, load, token]);

  return {
    token,
    data,
    loading,
    error,
    setError,
    connect,
    disconnect,
    refresh: () => load(token),
    saveProfile: (profile: Record<string, unknown>) => mutate("/api/public/participant", "PATCH", profile),
    createTeam: (name: string) => mutate("/api/public/team", "POST", { name }),
    sendTeamRequest: (input: Record<string, unknown>) => mutate("/api/public/team/request", "POST", input),
    resolveTeamRequest: (requestId: string, decision: "accept" | "reject") => mutate("/api/public/team/request", "PATCH", { requestId, decision }),
    createScheduleRequest: (matchId: string, newStartTime: string, reason: string) => mutate("/api/public/schedule/request", "POST", { matchId, newStartTime, reason }),
    resolveScheduleRequest: (requestId: string, decision: "accept" | "reject") => mutate("/api/public/schedule/request", "PATCH", { requestId, decision }),
  };
}
