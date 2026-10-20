"use client";

import { useEffect, useMemo, useState } from "react";
import CustomFormatModal from "@/components/admin/CustomFormatModal";
import { useRouter } from "next/navigation";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { AdminModal } from "@/components/admin/ui";
import { buildPlayInPairs, buildSeedPots, generateMatchups, rankTeamsByAvgRank, type Group, type SeedPot } from "@/lib/domains/registration/format";
import {
  buildDoubleEliminationMatches,
  buildGslGroupMatches,
  buildGroupSingleElimMatches,
  buildQualificationMatches,
  buildSingleEliminationMatches,
  buildTournamentMatches,
  BYE,
  PENDING,
} from "@/lib/domains/schedule/bracket-engine";
import { resolveSupportedFormat, type SupportedFormat } from "@/lib/domains/schedule/format-support";
import { initialRegistration, type RegistrationState } from "@/lib/domains/registration/data";
import type { ScheduleMatch, ScheduleState } from "@/lib/domains/schedule/schedule-data";
import { appendMatchesOp } from "@/lib/domains/schedule/schedule-ops";
import {
  buildKnockoutDrawOrder,
  buildQualifierSlots,
  nextMatchStartIndex,
  resolvePlayInGate,
  resolveStagedDrawGate,
  withPendingSlots,
  type GroupQualifier,
  type PlayInGate,
  type StagedDrawGate,
  type StagedFormatState,
} from "@/lib/domains/schedule/staged-format";
import type { StageConfig } from "@/lib/domains/schedule/format-templates";
import { FORMAT_TEMPLATES } from "@/lib/domains/schedule/format-templates";
import type { EditableEvent } from "@/lib/site-config-schema";

type DrawMode = "slot" | "groups" | "locked";

interface GroupQueueItem {
  teamId: string;
  potIndex: number;
  groupIndex: number;
}

function shuffle<T>(values: T[]): T[] {
  const items = [...values];
  for (let index = items.length - 1; index > 0; index--) {
    const target = Math.floor(Math.random() * (index + 1));
    [items[index], items[target]] = [items[target], items[index]];
  }
  return items;
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((data as { message?: string }).message ?? "数据读取失败");
  }
  return data as T;
}

async function writeJson(url: string, body: unknown, expectedVersion?: number): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(expectedVersion !== undefined ? { "If-Match": String(expectedVersion) } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((data as { message?: string }).message ?? "保存失败");
  }
}

export default function FormatDrawWorkspace({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [event, setEvent] = useState<EditableEvent | null>(null);
  const [reg, setReg] = useState<RegistrationState>(initialRegistration());
  const [format, setFormat] = useState<SupportedFormat | null>(null);
  const [savedFormat, setSavedFormat] = useState<StagedFormatState>({});
  const [drawMode, setDrawMode] = useState<DrawMode>("locked");
  /**
   * 入围赛已经发布、赛程里还留着「待定」席位，而资格赛这下打完了 —— 可以补齐。
   * null 表示没有要补的。`teamIds` 是「还没进过入围赛的资格赛胜者」。
   */
  const [pendingFill, setPendingFill] = useState<{ count: number; teamIds: string[] } | null>(null);
  const [filling, setFilling] = useState(false);
  const [activeStage, setActiveStage] = useState<StageConfig | null>(null);
  const [activeStageIndex, setActiveStageIndex] = useState<number | null>(null);
  const [eligibleTeamIds, setEligibleTeamIds] = useState<string[]>([]);
  const [qualifiers, setQualifiers] = useState<GroupQualifier[]>([]);
  const [stagedGate, setStagedGate] = useState<StagedDrawGate | PlayInGate | null>(null);
  const [isPlayInStage, setIsPlayInStage] = useState(false);
  const [pots, setPots] = useState<SeedPot[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupQueue, setGroupQueue] = useState<GroupQueueItem[]>([]);
  const [drawOrder, setDrawOrder] = useState<string[]>([]);
  const [slotQueue, setSlotQueue] = useState<string[]>([]);
  const [lastTeamId, setLastTeamId] = useState("");
  const [lastGroupIndex, setLastGroupIndex] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");
  const [formatModalOpen, setFormatModalOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [targetTemplate, setTargetTemplate] = useState("");
  const [changingFormat, setChangingFormat] = useState(false);

  const teamName = useMemo(() => {
    const names = new Map(reg.teams.map((team) => [team.id, team.name]));
    return (teamId: string) => {
      // 预留席位：对手要等资格赛结果。与普通「待定」区分开，一眼能看出在等什么。
      if (teamId === PENDING) return "待定（资格赛胜者）";
      return names.get(teamId) ?? "待定";
    };
  }, [reg.teams]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [registration, loadedFormat, loadedSchedule, config] = await Promise.all([
        readJson<RegistrationState>(`/api/data/registration?eventId=${encodeURIComponent(eventId)}`),
        readJson<StagedFormatState>(`/api/data/format?eventId=${encodeURIComponent(eventId)}`),
        readJson<ScheduleState>(`/api/data/schedule?eventId=${encodeURIComponent(eventId)}`),
        readJson<{ events?: EditableEvent[] }>("/api/admin/site-config"),
      ]);
      if (cancelled) return;

      const currentEvent = config.events?.find((candidate) => candidate.id === eventId) ?? null;
      if (!currentEvent) throw new Error("赛事不存在或已被移除。");
      const resolved = resolveSupportedFormat(currentEvent.stageConfigs ?? []);
      setEvent(currentEvent);
      setReg(registration);
      setFormat(resolved);
      setSavedFormat(loadedFormat);
      if (resolved.kind === "unsupported") {
        setError(resolved.message);
        setLoaded(true);
        return;
      }

      const frozenTeams = registration.teams.filter((team) => team.status === "已冻结");
      const frozenIds = frozenTeams.map((team) => team.id);

      // 四阶段赛制：先跑资格赛；赛果全部确认后，把 4 支胜者并入入围赛，再走既有三阶段流程。
      let stagedEntrantsOverride: string[] | null = null;
      if (resolved.kind === "staged-playin") {
        const playInIds = rankTeamsByAvgRank(frozenTeams, registration.players)
          .slice(-resolved.playInTeams)
          .map((item) => item.id);
        const playInGate = resolvePlayInGate(resolved.playInStage, playInIds, loadedSchedule.matches);
        setStagedGate(playInGate);

        if (playInGate.status === "blocked") {
          setError(playInGate.message);
          setIsPlayInStage(true);
          setDrawMode("locked");
          setLoaded(true);
          return;
        }
        // 注意这里**没有** waiting 分支了：资格赛只打了一部分时（partial），
        // 已决出的胜者可以先进入围赛签位，缺的席位在「发布」那一步按 pendingCount 留成待定。
        // 原来这里直接锁死（必须等资格赛全部结束），会把整个入围赛的赛程一起拖住。
        if (playInGate.status === "ready") {
          // 资格赛按段位同档互打，顺序确定、不随机；「抽签」在这里是逐一揭示。
          setDrawMode("slot");
          setIsPlayInStage(true);
          setActiveStage(resolved.playInStage);
          setActiveStageIndex(0);
          setEligibleTeamIds(playInIds);
          const playInSet = new Set(playInIds);
          const existingPlayIn = (loadedFormat.playInDraw?.drawOrder ?? []).filter((id) => playInSet.has(id));
          setDrawOrder(existingPlayIn);
          const ordered = buildPlayInPairs(playInIds).flatMap((pair) => [pair.teamAId, pair.teamBId]);
          setSlotQueue(ordered.filter((id) => !existingPlayIn.includes(id)));
          setLoaded(true);
          return;
        }
        // complete / partial：其余队伍 + 资格赛已决出的胜者 = 入围赛的参赛队。
        // partial 时数量还差几个，由发布那一步补成待定席位。
        const playInSet = new Set(playInIds);
        stagedEntrantsOverride = [
          ...frozenIds.filter((id) => !playInSet.has(id)),
          ...playInGate.advancingTeamIds,
        ];

        // 入围赛此前是带着待定席位发布的、现在资格赛打完了 → 给一个「补齐」入口。
        // 必须在这里判：再往下走 gate 会是 waiting（入围赛还没打完），界面被锁死就补不了了。
        const qualifierPhase = resolved.stages[0].name;
        const qualifierMatchList = loadedSchedule.matches.filter((match) => match.phase === qualifierPhase);
        const stuckSlots = qualifierMatchList.filter(
          (match) => match.teamAId === PENDING || match.teamBId === PENDING,
        );
        if (stuckSlots.length > 0 && playInGate.status === "complete") {
          const alreadyIn = new Set(
            qualifierMatchList
              .flatMap((match) => [match.teamAId, match.teamBId])
              .filter((id) => id !== PENDING && id !== BYE),
          );
          setPendingFill({
            count: stuckSlots.length,
            teamIds: playInGate.advancingTeamIds.filter((id) => !alreadyIn.has(id)),
          });
        }
      }

      if (resolved.kind === "staged-32-gsl-double-elim" || resolved.kind === "staged-playin") {
        const stagedStages = resolved.stages;
        const stagedEntrants = stagedEntrantsOverride ?? frozenIds;
        const gate = resolveStagedDrawGate(stagedStages, stagedEntrants, loadedSchedule.matches, loadedFormat.qualifierByes ?? []);
        setStagedGate(gate);
        if (gate.status !== "ready") {
          setDrawMode("locked");
          setLoaded(true);
          return;
        }

        setActiveStage(gate.stage);
        setActiveStageIndex(gate.stageIndex);
        setEligibleTeamIds(gate.entrantIds);
        setQualifiers(gate.qualifiers ?? []);
        const eligibleSet = new Set(gate.entrantIds);
        const savedDraw = loadedFormat.stageDraws?.find((item) => item.stageIndex === gate.stageIndex);

        if (gate.stageIndex === 1) {
          setDrawMode("groups");
          const participantTeams = frozenTeams.filter((team) => eligibleSet.has(team.id));
          const seedPots = savedDraw?.seedPots?.length
            ? savedDraw.seedPots
            : buildSeedPots(participantTeams, registration.players);
          if (seedPots.length !== 4) throw new Error("16 队 GSL 需要 4 个有效种子池，请检查晋级队伍首发与段位信息。");
          const existingGroups = ["A 组", "B 组", "C 组", "D 组"].map((name, index) => ({
            name,
            teamIds: savedDraw?.groups?.[index]?.teamIds.filter((teamId) => eligibleSet.has(teamId)) ?? [],
          }));
          const queue: GroupQueueItem[] = [];
          seedPots.forEach((pot, potIndex) => {
            const missingGroups = existingGroups
              .map((group, groupIndex) => ({ group, groupIndex }))
              .filter(({ group }) => !group.teamIds.some((teamId) => pot.teamIds.includes(teamId)))
              .map(({ groupIndex }) => groupIndex);
            const alreadyDrawn = new Set(existingGroups.flatMap((group) => group.teamIds));
            shuffle(pot.teamIds.filter((teamId) => !alreadyDrawn.has(teamId))).forEach((teamId, index) => {
              queue.push({ teamId, potIndex, groupIndex: missingGroups[index] });
            });
          });
          setPots(seedPots);
          setGroups(existingGroups);
          setGroupQueue(queue);
        } else {
          setDrawMode("slot");
          const existing = (savedDraw?.drawOrder ?? []).filter((teamId) => eligibleSet.has(teamId));
          setDrawOrder(existing);
          const fullOrder = gate.stageIndex === 2 && gate.qualifiers
            ? buildKnockoutDrawOrder(gate.qualifiers)
            : shuffle(gate.entrantIds);
          setSlotQueue(fullOrder.filter((teamId) => !existing.includes(teamId)));
        }
        setLoaded(true);
        return;
      }

      if (frozenTeams.length !== resolved.requiredTeams) {
        setError(`该赛制需要 ${resolved.requiredTeams} 支已冻结队伍，当前为 ${frozenTeams.length} 支。请先在「报名与队伍」中确认并冻结完整名单。`);
        setLoaded(true);
        return;
      }

      if (resolved.kind === "slot-draw") {
        setDrawMode("slot");
        setActiveStage(resolved.stage);
        setEligibleTeamIds(frozenIds);
        const frozenSet = new Set(frozenIds);
        const existing = (loadedFormat.drawOrder ?? []).filter((teamId) => frozenSet.has(teamId));
        setDrawOrder(existing);
        setSlotQueue(shuffle(frozenIds.filter((teamId) => !existing.includes(teamId))));
      } else if (resolved.kind === "gsl-double-elim") {
        setDrawMode("groups");
        setActiveStage(resolved.groupStage);
        setEligibleTeamIds(frozenIds);
        const seedPots = loadedFormat.seedPots?.length
          ? loadedFormat.seedPots
          : buildSeedPots(frozenTeams, registration.players);
        if (seedPots.length !== 4) throw new Error("16 队 GSL 需要 4 个有效种子池，请检查队伍首发与段位信息。");
        const existingGroups = ["A 组", "B 组", "C 组", "D 组"].map((name, index) => ({
          name,
          teamIds: loadedFormat.groups?.[index]?.teamIds.filter((teamId) => frozenTeams.some((team) => team.id === teamId)) ?? [],
        }));
        const queue: GroupQueueItem[] = [];
        seedPots.forEach((pot, potIndex) => {
          const missingGroups = existingGroups
            .map((group, groupIndex) => ({ group, groupIndex }))
            .filter(({ group }) => !group.teamIds.some((teamId) => pot.teamIds.includes(teamId)))
            .map(({ groupIndex }) => groupIndex);
          const alreadyDrawn = new Set(existingGroups.flatMap((group) => group.teamIds));
          const remaining = shuffle(pot.teamIds.filter((teamId) => !alreadyDrawn.has(teamId)));
          remaining.forEach((teamId, index) => {
            queue.push({ teamId, potIndex, groupIndex: missingGroups[index] });
          });
        });
        setPots(seedPots);
        setGroups(existingGroups);
        setGroupQueue(queue);
      }
      setLoaded(true);
    })().catch((reason) => {
      if (!cancelled) {
        setError(reason instanceof Error ? reason.message : "数据读取失败，请刷新重试。");
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const drawnGroupIds = useMemo(() => new Set(groups.flatMap((group) => group.teamIds)), [groups]);
  // 瑞士轮 / 循环赛**不需要抽签**：第 1 轮按种子顺序直接配对（见 buildSwissMatches）。
  // 这里把它们视为"已就绪"，否则 done 永远为 false —— 发布按钮永远点不了，
  // 后端明明能生成对阵（bracket-blueprint 已接），界面上却没有入口。
  const noDrawNeeded = format?.kind === "swiss" || format?.kind === "round-robin";
  const totalSlots = noDrawNeeded ? eligibleTeamIds.length : (drawMode === "locked" ? 0 : eligibleTeamIds.length);
  const drawnCount = noDrawNeeded
    ? totalSlots
    : drawMode === "slot" ? drawOrder.length : drawMode === "groups" ? drawnGroupIds.size : 0;
  const done = totalSlots > 0 && drawnCount === totalSlots;

  function drawOne() {
    if (!format || format.kind === "unsupported" || drawMode === "locked" || done) return;
    if (drawMode === "slot") {
      const [next, ...rest] = slotQueue;
      if (!next) return;
      setDrawOrder((current) => [...current, next]);
      setSlotQueue(rest);
      setLastTeamId(next);
      setLastGroupIndex(null);
      return;
    }
    const [next, ...rest] = groupQueue;
    if (!next) return;
    setGroups((current) => current.map((group, index) =>
      index === next.groupIndex ? { ...group, teamIds: [...group.teamIds, next.teamId] } : group,
    ));
    setGroupQueue(rest);
    setLastTeamId(next.teamId);
    setLastGroupIndex(next.groupIndex);
  }

  function drawAll() {
    if (!format || format.kind === "unsupported" || drawMode === "locked" || done) return;
    if (drawMode === "slot") {
      setDrawOrder((current) => [...current, ...slotQueue]);
      setSlotQueue([]);
    } else {
      const nextGroups = groups.map((group) => ({ ...group, teamIds: [...group.teamIds] }));
      groupQueue.forEach((item) => nextGroups[item.groupIndex].teamIds.push(item.teamId));
      setGroups(nextGroups);
      setGroupQueue([]);
    }
    setLastTeamId("");
    setLastGroupIndex(null);
  }

  function redraw() {
    if (!format || format.kind === "unsupported" || drawMode === "locked") return;
    if (drawMode === "slot") {
      setDrawOrder([]);
      // 资格赛按段位同档互打，顺序由段位决定（可重复「重抽」但结果一致）；其余阶段随机或按晋级规则。
      setSlotQueue(isPlayInStage
        ? buildPlayInPairs(eligibleTeamIds).flatMap((pair) => [pair.teamAId, pair.teamBId])
        : activeStageIndex === 2 && qualifiers.length === 8
          ? buildKnockoutDrawOrder(qualifiers)
          : shuffle(eligibleTeamIds));
    } else {
      const emptyGroups = ["A 组", "B 组", "C 组", "D 组"].map((name) => ({ name, teamIds: [] as string[] }));
      const queue: GroupQueueItem[] = [];
      pots.forEach((pot, potIndex) => {
        shuffle(pot.teamIds).forEach((teamId, groupIndex) => queue.push({ teamId, potIndex, groupIndex }));
      });
      setGroups(emptyGroups);
      setGroupQueue(queue);
    }
    setLastTeamId("");
    setLastGroupIndex(null);
  }

  async function changeFormat() {
    if (!event || !targetTemplate || changingFormat) return;
    setChangingFormat(true);
    setError("");
    try {
      const response = await fetch("/api/admin/events/format", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, templateId: targetTemplate }),
      });
      const data = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(data.message ?? "调整赛制失败");
      setFormatModalOpen(false);
      router.refresh();
      window.location.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "调整赛制失败，请重试");
    } finally {
      setChangingFormat(false);
    }
  }

  async function publish() {
    if (!event || !format || format.kind === "unsupported" || !activeStage || !done || publishing) return;
    setPublishing(true);
    setError("");
    try {
      const currentSchedule = await readJson<ScheduleState>(`/api/data/schedule?eventId=${encodeURIComponent(eventId)}`);
      // 资格赛发布：4 场对阵写入赛程，等待赛果确认后再开放入围赛抽签。
      if (format.kind === "staged-playin" && isPlayInStage) {
        const frozenTeamsNow = reg.teams.filter((team) => team.status === "已冻结");
        const playInIds = rankTeamsByAvgRank(frozenTeamsNow, reg.players)
          .slice(-format.playInTeams)
          .map((item) => item.id);
        const currentGate = resolvePlayInGate(format.playInStage, playInIds, currentSchedule.matches);
        if (currentGate.status !== "ready") {
          throw new Error("赛事阶段已经变化，请刷新页面后再操作。");
        }
        const startIndex = nextMatchStartIndex(currentSchedule.matches);
        const built = buildQualificationMatches(drawOrder, teamName, {
          startIndex,
          phase: format.playInStage.name,
          boType: format.playInStage.boType,
          advancingTeams: format.playInTeams / 2,
        });
        const nextFormat: StagedFormatState = {
          ...savedFormat,
          drawType: "staged-playin",
          stageConfigs: event.stageConfigs,
          playInDraw: { drawOrder, publishedAt: new Date().toISOString() },
        };
        const nextSchedule = appendMatchesOp(currentSchedule, built.matches, `${format.playInStage.name}抽签发布`);

        await writeJson(`/api/data/format?eventId=${encodeURIComponent(eventId)}`, nextFormat);
        await writeJson(`/api/data/schedule?eventId=${encodeURIComponent(eventId)}`, nextSchedule, currentSchedule.version);
        router.push(`/admin/events/${eventId}/schedule`);
        return;
      }

      if (format.kind === "staged-32-gsl-double-elim" || format.kind === "staged-playin") {
        if (activeStageIndex === null) throw new Error("当前阶段信息缺失，请刷新后重试。");
        const frozenTeamsNow = reg.teams.filter((team) => team.status === "已冻结");
        const frozenIds = frozenTeamsNow.map((team) => team.id);
        let entrants = frozenIds;
        /**
         * 资格赛还没全部打完时，缺的席位留成「待定」而不是把抽签卡住。
         * 缺几个由 `resolvePlayInGate` 给出，这里只负责接住 —— 不在调用方重新算一遍，
         * 算错会退化成轮空（语义完全不同：轮空是不打，待定是该打、只是对手没定）。
         */
        let pendingSlots = 0;
        if (format.kind === "staged-playin") {
          const playInIds = rankTeamsByAvgRank(frozenTeamsNow, reg.players)
            .slice(-format.playInTeams)
            .map((item) => item.id);
          const playInSet = new Set(playInIds);
          const playInResult = resolvePlayInGate(format.playInStage, playInIds, currentSchedule.matches);
          if (playInResult.status === "complete" || playInResult.status === "partial") {
            entrants = [...frozenIds.filter((id) => !playInSet.has(id)), ...playInResult.advancingTeamIds];
            if (playInResult.status === "partial") pendingSlots = playInResult.pendingCount;
          } else {
            throw new Error("资格赛还没有抽签，请先完成资格赛抽签。");
          }
        }
        const currentGate = resolveStagedDrawGate(format.stages, entrants, currentSchedule.matches, savedFormat.qualifierByes ?? []);
        if (currentGate.status !== "ready" || currentGate.stageIndex !== activeStageIndex) {
          throw new Error("赛事阶段已经变化，请刷新页面后再操作。");
        }

        const startIndex = nextMatchStartIndex(currentSchedule.matches);
        let stageMatches: ScheduleMatch[];
        let qualifierByes: string[] = [];
        /** 真正落进签位的抽签顺序：有待定席位时 = 原顺序 + 随机插入的占位符。 */
        let qualifierLineup = drawOrder;
        if (activeStageIndex === 0) {
          qualifierLineup = withPendingSlots(drawOrder, pendingSlots);
          const slots = buildQualifierSlots(qualifierLineup, format.stages[0].teamCount, format.stages[1].teamCount);
          const built = buildQualificationMatches(slots, teamName, {
            startIndex,
            phase: activeStage.name,
            boType: activeStage.boType,
            advancingTeams: format.stages[1].teamCount,
          });
          stageMatches = built.matches;
          qualifierByes = built.byes;
        } else if (activeStageIndex === 1) {
          // 小组赛两套打法在这里分流：**组内单败**只需要小组名单（组内对阵按种子位展开，
          // 一号对四号、二号对三号），GSL 还需要 8 场揭幕战对阵。
          stageMatches = activeStage.type === "single-elim-groups"
            ? buildGroupSingleElimMatches(groups, teamName, {
                startIndex,
                phase: activeStage.name,
                boType: activeStage.boType,
              })
            : buildGslGroupMatches(groups, generateMatchups(groups, pots), teamName, {
                startIndex,
                phase: activeStage.name,
                boType: activeStage.boType,
              });
        } else {
          stageMatches = buildDoubleEliminationMatches(drawOrder, teamName, {
            startIndex,
            phase: activeStage.name,
            boType: activeStage.boType,
          });
        }

        const kind = activeStageIndex === 0 ? "qualifier" : activeStageIndex === 1 ? "groups" : "knockout";
        const nextRecord = {
          stageIndex: activeStageIndex,
          kind,
          // 存「实际落位」的顺序（入围赛含待定占位符），而不是抽出来的那 31 个队 ——
          // 否则回看抽签记录时，待定席位会凭空消失、和已发布的赛程对不上。
          ...(drawMode === "slot" ? { drawOrder: qualifierLineup } : { seedPots: pots, groups }),
          publishedAt: new Date().toISOString(),
        } as const;
        const nextFormat: StagedFormatState = {
          ...savedFormat,
          drawType: "staged-32-gsl-double-elim",
          stageConfigs: event.stageConfigs,
          qualifierByes: activeStageIndex === 0 ? qualifierByes : savedFormat.qualifierByes,
          stageDraws: [
            ...(savedFormat.stageDraws ?? []).filter((record) => record.stageIndex !== activeStageIndex),
            nextRecord,
          ].sort((a, b) => a.stageIndex - b.stageIndex),
        };
        const nextSchedule = appendMatchesOp(currentSchedule, stageMatches, `${activeStage.name}抽签发布`);

        await writeJson(`/api/data/format?eventId=${encodeURIComponent(eventId)}`, nextFormat);
        await writeJson(`/api/data/schedule?eventId=${encodeURIComponent(eventId)}`, nextSchedule, currentSchedule.version);
        router.push(`/admin/events/${eventId}/schedule`);
        return;
      }

      const hasProgress = currentSchedule.matches.some((match) => match.startTime || match.status !== "待排期" || (match.gameResults?.length ?? 0) > 0);
      if (hasProgress) throw new Error("当前对阵已有排期或赛果。为避免覆盖真实数据，请先在赛程页确认并处理后再重新发布。");

      let matches: ScheduleMatch[];
      let nextFormat: StagedFormatState & { stageConfigs: EditableEvent["stageConfigs"] };
      if (format.kind === "slot-draw") {
        matches = format.bracket === "single-elim"
          ? buildSingleEliminationMatches(drawOrder, teamName, { phase: format.stage.name, boType: format.stage.boType })
          : buildDoubleEliminationMatches(drawOrder, teamName, { phase: format.stage.name, boType: format.stage.boType });
        nextFormat = { drawType: format.bracket, drawOrder, stageConfigs: event.stageConfigs };
      } else if (format.kind === "gsl-double-elim") {
        const matchups = generateMatchups(groups, pots);
        matches = buildTournamentMatches(groups, matchups, teamName, {
          groupBoType: format.groupStage.boType,
          knockoutBoType: format.knockoutStage.boType,
        });
        nextFormat = { drawType: "gsl-double-elim", seedPots: pots, groups, stageConfigs: event.stageConfigs };
      } else {
        throw new Error("当前赛制无法发布。");
      }

      await writeJson(`/api/data/format?eventId=${encodeURIComponent(eventId)}`, nextFormat);
      await writeJson(`/api/data/schedule?eventId=${encodeURIComponent(eventId)}`, {
        version: 1,
        matches,
        versions: [{ version: 1, matches, createdAt: new Date().toISOString(), note: "初始赛程（抽签发布）" }],
        requests: [],
        notifications: [],
      }, currentSchedule.version);
      router.push(`/admin/events/${eventId}/schedule`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "发布失败，请重试。");
      setPublishing(false);
    }
  }

  /**
   * 把资格赛新决出的胜者填进入围赛的待定席位。
   *
   * 只在「入围赛已带着待定席位发布 + 资格赛这下打完了」时可用（检测见初始化）。
   * **就地替换那几场里的一侧，其余对阵一个都不动** —— 已排期或已打完的比赛完全不碰，
   * 所以不会影响正在进行中的赛程。
   */
  async function fillPendingSlots() {
    if (!pendingFill || filling) return;
    setFilling(true);
    setError("");
    try {
      const current = await readJson<ScheduleState>(`/api/data/schedule?eventId=${encodeURIComponent(eventId)}`);
      const replacements = [...pendingFill.teamIds];
      let filled = 0;
      const matches = current.matches.map((match) => {
        if (match.teamAId !== PENDING && match.teamBId !== PENDING) return match;
        const incoming = replacements.shift();
        if (!incoming) return match;
        filled += 1;
        const aIsPending = match.teamAId === PENDING;
        return {
          ...match,
          teamAId: aIsPending ? incoming : match.teamAId,
          teamBId: aIsPending ? match.teamBId : incoming,
          teamAName: aIsPending ? teamName(incoming) : match.teamAName,
          teamBName: aIsPending ? match.teamBName : teamName(incoming),
        };
      });
      if (filled === 0) throw new Error("没有找到可补齐的待定席位，请刷新后重试。");
      await writeJson(
        `/api/data/schedule?eventId=${encodeURIComponent(eventId)}`,
        { ...current, matches },
        current.version,
      );
      setPendingFill(null);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "补齐失败，请重试。");
    } finally {
      setFilling(false);
    }
  }

  /**
   * 「调整赛制」必须能在**被拦住**的抽签页上点到 —— 赛制与报名规模不匹配时
   * 才有调整需求，而那时页面正好会走早退分支。这段提示让负责人不用先去数队伍。
   */
  const rosterHint = useMemo(() => {
    const active = reg.teams.filter((team) => team.status !== "已退赛");
    if (active.length === 0) return "";
    const complete = active.filter((team) =>
      reg.players.filter((player) => player.teamId === team.id && player.role === "首发").length >= 5,
    ).length;
    const frozen = active.filter((team) => team.status === "已冻结").length;
    return `当前 ${active.length} 支报名队伍：${complete} 支首发满 5 人，${frozen} 支已确认为正式名单。`;
  }, [reg]);

  function openFormatModal() {
    setTargetTemplate(event?.formatTemplateId ?? FORMAT_TEMPLATES[0].id);
    setFormatModalOpen(true);
  }

  // 两个弹窗挂在同一个节点里：它已经在三个分支（正常 / 早退 / 错误）各渲染一次，
  // 放这里就三处都拿得到，不用改三处 JSX。
  const formatModalNode = (
    <>
      {formatModalOpen && (
        <FormatChangeModal
          hint={rosterHint}
          targetTemplate={targetTemplate}
          onSelect={setTargetTemplate}
          onClose={() => setFormatModalOpen(false)}
          onConfirm={changeFormat}
          onCustom={() => { setFormatModalOpen(false); setCustomOpen(true); }}
          busy={changingFormat}
        />
      )}
      {customOpen && event && (
        <CustomFormatModal
          eventId={eventId}
          teams={(event.stageConfigs?.[0]?.teamCount) ?? event.teamCount ?? 0}
          stages={(event.stageConfigs ?? []).map((stage) => ({
            name: stage.name,
            type: stage.type,
            teamCount: stage.teamCount,
            boType: stage.boType,
          }))}
          onClose={() => setCustomOpen(false)}
          onSaved={() => { setCustomOpen(false); window.location.reload(); }}
        />
      )}
    </>
  );

  if (!loaded) {
    return <div className="adm-panel p-16 text-center text-[length:var(--adm-fs-lg)] text-[var(--adm-text-soft)]">加载抽签数据…</div>;
  }

  if (error && (!format || format.kind === "unsupported" || totalSlots === 0)) {
    return (
      <div>
        <AdminPageHeader eyebrow="模块 02" title="抽签" />
        <div className="adm-note adm-note--warn p-10 text-center">
          <p className="text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">{error}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={openFormatModal} className="adm-btn adm-btn--primary adm-btn--md hover:bg-[var(--adm-red-hover)]">调整赛制</button>
            <button onClick={() => router.push(`/admin/events/${eventId}/schedule`)} className="adm-btn adm-btn--secondary adm-btn--md">返回赛程</button>
          </div>
        </div>
        {formatModalNode}
      </div>
    );
  }

  const isStaged = format?.kind === "staged-32-gsl-double-elim" || format?.kind === "staged-playin";
  // 四阶段赛制的进度条要带上资格赛；且三阶段门控的 stageIndex 需整体后移一位。
  const stageList: StageConfig[] = format?.kind === "staged-playin"
    ? [format.playInStage, ...format.stages]
    : format?.kind === "staged-32-gsl-double-elim"
      ? format.stages
      : [];
  const progressOffset = format?.kind === "staged-playin" ? 1 : 0;
  const progressIndex = (index: number) => (isPlayInStage ? index : index + progressOffset);
  if (isStaged && stagedGate && stagedGate.status !== "ready") {
    const isComplete = stagedGate.status === "complete";
    return (
      <div>
        <AdminPageHeader
          eyebrow="模块 02"
          title={isComplete ? "全部阶段已完成" : `${stagedGate.stage.name}进行中`}
          status={isComplete ? "赛事完成" : stagedGate.status === "waiting" ? `${stagedGate.completedMatches} / ${stagedGate.totalMatches} 场完成` : "需要处理"}
          actions={
            <>
              <button type="button" onClick={openFormatModal} className="adm-btn adm-btn--secondary adm-btn--md">调整赛制</button>
              <button onClick={() => router.push(`/admin/events/${eventId}/schedule`)} className="adm-btn adm-btn--secondary adm-btn--md">返回赛程处理</button>
            </>
          }
        />
        <StageProgress stages={stageList} activeIndex={progressIndex(stagedGate.stageIndex)} complete={isComplete} />
        <div className={`p-8 text-center ${stagedGate.status === "blocked" ? "adm-note adm-note--warn" : "adm-panel"}`}>
          <p className="text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">{isComplete ? "全部阶段均已完成" : "下一阶段尚未解锁"}</p>
          <p className="mx-auto mt-2 max-w-2xl text-[length:var(--adm-fs-lg)] leading-[1.75] text-[var(--adm-text-soft)]">{stagedGate.message}</p>
        </div>
        {formatModalNode}
      </div>
    );
  }

  const drawTitle = activeStage ? `${activeStage.name}抽签` : drawMode === "groups" ? "分组抽签" : "对阵抽签";
  const playInTeams = format && format.kind === "staged-playin" ? format.playInTeams : 0;
  const drawDescription = isPlayInStage
    ? `最弱 ${playInTeams} 支 · 按段位同档互打 · ${playInTeams / 2} 场 ${activeStage?.boType ?? "BO1"}`
    : activeStageIndex === 0
      ? "32 支队伍 · 16 场 BO1"
      : activeStageIndex === 1
        ? "16 支队伍 · 四档种子池 · 每组各一队"
        : activeStageIndex === 2
          ? "小组第一对阵其他组第二 · 同组分列不同半区"
          : drawMode === "groups"
            ? "A—D 组 · 每组四队"
            : "相邻签位构成首轮对阵";

  return (
    <div>
      <AdminPageHeader
        eyebrow="模块 02"
        title={drawTitle}
        description={drawDescription}
        status={done ? "抽签完成" : `已抽 ${drawnCount} / ${totalSlots}`}
        actions={
          <>
            <button type="button" onClick={openFormatModal} disabled={done} className="adm-btn adm-btn--secondary adm-btn--md">调整赛制</button>
            <button onClick={() => router.push(`/admin/events/${eventId}/schedule`)} className="adm-btn adm-btn--secondary adm-btn--md">返回对阵图</button>
          </>
        }
      />

      {isStaged && activeStageIndex !== null && <StageProgress stages={stageList} activeIndex={progressIndex(activeStageIndex)} complete={false} />}

      {error && <div className="adm-note adm-note--danger mb-5 text-[length:var(--adm-fs-lg)] font-semibold">{error}</div>}

      {/* 补齐待定席位：故意放在 drawMode 分支之前 —— 这个场景下页面是 locked 的
          （入围赛已发布、还没打完），放分支里就永远看不到这个按钮。 */}
      {pendingFill && (
        <div className="adm-note adm-note--info mb-5 flex flex-wrap items-center justify-between gap-3">
          <span className="text-[length:var(--adm-fs-lg)] font-semibold">
            入围赛有 {pendingFill.count} 个待定席位，资格赛已全部结束，可以补齐了。
          </span>
          <button
            type="button"
            onClick={fillPendingSlots}
            disabled={filling}
            className="adm-btn adm-btn--primary adm-btn--md hover:bg-[var(--adm-red-hover)]"
          >
            {filling ? "正在补齐…" : `填入这 ${pendingFill.count} 支队伍`}
          </button>
        </div>
      )}

      {drawMode === "slot" ? (
        <div className="grid gap-5 xl:grid-cols-[280px_1fr]">
          <section className="adm-panel">
            <div className="border-b border-[var(--adm-line-soft)] px-5 py-4">
              <h2 className="text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">{activeStageIndex === 2 ? "小组赛晋级队伍" : "待抽队伍"}</h2>
            </div>
            <div className="space-y-1.5 p-4">
              {eligibleTeamIds.map((teamId) => {
                const position = drawOrder.indexOf(teamId);
                const qualifier = qualifiers.find((item) => item.teamId === teamId);
                return (
                  <div key={teamId} className={`flex items-center justify-between gap-3 border px-3 py-2 text-[length:var(--adm-fs-md)] ${lastTeamId === teamId ? "border-[var(--adm-red)] bg-[var(--adm-red-soft)] font-semibold text-[var(--adm-red-text)]" : position >= 0 ? "border-[var(--adm-line)] bg-[var(--adm-surface-2)] text-[var(--adm-text-soft)]" : "border-[var(--adm-line-soft)]"}`}>
                    <span className="truncate">{teamName(teamId)}</span>
                    <span className="shrink-0 text-[length:var(--adm-fs-xs)] tabular-nums text-[var(--adm-text-mute)]">{position >= 0 ? `签位 ${position + 1}` : qualifier ? `${qualifier.group}第${qualifier.placement}` : "待抽"}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="adm-panel">
            <div className="border-b border-[var(--adm-line-soft)] px-5 py-4">
              <h2 className="text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">{activeStageIndex === 2 ? "胜者组第一轮签位" : "首轮对阵签位"}</h2>
            </div>
            <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: totalSlots / 2 }, (_, matchIndex) => (
                <div key={matchIndex} className="border border-[var(--adm-line-soft)] bg-[var(--adm-surface-2)] p-3">
                  <p className="mb-2 text-[length:var(--adm-fs-sm)] font-medium text-[var(--adm-text-mute)]">首轮 {String(matchIndex + 1).padStart(2, "0")}</p>
                  {[0, 1].map((side) => {
                    const position = matchIndex * 2 + side;
                    const teamId = drawOrder[position];
                    return <div key={side} className={`mb-1 flex h-10 items-center border px-3 text-[length:var(--adm-fs-md)] font-semibold ${teamId ? "border-[var(--adm-line)] bg-[var(--adm-surface-2)] text-[var(--adm-text)]" : "border-dashed border-[var(--adm-line)] text-[var(--adm-text-mute)]"}`}>{teamId ? teamName(teamId) : <span className="tabular-nums">签位 {position + 1}</span>}</div>;
                  })}
                </div>
              ))}
            </div>
            <DrawActions publishLabel={`发布${activeStage?.name ?? "对阵"}`} done={done} publishing={publishing} remaining={slotQueue.length} onOne={drawOne} onAll={drawAll} onRedraw={redraw} onPublish={publish} lastText={lastTeamId && !done ? `→ ${teamName(lastTeamId)} 进入签位 ${drawOrder.indexOf(lastTeamId) + 1}` : ""} />
          </section>
        </div>
      ) : drawMode === "groups" ? (
        <div className="grid gap-5 xl:grid-cols-[280px_1fr]">
          <section className="adm-panel">
            <div className="border-b border-[var(--adm-line-soft)] px-5 py-4">
              <h2 className="text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">种子池</h2>
              <p className="mt-1 text-[length:var(--adm-fs-sm)] text-[var(--adm-text-mute)]">按首发平均段位分为四档</p>
            </div>
            <div className="space-y-4 p-4">
              {pots.map((pot) => (
                <div key={pot.name}>
                  <p className="mb-2 text-[length:var(--adm-fs-md)] font-bold text-[var(--adm-text-soft)]">{pot.name}</p>
                  <div className="space-y-1.5">
                    {pot.teamIds.map((teamId) => <div key={teamId} className={`border px-3 py-2 text-[length:var(--adm-fs-md)] ${lastTeamId === teamId ? "border-[var(--adm-red)] bg-[var(--adm-red-soft)] font-semibold text-[var(--adm-red-text)]" : drawnGroupIds.has(teamId) ? "border-[var(--adm-line)] bg-[var(--adm-surface-2)] text-[var(--adm-text-soft)]" : "border-[var(--adm-line-soft)]"}`}>{teamName(teamId)}</div>)}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="adm-panel">
            <div className="border-b border-[var(--adm-line-soft)] px-5 py-4">
              <h2 className="text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">小组签位</h2>
            </div>
            <div className="grid gap-4 p-5 md:grid-cols-4">
              {groups.map((group, groupIndex) => (
                <div key={group.name}>
                  <p className="mb-2 text-center text-[length:var(--adm-fs-md)] font-medium tracking-[0.12em] text-[var(--adm-text-soft)]">{group.name}</p>
                  <div className="space-y-2">
                    {[0, 1, 2, 3].map((position) => {
                      const teamId = group.teamIds[position];
                      const highlight = teamId && lastTeamId === teamId && lastGroupIndex === groupIndex;
                      return <div key={position} className={`flex h-[52px] items-center justify-center border px-3 text-[length:var(--adm-fs-lg)] ${highlight ? "border-[var(--adm-red)] bg-[var(--adm-red-soft)] font-semibold text-[var(--adm-red-text)]" : teamId ? "border-[var(--adm-line)] bg-[var(--adm-surface-2)] font-semibold text-[var(--adm-text)]" : "border-dashed border-[var(--adm-line-soft)] text-[var(--adm-text-mute)]"}`}>{teamId ? teamName(teamId) : <span className="text-[length:var(--adm-fs-xl)]">?</span>}</div>;
                    })}
                  </div>
                </div>
              ))}
            </div>
            <DrawActions publishLabel={`发布${activeStage?.name ?? "对阵"}`} done={done} publishing={publishing} remaining={groupQueue.length} onOne={drawOne} onAll={drawAll} onRedraw={redraw} onPublish={publish} lastText={lastTeamId && !done && lastGroupIndex !== null ? `→ ${teamName(lastTeamId)} 进入 ${groups[lastGroupIndex]?.name}` : ""} />
          </section>
        </div>
      ) : null}

      {formatModalNode}
    </div>
  );
}

/**
 * 调整赛制的弹窗。抽成独立组件是因为它要能出现在**被拦住**的抽签页上：
 * 赛制规模与报名队伍数不符时才有调整需求，而那一刻页面正好走早退分支，
 * 原先按钮只挂在正常抽签页的页头 → 最该用的时候反而找不到。
 */
function FormatChangeModal({
  hint,
  targetTemplate,
  onSelect,
  onClose,
  onConfirm,
  onCustom,
  busy,
}: {
  hint: string;
  targetTemplate: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  /** 自定义赛段链：交给父组件开编排器 */
  onCustom: () => void;
  busy: boolean;
}) {
  return (
    <AdminModal
      title="调整赛制"
      subtitle="报名人数与预期不符时，可在生成赛程前调整赛制；已生成赛程后将无法调整。"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onCustom} className="mr-auto adm-btn adm-btn--ghost adm-btn--md">自定义赛段链</button>
          <button type="button" onClick={onClose} className="adm-btn adm-btn--secondary adm-btn--md">取消</button>
          <button type="button" onClick={onConfirm} disabled={busy || !targetTemplate} className="adm-btn adm-btn--primary adm-btn--md">{busy ? "调整中…" : "确认调整"}</button>
        </>
      }
    >
      <>
        <div className="space-y-3 p-5">
          {hint && <p className="border border-[var(--adm-line-soft)] bg-white/[0.03] px-3 py-2.5 text-[length:var(--adm-fs-md)] font-bold leading-[1.65] text-[var(--adm-text-soft)]">{hint}</p>}
          {FORMAT_TEMPLATES.filter((template) => template.teamCount >= 8).map((template) => (
            <label key={template.id} className={`flex cursor-pointer items-start gap-3 border p-4 transition ${targetTemplate === template.id ? "border-[var(--adm-red)] bg-[var(--adm-red-soft)]" : "border-[var(--adm-line-soft)] bg-[var(--adm-surface)] hover:border-[var(--adm-text)]"}`}>
              <input type="radio" name="template" value={template.id} checked={targetTemplate === template.id} onChange={() => onSelect(template.id)} className="mt-0.5" />
              <span className="min-w-0">
                <span className="block text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">{template.name}</span>
                <span className="mt-1 block text-[length:var(--adm-fs-md)] leading-[1.65] text-[var(--adm-text-soft)]">{template.description}</span>
              </span>
            </label>
          ))}
        </div>
      </>
    </AdminModal>
  );
}

function DrawActions({
  publishLabel,
  done,
  publishing,
  remaining,
  onOne,
  onAll,
  onRedraw,
  onPublish,
  lastText,
}: {
  publishLabel: string;
  done: boolean;
  publishing: boolean;
  remaining: number;
  onOne: () => void;
  onAll: () => void;
  onRedraw: () => void;
  onPublish: () => void;
  lastText: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-4 border-t border-[var(--adm-line-soft)] p-6">
      {done ? (
        <>
          <button onClick={onPublish} disabled={publishing} className="adm-btn adm-btn--primary adm-btn--lg hover:bg-[var(--adm-red-hover)]">{publishing ? "发布中…" : publishLabel}</button>
          <button onClick={onRedraw} className="adm-btn adm-btn--secondary adm-btn--lg">重新抽签</button>
        </>
      ) : (
        <>
          <button onClick={onOne} disabled={remaining === 0} className="adm-btn adm-btn--primary adm-btn--lg hover:bg-[var(--adm-red-hover)]">抽下一队</button>
          <button onClick={onAll} disabled={remaining === 0} className="adm-btn adm-btn--secondary adm-btn--lg">一键抽完</button>
          <button onClick={onRedraw} className="adm-btn adm-btn--ghost adm-btn--md hover:text-[var(--adm-red-text)]">重新开始</button>
        </>
      )}
      {lastText && <p className="w-full text-center text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-red-text)]">{lastText}</p>}
    </div>
  );
}

function StageProgress({ stages, activeIndex, complete }: { stages: StageConfig[]; activeIndex: number; complete: boolean }) {
  return (
    <div className="mb-5 grid adm-panel sm:grid-cols-3">
      {stages.map((stage, index) => {
        const finished = complete || index < activeIndex;
        const active = !complete && index === activeIndex;
        const label = finished ? "已完成" : active ? "当前阶段" : "未解锁";
        return (
          <div key={`${stage.name}-${index}`} className={`flex items-center gap-3 px-4 py-4 ${index > 0 ? "border-t border-[var(--adm-line-soft)] sm:border-l sm:border-t-0" : ""}`}>
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center text-[length:var(--adm-fs-md)] font-medium ${finished ? "border border-[var(--adm-text-soft)] bg-transparent text-[var(--adm-text)]" : active ? "bg-[var(--adm-red)] text-white" : "bg-[var(--adm-surface-3)] text-[var(--adm-text-mute)]"}`}>{String(index + 1).padStart(2, "0")}</span>
            <div className="min-w-0">
              <p className={`truncate text-[length:var(--adm-fs-lg)] font-semibold ${active ? "text-[var(--adm-red-text)]" : "text-[var(--adm-text)]"}`}>{stage.name}</p>
              <p className="mt-0.5 text-[length:var(--adm-fs-sm)] font-bold text-[var(--adm-text-mute)]">{label} · {stage.teamCount} 队 · {stage.boType}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
