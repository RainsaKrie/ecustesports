// =====================
// 赛制与抽签状态管理（读冻结队伍 → 分档 → 抽签 → 对阵）
// =====================

"use client";

import { useCallback, useEffect, useState } from "react";
import { useRegistration } from "./useRegistration";
import {
  buildSeedPots,
  drawGroups,
  generateMatchups,
  type SeedPot,
  type Group,
  type Matchup,
} from "./format-data";

export interface FormatState {
  seedPots: SeedPot[];
  groups: Group[];
  matchups: Matchup[];
}

const EMPTY: FormatState = { seedPots: [], groups: [], matchups: [] };

export function useFormat(eventId?: string) {
  const { state: regState } = useRegistration(eventId);

  const [state, setState] = useState<FormatState>(EMPTY);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/data/format${eventId ? `?eventId=${encodeURIComponent(eventId)}` : ""}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setState(data as FormatState);
      })
      .catch(() => {
        // 用默认值
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  useEffect(() => {
    if (!loaded) return;
    fetch(`/api/data/format${eventId ? `?eventId=${encodeURIComponent(eventId)}` : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).catch(() => {
      // 保存失败不阻断交互
    });
  }, [state, loaded, eventId]);

  /** 从冻结队伍生成种子分档；冻结队伍数不为 16 时不生成，返回 null */
  const seed = useCallback(() => {
    const frozenTeams = regState.teams.filter((t) => t.status === "已冻结");
    if (frozenTeams.length !== 16) return null;
    const pots = buildSeedPots(frozenTeams, regState.players);
    setState({ seedPots: pots, groups: [], matchups: [] });
    return pots;
  }, [regState.teams, regState.players]);

  /** 分组抽签 + 生成首轮对阵 */
  const draw = useCallback(() => {
    setState((s) => {
      if (s.seedPots.length === 0) return s;
      const groups = drawGroups(s.seedPots);
      const matchups = generateMatchups(groups, s.seedPots);
      return { ...s, groups, matchups };
    });
  }, []);

  const reset = useCallback(() => setState(EMPTY), []);

  return { state, seed, draw, reset };
}
