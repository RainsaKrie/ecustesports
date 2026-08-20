// =====================
// 赛程状态管理（React 层薄封装，全部逻辑在 schedule-ops.ts 纯函数中）
// 闭环：导入对阵 → 排期 → 改期申请/审批 → 报分 → 晋级推进
// =====================

"use client";

import { useCallback, useEffect, useState } from "react";
import type { ScheduleState, ScheduleMatch, GameResult } from "./schedule-data";
import { initialSchedule } from "./schedule-data";
import type { ValidationResult } from "./rule-engine";
import {
  importMatchesOp,
  submitRequestOp,
  approveRequestOp,
  rejectRequestOp,
  toggleFrozenOp,
  markNotificationSentOp,
  reportGameResultsOp,
  setMatchTimeOp,
  saveBPMapsOp,
} from "./schedule-ops";

export function useSchedule(eventId?: string) {
  const [state, setState] = useState<ScheduleState>(initialSchedule());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/data/schedule${eventId ? `?eventId=${encodeURIComponent(eventId)}` : ""}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setState(data as ScheduleState);
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
    fetch(`/api/data/schedule${eventId ? `?eventId=${encodeURIComponent(eventId)}` : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).catch(() => {
      // 保存失败不阻断交互
    });
  }, [state, loaded, eventId]);

  /** 提交改期申请并校验，返回校验结果 */
  const submitRequest = useCallback(
    (
      matchId: string,
      newStartTime: string,
      reason: string,
      teamAConfirmed: boolean,
      teamBConfirmed: boolean,
    ): ValidationResult => {
      const out = submitRequestOp(state, { matchId, newStartTime, reason, teamAConfirmed, teamBConfirmed });
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
      const out = approveRequestOp(state, requestId);
      setState(out.state);
      return out.value ?? null;
    },
    [state],
  );

  /** 驳回改期申请 */
  const rejectRequest = useCallback((requestId: string) => {
    setState((s) => rejectRequestOp(s, requestId));
  }, []);

  /** 切换比赛冻结状态 */
  const toggleFrozen = useCallback((matchId: string) => {
    setState((s) => toggleFrozenOp(s, matchId));
  }, []);

  /** 标记通知为已发送 */
  const markNotificationSent = useCallback((notificationId: string) => {
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
    (matchId: string, newStartTime: string): ValidationResult => {
      const out = setMatchTimeOp(state, matchId, newStartTime);
      setState(out.state);
      return out.value!;
    },
    [state],
  );

  /** 从赛制抽签导入对阵，生成比赛列表 */
  const importMatches = useCallback((matches: ScheduleMatch[]) => {
    setState((s) => importMatchesOp(s, matches));
  }, []);

  /** 保存 BP 选出的地图（用于逐局地图同步） */
  const saveBPMaps = useCallback((matchId: string, maps: string[]) => {
    setState((s) => saveBPMapsOp(s, matchId, maps));
  }, []);

  /** 重置为初始演示数据 */
  const reset = useCallback(() => {
    setState(initialSchedule());
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
  };
}
