// =====================
// 赛程状态管理（React 层薄封装，全部逻辑在 schedule-ops.ts 纯函数中）
// 闭环：导入对阵 → 排期 → 改期申请/审批 → 报分 → 晋级推进
// =====================

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ScheduleState, ScheduleMatch, GameResult } from "./schedule-data";
import { emptySchedule, normalizeScheduleState } from "./schedule-data";
import type { SchedulingConfig, ValidationResult } from "./rule-engine";
import {
  importMatchesOp,
  archiveAndClearScheduleOp,
  submitRequestOp,
  approveRequestOp,
  rejectRequestOp,
  toggleFrozenOp,
  markNotificationSentOp,
  reportGameResultsOp,
  setMatchTimeOp,
  saveBPMapsOp,
} from "./schedule-ops";

export function useSchedule(eventId?: string, access: "public" | "admin" | "preview" = "public") {
  const [state, setState] = useState<ScheduleState>(emptySchedule());
  const [loadedEventId, setLoadedEventId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");
  const dirtyRef = useRef(false);
  const persistedVersionRef = useRef(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const refresh = useCallback(async () => {
    if (!eventId) return;
    const endpoint = access === "public" ? "/api/public/schedule" : "/api/data/schedule";
    const response = await fetch(`${endpoint}?eventId=${encodeURIComponent(eventId)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("赛程读取失败");
    dirtyRef.current = false;
    const next = normalizeScheduleState(await response.json());
    persistedVersionRef.current = next.version;
    setState(next);
    setSaveError("");
    setLoadedEventId(eventId);
  }, [eventId, access]);

  useEffect(() => {
    let cancelled = false;
    if (!eventId) return;
    const endpoint = access === "public" ? "/api/public/schedule" : "/api/data/schedule";
    fetch(`${endpoint}?eventId=${encodeURIComponent(eventId)}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("赛程读取失败")))
      .then((data) => {
        if (cancelled) return;
        dirtyRef.current = false;
        const next = normalizeScheduleState(data);
        persistedVersionRef.current = next.version;
        setState(next);
        setSaveError("");
        setLoadedEventId(eventId);
      })
      .catch(() => {
        // 用默认值
      });
    return () => { cancelled = true; };
  }, [eventId, access]);

  useEffect(() => {
    if (access !== "admin" || !eventId || loadedEventId !== eventId || !dirtyRef.current) return;
    dirtyRef.current = false;
    const snapshot = state;
    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const response = await fetch(`/api/data/schedule?eventId=${encodeURIComponent(eventId)}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "If-Match": String(persistedVersionRef.current),
          },
          body: JSON.stringify(snapshot),
        });
        const result = await response.json().catch(() => ({})) as { message?: string; schedule?: ScheduleState };
        if (!response.ok || !result.schedule) {
          throw new Error(result.message ?? "赛程保存失败");
        }
        const saved = normalizeScheduleState(result.schedule);
        persistedVersionRef.current = saved.version;
        setSaveError("");
        setState((current) => current === snapshot ? saved : current);
      })
      .catch((error) => {
        setSaveError(error instanceof Error ? error.message : "赛程保存失败");
      });
  }, [state, loadedEventId, eventId, access]);

  /** 提交改期申请并校验，返回校验结果 */
  const submitRequest = useCallback(
    (
      matchId: string,
      newStartTime: string,
      reason: string,
      teamAConfirmed: boolean,
      teamBConfirmed: boolean,
    ): ValidationResult => {
      const out = submitRequestOp(state, { matchId, newStartTime, reason, teamAConfirmed, teamBConfirmed }, state.config);
      dirtyRef.current = true;
      setState(out.state);
      return out.value!;
    },
    [state],
  );

  /**
   * 批准改期：批准前基于当前赛程与版本重新校验（AC-03）。
   * 返回 null 表示操作无效（申请不存在或已处理）；返回 ValidationResult 表示校验结果。
   */
  const approveRequest = useCallback(
    (requestId: string): ValidationResult | null => {
      const out = approveRequestOp(state, requestId, state.config);
      dirtyRef.current = true;
      setState(out.state);
      return out.value ?? null;
    },
    [state],
  );

  /** 驳回改期申请 */
  const rejectRequest = useCallback((requestId: string) => {
    dirtyRef.current = true;
    setState((s) => rejectRequestOp(s, requestId));
  }, []);

  /** 切换比赛冻结状态 */
  const toggleFrozen = useCallback((matchId: string) => {
    dirtyRef.current = true;
    setState((s) => toggleFrozenOp(s, matchId));
  }, []);

  /** 标记通知为已发送 */
  const markNotificationSent = useCallback((notificationId: string) => {
    dirtyRef.current = true;
    setState((s) => markNotificationSentOp(s, notificationId));
  }, []);

  /**
   * 报分：录入逐局结果、校验比分、判定胜者、标记完成，
   * 并推进胜者（胜者路径）与败者（双败路径）进入后续场次。
   * 返回 { ok, message }。
   */
  const reportGameResults = useCallback(
    (matchId: string, gameResults: GameResult[]) => {
      const out = reportGameResultsOp(state, matchId, gameResults);
      dirtyRef.current = true;
      setState(out.state);
      return out.value!;
    },
    [state],
  );

  /**
   * 排期 / 直接改期：负责人直接设置比赛时间（不经过两队确认流程），
   * 校验硬约束后生成新版本。返回校验结果。
   */
  const setMatchTime = useCallback(
    (matchId: string, newStartTime: string, reason = ""): ValidationResult => {
      const out = setMatchTimeOp(state, matchId, newStartTime, state.config, reason);
      dirtyRef.current = true;
      setState(out.state);
      return out.value!;
    },
    [state],
  );

  /** 从赛制抽签导入对阵，生成比赛列表 */
  const importMatches = useCallback((matches: ScheduleMatch[]) => {
    dirtyRef.current = true;
    setState((s) => importMatchesOp(s, matches));
  }, []);

  /** 保存 BP 选出的地图（用于逐局地图同步） */
  const saveBPMaps = useCallback((matchId: string, maps: string[]) => {
    dirtyRef.current = true;
    setState((s) => saveBPMapsOp(s, matchId, maps));
  }, []);

  /** 归档当前赛程并清空，返回抽签前骨架状态。 */
  const reset = useCallback(() => {
    dirtyRef.current = true;
    setState((s) => archiveAndClearScheduleOp(s));
  }, []);

  /** 排程工作区专属约束，避免散落到赛事内容设置。 */
  const updateConfig = useCallback((patch: Partial<SchedulingConfig>) => {
    dirtyRef.current = true;
    setState((current) => ({
      ...current,
      configConfirmed: false,
      config: {
        ...current.config,
        ...patch,
        boDurations: patch.boDurations
          ? { ...current.config.boDurations, ...patch.boDurations }
          : current.config.boDurations,
      },
    }));
  }, []);

  const confirmConfig = useCallback(() => {
    dirtyRef.current = true;
    setState((current) => ({ ...current, configConfirmed: true }));
  }, []);

  return {
    state,
    submitRequest,
    approveRequest,
    rejectRequest,
    toggleFrozen,
    markNotificationSent,
    reportGameResults,
    setMatchTime,
    importMatches,
    saveBPMaps,
    reset,
    updateConfig,
    confirmConfig,
    refresh,
    saveError,
  };
}
