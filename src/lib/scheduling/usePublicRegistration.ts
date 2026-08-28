"use client";

import { useCallback, useEffect, useState } from "react";

export interface PublicRegistrationSummary {
  playerCount: number;
  teamCount: number;
  players: Array<{
    id: string;
    gameId: string;
    rank: string;
    teamName?: string;
    role?: "首发" | "替补" | "教练";
    status: "已入队" | "待组队";
  }>;
  teams: Array<{
    id: string;
    name: string;
    status: "报名中" | "已冻结";
    starterCount: number;
    members: Array<{ gameId: string; role: "首发" | "替补" | "教练" }>;
  }>;
  playerRegistrationClosed: boolean;
  teamRegistrationClosed: boolean;
}

const EMPTY: PublicRegistrationSummary = {
  playerCount: 0,
  teamCount: 0,
  players: [],
  teams: [],
  playerRegistrationClosed: false,
  teamRegistrationClosed: false,
};

export function participantTokenKey(eventId: string): string {
  return `participant-token:${eventId}`;
}

function endpoint(eventId: string, preview: boolean) {
  return `${preview ? "/api/admin/registration" : "/api/public/registration"}?eventId=${encodeURIComponent(eventId)}`;
}

function summarize(value: unknown, preview: boolean): PublicRegistrationSummary {
  if (!preview) return value as PublicRegistrationSummary;
  const source = value as {
    state?: {
      players?: Array<{ id: string; gameId: string; rank: string; teamId?: string; role?: "首发" | "替补" | "教练"; status?: string }>;
      teams?: Array<{ id: string; name: string; status?: string; memberIds: string[] }>;
      playerRegistrationClosed?: boolean;
      teamRegistrationClosed?: boolean;
    };
  };
  const state = source.state ?? {};
  const players = state.players?.filter((player) => player.status !== "已退赛") ?? [];
  const teams = state.teams?.filter((team) => team.status !== "已退赛") ?? [];
  const playerById = new Map(players.map((player) => [player.id, player]));
  const teamById = new Map(teams.map((team) => [team.id, team]));
  return {
    playerCount: players.length,
    teamCount: teams.length,
    players: players.map((player) => ({
      id: player.id,
      gameId: player.gameId,
      rank: player.rank,
      teamName: player.teamId ? teamById.get(player.teamId)?.name : undefined,
      role: player.role,
      status: player.teamId ? "已入队" : "待组队",
    })),
    teams: teams.map((team) => {
      const members = team.memberIds.map((id) => playerById.get(id)).filter((player): player is NonNullable<typeof player> => Boolean(player));
      return {
        id: team.id,
        name: team.name,
        status: team.status === "已冻结" ? "已冻结" : "报名中",
        starterCount: members.filter((player) => player.role === "首发").length,
        members: members.map((player) => ({ gameId: player.gameId, role: player.role ?? "首发" })),
      };
    }),
    playerRegistrationClosed: state.playerRegistrationClosed === true,
    teamRegistrationClosed: state.teamRegistrationClosed === true,
  };
}

export function usePublicRegistration(eventId: string, preview = false) {
  const [state, setState] = useState<PublicRegistrationSummary>(EMPTY);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const response = await fetch(endpoint(eventId, preview), { cache: "no-store" });
    if (!response.ok) throw new Error("参赛信息加载失败");
    setState(summarize(await response.json(), preview));
  }, [eventId, preview]);

  useEffect(() => {
    let cancelled = false;
    fetch(endpoint(eventId, preview), { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("参赛信息加载失败")))
      .then((result: unknown) => {
        if (!cancelled) setState(summarize(result, preview));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [eventId, preview]);

  return { state, loading, refresh };
}
