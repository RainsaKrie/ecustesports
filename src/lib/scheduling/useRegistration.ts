// =====================
// 报名与队伍状态管理（报名 → 组队 → 审核 → 冻结）
// =====================

"use client";

import { useCallback, useEffect, useState } from "react";
import type { RegistrationState, RegistrationPlayer, RegistrationTeam } from "./registration-data";
import { initialRegistration } from "./registration-data";

const PLAYER_ID_KEY = "current-player-id";

export function useRegistration(eventId?: string) {
  const [state, setState] = useState<RegistrationState>(initialRegistration());
  const [loaded, setLoaded] = useState(false);

  // 初始从后端加载
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/data/registration${eventId ? `?eventId=${encodeURIComponent(eventId)}` : ""}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setState(data as RegistrationState);
      })
      .catch(() => {
        // 加载失败用默认值
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 状态变化后保存到后端
  useEffect(() => {
    if (!loaded) return;
    fetch(`/api/data/registration${eventId ? `?eventId=${encodeURIComponent(eventId)}` : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).catch(() => {
      // 保存失败不阻断交互
    });
  }, [state, loaded]);

  /** 当前选手身份（简易，报名时绑定） */
  const [currentPlayerId, setCurrentPlayerId] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(PLAYER_ID_KEY);
    }
    return null;
  });

  /** 选手报名，返回选手 id。优先通过公开接口落盘；服务端明确拒绝时抛错，网络失败退化为本地记录 */
  const submitPlayer = useCallback(
    async (data: Omit<RegistrationPlayer, "id" | "submittedAt" | "status">): Promise<string> => {
      let player: RegistrationPlayer | null = null;
      let rejectedMessage = "";
      try {
        const res = await fetch("/api/public/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (res.ok) {
          const json = (await res.json()) as { player?: RegistrationPlayer; state?: RegistrationState };
          if (json.player && typeof json.player.id === "string") {
            player = json.player;
            if (json.state && Array.isArray(json.state.players)) {
              setState(json.state);
            } else {
              setState((s) => ({ ...s, players: [...s.players, player!] }));
            }
          }
        } else {
          try {
            const json = (await res.json()) as { message?: string };
            rejectedMessage = json.message ?? "";
          } catch {
            // 响应体不是 JSON，忽略
          }
        }
      } catch {
        // 网络失败：退化为本地记录，不阻断报名流程
      }

      if (!player) {
        if (rejectedMessage) throw new Error(rejectedMessage);
        player = {
          ...data,
          id: `P-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          submittedAt: new Date().toISOString(),
          status: "已报名",
        };
        setState((s) => ({ ...s, players: [...s.players, player!] }));
      }

      try {
        localStorage.setItem(PLAYER_ID_KEY, player.id);
      } catch {
        // 忽略
      }
      setCurrentPlayerId(player.id);
      return player.id;
    },
    [],
  );

  /** 队长建队，返回队伍 id */
  const createTeam = useCallback((name: string, captainId: string): string => {
    const id = `T-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const team: RegistrationTeam = {
      id,
      name,
      captainId,
      memberIds: [captainId],
      status: "报名中",
      createdAt: new Date().toISOString(),
    };
    setState((s) => ({ ...s, teams: [...s.teams, team] }));
    return id;
  }, []);

  /** 把选手加入队伍并指定角色 */
  const assignPlayer = useCallback(
    (playerId: string, teamId: string, role: "首发" | "替补" | "教练") => {
      setState((s) => ({
        ...s,
        players: s.players.map((p) =>
          p.id === playerId ? { ...p, teamId, role, status: "已入队" as const } : p,
        ),
        teams: s.teams.map((t) =>
          t.id === teamId
            ? { ...t, memberIds: t.memberIds.includes(playerId) ? t.memberIds : [...t.memberIds, playerId] }
            : t,
        ),
      }));
    },
    [],
  );

  /** 从队伍移除选手，回到选手池 */
  const removePlayerFromTeam = useCallback((playerId: string) => {
    setState((s) => ({
      ...s,
      players: s.players.map((p) =>
        p.id === playerId ? { ...p, teamId: undefined, role: undefined, status: "已报名" as const } : p,
      ),
      teams: s.teams.map((t) => ({ ...t, memberIds: t.memberIds.filter((id) => id !== playerId) })),
    }));
  }, []);

  /** 当前选手作为队长创建队伍（公开接口落盘），未绑定身份时返回 null */
  const createTeamAsPlayer = useCallback(
    async (name: string): Promise<string | null> => {
      if (!currentPlayerId) return null;
      try {
        const res = await fetch("/api/public/team", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, captainId: currentPlayerId }),
        });
        if (!res.ok) {
          const json = (await res.json()) as { message?: string };
          throw new Error(json.message ?? "建队失败");
        }
        const json = (await res.json()) as { team?: RegistrationTeam; state?: RegistrationState };
        if (json.state && Array.isArray(json.state.players)) {
          setState(json.state);
        }
        return json.team?.id ?? null;
      } catch (e) {
        if (e instanceof Error && e.message) throw e;
        throw new Error("建队失败，请稍后重试");
      }
    },
    [currentPlayerId],
  );

  /** 把选手加入队伍（公开接口落盘，供玩家人才市场使用），服务端拒绝时抛错 */
  const joinTeamPublic = useCallback(
    async (playerId: string, teamId: string, role: "首发" | "替补" | "教练"): Promise<void> => {
      try {
        const res = await fetch("/api/public/team/member", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ teamId, playerId, role }),
        });
        if (!res.ok) {
          const json = (await res.json()) as { message?: string };
          throw new Error(json.message ?? "入队失败");
        }
        const json = (await res.json()) as { state?: RegistrationState };
        if (json.state && Array.isArray(json.state.players)) {
          setState(json.state);
        }
      } catch (e) {
        if (e instanceof Error && e.message) throw e;
        throw new Error("入队失败，请稍后重试");
      }
    },
    [],
  );

  /** 审核通过队伍（名单锁定） */
  const approveTeam = useCallback((teamId: string) => {
    setState((s) => ({
      ...s,
      teams: s.teams.map((t) => (t.id === teamId ? { ...t, status: "已冻结" as const } : t)),
    }));
  }, []);

  /** 删除队伍（驳回/退赛），成员回到选手池 */
  const removeTeam = useCallback((teamId: string) => {
    setState((s) => ({
      ...s,
      teams: s.teams.filter((t) => t.id !== teamId),
      players: s.players.map((p) =>
        p.teamId === teamId ? { ...p, teamId: undefined, role: undefined, status: "已报名" as const } : p,
      ),
    }));
  }, []);

  /** 冻结全部名单 */
  const freezeAll = useCallback(() => {
    setState((s) => ({ ...s, frozen: true }));
  }, []);

  /** 载入演示数据：16 支已冻结队伍，段位按 4 个池递减 */
  const loadDemoData = useCallback(() => {
    const teamNames = [
      "星辰电竞", "暗影战队", "烈焰先锋", "寒冰之刃",
      "雷霆万钧", "风暴联盟", "极光战队", "深渊之怒",
      "幻影骑士", "铁血战狼", "破晓之光", "暗夜行者",
      "炽热灵魂", "冰封王座", "苍穹之翼", "虚空使者",
    ];
    const rankByPot = [
      ["无畏战魂", "神话"],
      ["钻石", "超凡", "铂金"],
      ["黄金", "白银"],
      ["青铜", "铁"],
    ];
    const players: RegistrationPlayer[] = [];
    const teams: RegistrationTeam[] = [];
    let seq = 0;
    teamNames.forEach((name, i) => {
      const potRanks = rankByPot[Math.floor(i / 4)];
      const memberIds: string[] = [];
      for (let k = 0; k < 5; k++) {
        const id = `demo-p-${seq++}`;
        players.push({
          id,
          name: `${name}选手${k + 1}`,
          studentId: `2026${String(seq).padStart(4, "0")}`,
          gameId: `${name}-${k + 1}`,
          rank: potRanks[k % potRanks.length],
          submittedAt: new Date().toISOString(),
          status: "已入队",
          teamId: `demo-t-${i}`,
          role: "首发",
        });
        memberIds.push(id);
      }
      teams.push({
        id: `demo-t-${i}`,
        name,
        captainId: memberIds[0],
        memberIds,
        status: "已冻结",
        createdAt: new Date().toISOString(),
      });
    });
    setState({ players, teams, frozen: true });
  }, []);

  /** 重置演示数据 */
  const reset = useCallback(() => setState(initialRegistration()), []);

  return {
    state,
    currentPlayerId,
    submitPlayer,
    createTeam,
    createTeamAsPlayer,
    assignPlayer,
    joinTeamPublic,
    removePlayerFromTeam,
    approveTeam,
    removeTeam,
    freezeAll,
    loadDemoData,
    reset,
  };
}
