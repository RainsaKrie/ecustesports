"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { buildSeedPots, generateMatchups, type Group, type SeedPot } from "@/lib/scheduling/format-data";
import {
  buildDoubleEliminationMatches,
  buildGslGroupMatches,
  buildQualificationMatches,
  buildSingleEliminationMatches,
  buildTournamentMatches,
} from "@/lib/scheduling/bracket-engine";
import { resolveSupportedFormat, type SupportedFormat } from "@/lib/scheduling/format-support";
import { initialRegistration, type RegistrationState } from "@/lib/scheduling/registration-data";
import type { ScheduleMatch, ScheduleState } from "@/lib/scheduling/schedule-data";
import { appendMatchesOp } from "@/lib/scheduling/schedule-ops";
import {
  buildKnockoutDrawOrder,
  buildQualifierSlots,
  nextMatchStartIndex,
  resolveStagedDrawGate,
  type GroupQualifier,
  type StagedDrawGate,
  type StagedFormatState,
} from "@/lib/scheduling/staged-format";
import type { StageConfig } from "@/lib/scheduling/format-templates";
import { FORMAT_TEMPLATES } from "@/lib/scheduling/format-templates";
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
  const [activeStage, setActiveStage] = useState<StageConfig | null>(null);
  const [activeStageIndex, setActiveStageIndex] = useState<number | null>(null);
  const [eligibleTeamIds, setEligibleTeamIds] = useState<string[]>([]);
  const [qualifiers, setQualifiers] = useState<GroupQualifier[]>([]);
  const [stagedGate, setStagedGate] = useState<StagedDrawGate | null>(null);
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
  const [targetTemplate, setTargetTemplate] = useState("");
  const [changingFormat, setChangingFormat] = useState(false);

  const teamName = useMemo(() => {
    const names = new Map(reg.teams.map((team) => [team.id, team.name]));
    return (teamId: string) => names.get(teamId) ?? "待定";
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

      if (resolved.kind === "staged-32-gsl-double-elim") {
        const gate = resolveStagedDrawGate(resolved.stages, frozenIds, loadedSchedule.matches, loadedFormat.qualifierByes ?? []);
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
      } else {
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
  const totalSlots = drawMode === "locked" ? 0 : eligibleTeamIds.length;
  const drawnCount = drawMode === "slot" ? drawOrder.length : drawMode === "groups" ? drawnGroupIds.size : 0;
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
      setSlotQueue(activeStageIndex === 2 && qualifiers.length === 8
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
      if (format.kind === "staged-32-gsl-double-elim") {
        if (activeStageIndex === null) throw new Error("当前阶段信息缺失，请刷新后重试。");
        const frozenIds = reg.teams.filter((team) => team.status === "已冻结").map((team) => team.id);
        const currentGate = resolveStagedDrawGate(format.stages, frozenIds, currentSchedule.matches, savedFormat.qualifierByes ?? []);
        if (currentGate.status !== "ready" || currentGate.stageIndex !== activeStageIndex) {
          throw new Error("赛事阶段已经变化，请刷新页面后再操作。");
        }

        const startIndex = nextMatchStartIndex(currentSchedule.matches);
        let stageMatches: ScheduleMatch[];
        let qualifierByes: string[] = [];
        if (activeStageIndex === 0) {
          const slots = buildQualifierSlots(drawOrder, format.stages[0].teamCount, format.stages[1].teamCount);
          const built = buildQualificationMatches(slots, teamName, {
            startIndex,
            phase: activeStage.name,
            boType: activeStage.boType,
            advancingTeams: format.stages[1].teamCount,
          });
          stageMatches = built.matches;
          qualifierByes = built.byes;
        } else if (activeStageIndex === 1) {
          stageMatches = buildGslGroupMatches(groups, generateMatchups(groups, pots), teamName, {
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
          ...(drawMode === "slot" ? { drawOrder } : { seedPots: pots, groups }),
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

  if (!loaded) {
    return <div className="border border-slate-200 bg-white p-16 text-center text-sm text-slate-500">加载抽签数据…</div>;
  }

  if (error && (!format || format.kind === "unsupported" || totalSlots === 0)) {
    return (
      <div>
        <AdminPageHeader eyebrow="MODULE 02 / DRAW" title="抽签" />
        <div className="border border-amber-200 bg-amber-50 p-10 text-center">
          <p className="text-sm font-bold text-amber-900">{error}</p>
          <button onClick={() => router.push(`/admin/events/${eventId}/schedule`)} className="mt-5 border border-amber-300 bg-white px-4 py-2.5 text-xs font-bold text-amber-900">返回赛程</button>
        </div>
      </div>
    );
  }

  const isStaged = format?.kind === "staged-32-gsl-double-elim";
  if (isStaged && stagedGate && stagedGate.status !== "ready") {
    const isComplete = stagedGate.status === "complete";
    return (
      <div>
        <AdminPageHeader
          eyebrow="MODULE 02 / STAGED DRAW"
          title={isComplete ? "全部阶段已完成" : `${stagedGate.stage.name}进行中`}
          status={isComplete ? "赛事完成" : stagedGate.status === "waiting" ? `${stagedGate.completedMatches} / ${stagedGate.totalMatches} 场完成` : "需要处理"}
          actions={<button onClick={() => router.push(`/admin/events/${eventId}/schedule`)} className="border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:border-slate-950">返回赛程处理</button>}
        />
        <StageProgress stages={format.stages} activeIndex={stagedGate.stageIndex} complete={isComplete} />
        <div className={`border p-8 text-center ${stagedGate.status === "blocked" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}>
          <p className="text-base font-black text-slate-950">{isComplete ? "三个阶段均已完成" : "下一阶段尚未解锁"}</p>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-slate-600">{stagedGate.message}</p>
        </div>
      </div>
    );
  }

  const drawTitle = activeStage ? `${activeStage.name}抽签` : drawMode === "groups" ? "分组抽签" : "对阵抽签";
  const drawDescription = activeStageIndex === 0
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
        eyebrow="MODULE 02 / DRAW"
        title={drawTitle}
        description={drawDescription}
        status={done ? "抽签完成" : `已抽 ${drawnCount} / ${totalSlots}`}
        actions={
          <>
            <button type="button" onClick={() => { setTargetTemplate(event?.formatTemplateId ?? FORMAT_TEMPLATES[0].id); setFormatModalOpen(true); }} disabled={done} className="border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:border-slate-950 disabled:cursor-not-allowed disabled:opacity-40">调整赛制</button>
            <button onClick={() => router.push(`/admin/events/${eventId}/schedule`)} className="border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:border-slate-950">返回对阵图</button>
          </>
        }
      />

      {isStaged && activeStageIndex !== null && <StageProgress stages={format.stages} activeIndex={activeStageIndex} complete={false} />}

      {error && <div className="mb-5 border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>}

      {drawMode === "slot" ? (
        <div className="grid gap-5 xl:grid-cols-[280px_1fr]">
          <section className="border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-sm font-black text-slate-950">{activeStageIndex === 2 ? "小组赛晋级队伍" : "待抽队伍"}</h2>
            </div>
            <div className="space-y-1.5 p-4">
              {eligibleTeamIds.map((teamId) => {
                const position = drawOrder.indexOf(teamId);
                const qualifier = qualifiers.find((item) => item.teamId === teamId);
                return (
                  <div key={teamId} className={`flex items-center justify-between gap-3 border px-3 py-2 text-xs ${lastTeamId === teamId ? "border-[#ff4655] bg-[#fff1f2] font-black text-[#c83242]" : position >= 0 ? "border-emerald-200 bg-emerald-50 text-slate-500" : "border-slate-200"}`}>
                    <span className="truncate">{teamName(teamId)}</span>
                    <span className="shrink-0 font-mono text-[0.5625rem]">{position >= 0 ? `签位 ${position + 1}` : qualifier ? `${qualifier.group}第${qualifier.placement}` : "待抽"}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-sm font-black text-slate-950">{activeStageIndex === 2 ? "胜者组第一轮签位" : "首轮对阵签位"}</h2>
            </div>
            <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: totalSlots / 2 }, (_, matchIndex) => (
                <div key={matchIndex} className="border border-slate-200 bg-slate-50 p-3">
                  <p className="mb-2 font-mono text-[0.625rem] font-black text-slate-400">首轮 {String(matchIndex + 1).padStart(2, "0")}</p>
                  {[0, 1].map((side) => {
                    const position = matchIndex * 2 + side;
                    const teamId = drawOrder[position];
                    return <div key={side} className={`mb-1 flex h-10 items-center border px-3 text-xs font-bold ${teamId ? "border-emerald-200 bg-white text-slate-900" : "border-dashed border-slate-300 text-slate-300"}`}>{teamId ? teamName(teamId) : `签位 ${position + 1}`}</div>;
                  })}
                </div>
              ))}
            </div>
            <DrawActions publishLabel={`发布${activeStage?.name ?? "对阵"}`} done={done} publishing={publishing} remaining={slotQueue.length} onOne={drawOne} onAll={drawAll} onRedraw={redraw} onPublish={publish} lastText={lastTeamId && !done ? `→ ${teamName(lastTeamId)} 进入签位 ${drawOrder.indexOf(lastTeamId) + 1}` : ""} />
          </section>
        </div>
      ) : drawMode === "groups" ? (
        <div className="grid gap-5 xl:grid-cols-[280px_1fr]">
          <section className="border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-sm font-black text-slate-950">种子池</h2>
              <p className="mt-1 text-[0.625rem] text-slate-400">按首发平均段位分为四档</p>
            </div>
            <div className="space-y-4 p-4">
              {pots.map((pot) => (
                <div key={pot.name}>
                  <p className="mb-2 text-xs font-bold text-slate-700">{pot.name}</p>
                  <div className="space-y-1.5">
                    {pot.teamIds.map((teamId) => <div key={teamId} className={`border px-3 py-2 text-xs ${lastTeamId === teamId ? "border-[#ff4655] bg-[#fff1f2] font-black text-[#c83242]" : drawnGroupIds.has(teamId) ? "border-emerald-200 bg-emerald-50 text-slate-500" : "border-slate-200"}`}>{teamName(teamId)}</div>)}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-sm font-black text-slate-950">小组签位</h2>
            </div>
            <div className="grid gap-4 p-5 md:grid-cols-4">
              {groups.map((group, groupIndex) => (
                <div key={group.name}>
                  <p className="mb-2 text-center font-mono text-xs font-black tracking-[0.12em] text-slate-500">{group.name}</p>
                  <div className="space-y-2">
                    {[0, 1, 2, 3].map((position) => {
                      const teamId = group.teamIds[position];
                      const highlight = teamId && lastTeamId === teamId && lastGroupIndex === groupIndex;
                      return <div key={position} className={`flex h-12 items-center justify-center border px-3 text-sm ${highlight ? "border-[#ff4655] bg-[#fff1f2] font-black text-[#c83242]" : teamId ? "border-emerald-200 bg-emerald-50 font-bold text-slate-900" : "border-dashed border-slate-200 text-slate-300"}`}>{teamId ? teamName(teamId) : <span className="font-mono text-lg">?</span>}</div>;
                    })}
                  </div>
                </div>
              ))}
            </div>
            <DrawActions publishLabel={`发布${activeStage?.name ?? "对阵"}`} done={done} publishing={publishing} remaining={groupQueue.length} onOne={drawOne} onAll={drawAll} onRedraw={redraw} onPublish={publish} lastText={lastTeamId && !done && lastGroupIndex !== null ? `→ ${teamName(lastTeamId)} 进入 ${groups[lastGroupIndex]?.name}` : ""} />
          </section>
        </div>
      ) : null}

      {formatModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-4" role="dialog" aria-modal="true">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto border border-slate-300 bg-[#f8f6f1] shadow-2xl">
            <div className="flex items-start justify-between gap-5 border-b border-slate-200 bg-white px-5 py-4">
              <div>
                <h2 className="text-base font-black text-slate-950">调整赛制</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">报名人数与预期不符时，可在生成赛程前调整赛制；已生成赛程后将无法调整。</p>
              </div>
              <button type="button" onClick={() => setFormatModalOpen(false)} className="shrink-0 text-xs font-bold text-slate-400 hover:text-slate-900">关闭</button>
            </div>
            <div className="space-y-3 p-5">
              {FORMAT_TEMPLATES.filter((template) => template.teamCount >= 8).map((template) => (
                <label key={template.id} className={`flex cursor-pointer items-start gap-3 border p-4 transition ${targetTemplate === template.id ? "border-[#ff4655] bg-[#fff1f2]" : "border-slate-200 bg-white hover:border-slate-400"}`}>
                  <input type="radio" name="template" value={template.id} checked={targetTemplate === template.id} onChange={() => setTargetTemplate(template.id)} className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="block text-sm font-black text-slate-900">{template.name}</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">{template.description}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4">
              <button type="button" onClick={() => setFormatModalOpen(false)} className="border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-600">取消</button>
              <button type="button" onClick={changeFormat} disabled={changingFormat || !targetTemplate} className="bg-[#ff4655] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50">{changingFormat ? "调整中…" : "确认调整"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
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
    <div className="flex flex-wrap items-center justify-center gap-4 border-t border-slate-200 p-6">
      {done ? (
        <>
          <button onClick={onPublish} disabled={publishing} className="bg-[#ff4655] px-10 py-4 text-base font-black text-white hover:bg-[#d83b48] disabled:opacity-60">{publishing ? "发布中…" : publishLabel}</button>
          <button onClick={onRedraw} className="border border-slate-300 px-8 py-4 text-sm font-bold text-slate-600 hover:border-slate-950">重新抽签</button>
        </>
      ) : (
        <>
          <button onClick={onOne} disabled={remaining === 0} className="bg-[#ff4655] px-10 py-4 text-base font-black text-white hover:bg-[#d83b48] disabled:opacity-60">抽下一队</button>
          <button onClick={onAll} disabled={remaining === 0} className="border border-slate-300 px-8 py-4 text-sm font-bold text-slate-600 hover:border-slate-950">一键抽完</button>
          <button onClick={onRedraw} className="text-xs font-bold text-slate-400 hover:text-[#c83242]">重新开始</button>
        </>
      )}
      {lastText && <p className="w-full text-center text-sm font-black text-[#c83242]">{lastText}</p>}
    </div>
  );
}

function StageProgress({ stages, activeIndex, complete }: { stages: [StageConfig, StageConfig, StageConfig]; activeIndex: number; complete: boolean }) {
  return (
    <div className="mb-5 grid border border-slate-200 bg-white sm:grid-cols-3">
      {stages.map((stage, index) => {
        const finished = complete || index < activeIndex;
        const active = !complete && index === activeIndex;
        const label = finished ? "已完成" : active ? "当前阶段" : "未解锁";
        return (
          <div key={`${stage.name}-${index}`} className={`flex items-center gap-3 px-4 py-4 ${index > 0 ? "border-t border-slate-200 sm:border-l sm:border-t-0" : ""}`}>
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center font-mono text-xs font-black ${finished ? "bg-emerald-600 text-white" : active ? "bg-[#ff4655] text-white" : "bg-slate-100 text-slate-400"}`}>{String(index + 1).padStart(2, "0")}</span>
            <div className="min-w-0">
              <p className={`truncate text-sm font-black ${active ? "text-[#c83242]" : "text-slate-900"}`}>{stage.name}</p>
              <p className="mt-0.5 text-[0.625rem] font-bold text-slate-400">{label} · {stage.teamCount} 队 · {stage.boType}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
