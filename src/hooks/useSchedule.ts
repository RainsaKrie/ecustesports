// =====================
// 赛程状态管理（React 层薄封装，全部逻辑在 schedule-ops.ts 纯函数中）
// 闭环：导入对阵 → 排期 → 改期申请/审批 → 报分 → 晋级推进
// =====================

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { removeMatchOp } from "@/lib/domains/schedule/remove-match";
import { revertResultOp, type RevertResultOutcome } from "@/lib/domains/schedule/revert-result";
import type { ScheduleState, ScheduleMatch, GameResult } from "@/lib/domains/schedule/schedule-data";
import { applyBulkAssignments, type BulkAssignment } from "@/lib/domains/schedule/bulk-schedule";
import { teamSwapRefusal, type TeamSlot } from "@/lib/domains/schedule/team-swap";
import { swapTeamsOp } from "@/lib/domains/schedule/schedule-ops";
import { emptySchedule, normalizeScheduleState } from "@/lib/domains/schedule/schedule-data";
import type { SchedulingConfig, ValidationResult } from "@/lib/domains/schedule/rule-engine";
import {
  importMatchesOp,
  archiveAndClearScheduleOp,
  submitRequestOp,
  approveRequestOp,
  rejectRequestOp,
  toggleFrozenOp,
  reportGameResultsOp,
  setMatchTimeOp,
  saveBPMapsOp,
} from "@/lib/domains/schedule/schedule-ops";
import { SCHEDULE_SYNC_POLL_MS, decideScheduleSync } from "@/lib/domains/schedule/schedule-freshness";

/** 「已自动同步」提示的停留时长：够看完一句话，又不至于常驻。 */
const AUTO_SYNC_NOTE_MS = 10_000;

export function useSchedule(eventId?: string, access: "public" | "admin" | "preview" = "public") {
  const [state, setState] = useState<ScheduleState>(emptySchedule());
  const [loadedEventId, setLoadedEventId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");
  /**
   * 「数据时间」这一行用的时刻：**最后一次与服务端对齐**是什么时候。
   *
   * 单独拿一个状态而不是直接用 `state.version`：本地操作会让 `state` 先行变化，
   * 而「我手里这份是不是最新的」问的是取数时刻，不是本地改没改过。
   */
  const [syncedAt, setSyncedAt] = useState(0);
  /** 刚刚自动同步落地的版本；用于短暂提示一句「已自动同步」。 */
  const [autoSynced, setAutoSynced] = useState<{ version: number } | null>(null);
  const dirtyRef = useRef(false);
  /** `state` 的同步镜像 —— 给需要"先算再改"的操作函数用（见 removeMatch）。
   *  只能在 effect 里同步：渲染期间写 ref 会被规则拦下（Cannot update ref during render）。 */
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const persistedVersionRef = useRef(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  /** 在途保存数。后台同步必须等它归零，否则会用旧快照盖掉刚存好的结果。 */
  const inFlightRef = useRef(0);
  /**
   * `state.version` 的镜像，供后台探测对照。
   *
   * ★ 为什么对照的是 `state.version` 而不是 `persistedVersionRef`：
   *   探测要回答的是「**页面上显示的这份**是不是旧的」。
   *   若拿「服务端最后确认过的版本」去比，本地刚改完还没存完时
   *   （state 已到 12、persisted 还是 11），远端回 11 会被判成「更新」→ 重取 →
   *   把负责人刚做的改动静默丢掉。用 `state.version` 只会判成「更旧」，不动。
   */
  const stateVersionRef = useRef(0);
  useEffect(() => {
    stateVersionRef.current = state.version;
  }, [state.version]);

  const refresh = useCallback(async (mode: "manual" | "auto" = "manual") => {
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
    setSyncedAt(Date.now());
    if (mode === "auto") setAutoSynced({ version: next.version });
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
        setSyncedAt(Date.now());
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
    const endpoint = `/api/data/schedule?eventId=${encodeURIComponent(eventId)}`;
    inFlightRef.current += 1;
    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "If-Match": String(persistedVersionRef.current),
          },
          body: JSON.stringify(snapshot),
        });
        const result = await response.json().catch(() => ({})) as { message?: string; schedule?: ScheduleState };
        if (response.status === 409) {
          /**
           * 冲突：说明别条路径（裁判报分 / BP 完成 / 队长约赛）已经改过赛程，
           * 而本页面手里的还是旧快照。这里必须**主动重取**——
           * 否则负责人会对着过期赛程反复提交，或（更糟）把别人的成果覆盖回去。
           * 服务端已加了内容级护栏，这里补上「重载」把页面救回一致状态。
           */
          await refresh().catch(() => undefined);
          // 冲突时本地改动**没有被保存**，必须让用户知道，而不是悄悄回滚。
          dirtyRef.current = true;
          setSaveError(
            `${result.message ?? "赛程已被其他操作更新"}（你的改动没有保存，请确认最新数据后重做）`,
          );
          return;
        }
        if (!response.ok || !result.schedule) {
          // 保存失败必须把 dirty 置回 true —— 否则这次改动就永远丢了，
          // 页面上还显示着"已改"的样子（2026-10-22 删 4 场决赛后线上又变回 12 场就是这条）。
          dirtyRef.current = true;
          throw new Error(result.message ?? "赛程保存失败");
        }
        const saved = normalizeScheduleState(result.schedule);
        persistedVersionRef.current = saved.version;
        setSaveError("");
        // 本地就是服务端了，「数据时间」跟着走 —— 否则刚存完仍显示「10 分钟前」，看起来像没存上
        setSyncedAt(Date.now());
        setState((current) => current === snapshot ? saved : current);
      })
      .catch((error) => {
        dirtyRef.current = true; // 让人能重试，而不是把改动丢掉
        setSaveError(`${error instanceof Error ? error.message : "赛程保存失败"}（改动尚未保存）`);
      })
      .finally(() => {
        inFlightRef.current = Math.max(0, inFlightRef.current - 1);
      });
  }, [state, loadedEventId, eventId, access, refresh]);

  /**
   * 后台探测：别条路径（裁判报分 / BP / 队长约赛 / 另一台管理端）有没有改过赛程。
   *
   * 只在管理端跑（公开页没有编辑权，不需要），且失败一律静默 ——
   * 这是「顺带看一眼」，不是主链路，不该弹错打扰负责人。
   *
   * 判定与「为什么不看更旧的版本」在 `schedule-freshness.ts`。
   * 省掉「待同步」这条中间态的取舍：它会在保存失败时卡在屏幕上、并显示一句
   * 已经不成立的话；探测到就直接跟进，只用一句短暂的「已自动同步」确认。
   */
  useEffect(() => {
    if (access !== "admin" || !eventId) return;
    let cancelled = false;
    const endpoint = `/api/data/schedule?eventId=${encodeURIComponent(eventId)}`;
    const probe = async () => {
      // 有保存在途就先跳过：等保存落地，下一轮（或 focus）再判，避免同时改写同一份状态
      if (cancelled || inFlightRef.current > 0) return;
      // 页面不在前台就不打扰（切回来时 `focus` 会补一次）
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      try {
        const response = await fetch(endpoint, { cache: "no-store" });
        if (!response.ok) return;
        const remote = normalizeScheduleState(await response.json()).version;
        if (cancelled) return;
        if (decideScheduleSync(stateVersionRef.current, remote) !== "reload") return;
        await refresh("auto");
      } catch {
        // 静默
      }
    };
    const timer = window.setInterval(() => { void probe(); }, SCHEDULE_SYNC_POLL_MS);
    window.addEventListener("focus", probe);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", probe);
    };
  }, [access, eventId, refresh]);

  /** 「已自动同步」提示自动退场。 */
  useEffect(() => {
    if (!autoSynced) return;
    const timer = window.setTimeout(() => setAutoSynced(null), AUTO_SYNC_NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [autoSynced]);

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
  /**
   * 批准改期：批准前基于当前赛程与版本重新校验（AC-03）。
   * 返回 null 表示操作无效（申请不存在或已处理）；返回 ValidationResult 表示校验结果。
   *
   * `ownerAttestsBothTeams` 为 true 时允许批准「待对手确认」的申请，
   * 由负责人核对双方私下商定的时间（并在记录里留下 ownerAttestedAt 作为凭据）。
   */
  const approveRequest = useCallback(
    (requestId: string, options?: { ownerAttestsBothTeams?: boolean }): ValidationResult | null => {
      const out = approveRequestOp(state, requestId, state.config, options);
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

  /** 单场写操作的统一壳：先用当前 state 算、再 setState，返回失败原因（成功 null）。
   *  ★ 别放进 setState 的更新函数：它延迟执行且 StrictMode 跑两次，返回时拿不到原因。 */
  const matchOp = useCallback(
    (op: (state: ScheduleState, matchId: string) => RevertResultOutcome) =>
      (matchId: string): string | null => {
        const out = op(stateRef.current, matchId);
        if (!out.ok) return out.message;
        dirtyRef.current = true;
        setState(out.state);
        return null;
      },
    [],
  );

  /** 删除一场比赛（2026-10-22）：赛事中途取消某场时用。 */
  const removeMatch = matchOp(removeMatchOp);

  /** 撤销赛果（2026-11-05）：还没打却被标成已完成时用，清比分与胜者并退回未打。 */
  const revertResult = matchOp(revertResultOp);

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

  /**
   * 批量排期：一次性把多场的时间写进去（固定比赛时间模式下用）。
   *
   * 只做「改 matches + 置脏」—— 持久化、版本条件写入（If-Match）、
   * 409 冲突后自动重载，全部沿用本 hook 既有的那套（见上面的自动保存 effect）。
   * 所以它**没有引入新的赛程写入点**，不需要改写入契约登记表。
   */
  /**
   * 调整对阵：交换两个签位的队伍。
   *
   * 先在**当前状态**上判一次（拿到可读理由直接返回给界面提示），再落状态 ——
   * 抛错不能发生在 setState 的回调里（那会变成渲染期异常）。
   * 理由由操作层强制（`swapTeamsOp` 会对空理由抛错），界面忘记了也绕不过去。
   */
  const applyTeamSwap = useCallback((from: TeamSlot, to: TeamSlot, reason: string): string | null => {
    const refusal = teamSwapRefusal(state.matches, from, to);
    if (refusal) return refusal;
    dirtyRef.current = true;
    setState((current) => swapTeamsOp(current, from, to, reason));
    return null;
  }, [state]);

  const applySchedulePlan = useCallback((assignments: BulkAssignment[]) => {
    if (assignments.length === 0) return;
    dirtyRef.current = true;
    setState((current) => ({ ...current, matches: applyBulkAssignments(current.matches, assignments) }));
  }, []);

  return {
    state,
    applySchedulePlan,
    applyTeamSwap,
    submitRequest,
    approveRequest,
    rejectRequest,
    toggleFrozen,
    removeMatch,
    revertResult,
    reportGameResults,
    setMatchTime,
    importMatches,
    saveBPMaps,
    reset,
    updateConfig,
    confirmConfig,
    refresh,
    saveError,
    /** 最后一次与服务端对齐的时刻（毫秒）。0 表示还没读到过。 */
    syncedAt,
    /** 刚刚自动同步到的新版本，用于短暂提示；10 秒后自行清空。 */
    autoSynced,
  };
}
