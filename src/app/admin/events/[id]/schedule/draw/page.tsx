"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { buildSeedPots, drawGroups, generateMatchups, type Group, type SeedPot } from "@/lib/scheduling/format-data";
import { buildTournamentMatches } from "@/lib/scheduling/bracket";
import type { RegistrationState } from "@/lib/scheduling/registration-data";
import { initialRegistration } from "@/lib/scheduling/registration-data";
import type { ScheduleMatch } from "@/lib/scheduling/schedule-data";

interface DrawPageProps {
  params: Promise<{ id: string }>;
}

interface DrawQueueItem {
  teamId: string;
  potIndex: number;
  groupIndex: number;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function DrawPage({ params }: DrawPageProps) {
  const { id } = use(params);
  const router = useRouter();

  const [reg, setReg] = useState<RegistrationState>(initialRegistration());
  const [loaded, setLoaded] = useState(false);
  const [pots, setPots] = useState<SeedPot[]>([]);
  const [queue, setQueue] = useState<DrawQueueItem[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [lastDraw, setLastDraw] = useState<DrawQueueItem | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");

  const teamName = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of reg.teams) map.set(t.id, t.name);
    return (teamId: string) => map.get(teamId) ?? "待定";
  }, [reg.teams]);

  const drawnTeamIds = useMemo(() => {
    const set = new Set<string>();
    groups.forEach((g) => g.teamIds.forEach((tid) => set.add(tid)));
    return set;
  }, [groups]);

  const totalSlots = pots.length * 4;
  const drawnCount = drawnTeamIds.size;
  const done = totalSlots > 0 && drawnCount >= totalSlots;

  // 初始化：读报名与赛制数据，恢复或准备抽签
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const regRes = await fetch(`/api/data/registration?eventId=${encodeURIComponent(id)}`);
      const regData = (await regRes.json()) as RegistrationState;
      const fmtRes = await fetch(`/api/data/format?eventId=${encodeURIComponent(id)}`);
      const fmtData = (await fmtRes.json()) as { seedPots?: SeedPot[]; groups?: Group[] };
      if (cancelled) return;

      setReg(regData);

      const frozenTeams = regData.teams.filter((t) => t.status === "已冻结");
      let seedPots = fmtData.seedPots ?? [];
      let existingGroups = fmtData.groups ?? [];

      if (seedPots.length === 0 && frozenTeams.length > 0) {
        seedPots = buildSeedPots(frozenTeams, regData.players);
      }
      if (seedPots.length === 0) {
        setError(frozenTeams.length === 0 ? "还没有队伍。请先在「报名与队伍」中完成报名并截止。" : "需要 16 支队伍才能进行小组赛抽签（当前不支持其他规模的抽签）。");
        setLoaded(true);
        return;
      }

      // 已有部分抽签结果：重建队列（剩余未抽的队）
      const groupNames = ["A 组", "B 组", "C 组", "D 组"];
      const groupsInit = groupNames.map((name, i) => ({ name, teamIds: existingGroups[i]?.teamIds ?? [] }));
      const nextQueue: DrawQueueItem[] = [];
      seedPots.forEach((pot, potIndex) => {
        const remaining = shuffle(pot.teamIds.filter((tid) => !groupsInit.some((g) => g.teamIds.includes(tid))));
        remaining.forEach((teamId, slot) => {
          // 找到该队应去的组：该组该池位置为空
          const target = groupsInit.find((g) => g.teamIds.length <= potIndex);
          if (target) {
            nextQueue.push({ teamId, potIndex, groupIndex: groupNames.indexOf(target.name) });
          }
        });
      });

      setPots(seedPots);
      setGroups(groupsInit);
      setQueue(nextQueue);
      setLoaded(true);
    })().catch(() => {
      if (!cancelled) {
        setError("数据读取失败，请刷新重试。");
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  function drawOne() {
    if (queue.length === 0 || done) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    setLastDraw(next);
    setGroups((gs) => gs.map((g, i) => (i === next.groupIndex ? { ...g, teamIds: [...g.teamIds, next.teamId] } : g)));
  }

  function drawAll() {
    if (queue.length === 0 || done) return;
    const nextGroups = groups.map((g) => ({ ...g, teamIds: [...g.teamIds] }));
    for (const item of queue) {
      nextGroups[item.groupIndex].teamIds.push(item.teamId);
    }
    setGroups(nextGroups);
    setQueue([]);
    setLastDraw(null);
  }

  async function publish() {
    if (!done || publishing) return;
    setPublishing(true);
    try {
      // 发布格式（种子池 + 分组 + 首轮对阵）
      const matchups = generateMatchups(groups, pots);
      await fetch(`/api/data/format?eventId=${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seedPots: pots, groups, matchups }),
      });
      // 生成完整赛程并发布
      const matches: ScheduleMatch[] = buildTournamentMatches(groups, matchups, teamName);
      const schedRes = await fetch(`/api/data/schedule?eventId=${encodeURIComponent(id)}`);
      const schedData = (await schedRes.json()) as { version?: number; matches?: ScheduleMatch[]; versions?: unknown[]; requests?: unknown[]; notifications?: unknown[] };
      const base = {
        version: 1,
        matches: [] as ScheduleMatch[],
        versions: [{ version: 1, createdAt: new Date().toISOString(), note: "初始赛程（抽签发布）" }],
        requests: [],
        notifications: [],
      };
      const nextSched = {
        ...base,
        ...schedData,
        matches,
        versions: [{ version: 1, createdAt: new Date().toISOString(), note: "初始赛程（抽签发布）" }],
      };
      await fetch(`/api/data/schedule?eventId=${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextSched),
      });
      router.push(`/admin/events/${id}/schedule`);
    } catch {
      setError("发布失败，请重试。");
      setPublishing(false);
    }
  }

  function redraw() {
    // 重新抽：清空分组与队列，重新建队
    const groupNames = ["A 组", "B 组", "C 组", "D 组"];
    const emptyGroups = groupNames.map((name) => ({ name, teamIds: [] as string[] }));
    const nextQueue: DrawQueueItem[] = [];
    pots.forEach((pot, potIndex) => {
      shuffle(pot.teamIds).forEach((teamId, slot) => {
        nextQueue.push({ teamId, potIndex, groupIndex: slot });
      });
    });
    setGroups(emptyGroups);
    setQueue(nextQueue);
    setLastDraw(null);
  }

  if (!loaded) {
    return <div className="border border-slate-200 bg-white p-16 text-center text-sm text-slate-500">加载抽签数据…</div>;
  }

  if (error) {
    return (
      <div>
        <AdminPageHeader eyebrow="MODULE 03 / DRAW" title="抽签" description="小组赛抽签面板（直播投屏）" />
        <div className="border border-slate-200 bg-white p-16 text-center">
          <p className="text-sm font-bold text-slate-700">{error}</p>
        </div>
      </div>
    );
  }

  const drawnInPot = (potIndex: number) =>
    pots[potIndex].teamIds.filter((tid) => drawnTeamIds.has(tid)).length;

  return (
    <div>
      <AdminPageHeader
        eyebrow="MODULE 03 / DRAW"
        title="抽签"
        description="裁判直播投屏用。点「抽下一队」逐队揭示，或「一键抽完」快速完成。"
        status={done ? "抽签完成" : `已抽 ${drawnCount} / ${totalSlots}`}
        actions={
          <button onClick={() => router.push(`/admin/events/${id}/schedule`)} className="border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:border-slate-950">
            返回对阵图
          </button>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[280px_1fr]">
        {/* 种子池 */}
        <section className="border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-sm font-black text-slate-950">种子池</h2>
            <p className="mt-1 text-[0.625rem] text-slate-400">按首发平均段位分档</p>
          </div>
          <div className="space-y-4 p-4">
            {pots.map((pot, potIndex) => (
              <div key={pot.name}>
                <p className="mb-2 flex items-center justify-between text-xs font-bold text-slate-700">
                  <span>{pot.name}</span>
                  <span className="font-mono text-[0.625rem] text-slate-400">{drawnInPot(potIndex)}/{pot.teamIds.length}</span>
                </p>
                <div className="space-y-1.5">
                  {pot.teamIds.map((tid) => {
                    const drawn = drawnTeamIds.has(tid);
                    const isLast = lastDraw?.teamId === tid;
                    return (
                      <div
                        key={tid}
                        className={`flex items-center justify-between border px-3 py-2 text-xs transition-all ${isLast ? "scale-105 border-[#ff4655] bg-[#fff1f2] font-black text-[#c83242]" : drawn ? "border-emerald-200 bg-emerald-50 text-slate-500" : "border-slate-200 bg-white text-slate-900"}`}
                      >
                        <span className="truncate">{teamName(tid)}</span>
                        <span className="font-mono text-[0.5625rem] text-slate-400">{drawn ? "已入组" : ""}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 分组对阵图 */}
        <section className="border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-sm font-black text-slate-950">分组</h2>
            <p className="mt-1 text-[0.625rem] text-slate-400">每组从四个种子池各抽 1 队</p>
          </div>
          <div className="grid gap-4 p-5 md:grid-cols-4">
            {groups.map((group) => (
              <div key={group.name}>
                <p className="mb-2 text-center font-mono text-xs font-black tracking-[0.12em] text-slate-500">{group.name}</p>
                <div className="space-y-2">
                  {[0, 1, 2, 3].map((slot) => {
                    const tid = group.teamIds[slot];
                    const isLast = tid && lastDraw?.teamId === tid && lastDraw?.groupIndex === groups.indexOf(group);
                    return (
                      <div
                        key={slot}
                        className={`flex h-12 items-center justify-center border px-3 text-sm transition-all ${isLast ? "scale-105 border-[#ff4655] bg-[#fff1f2] font-black text-[#c83242]" : tid ? "border-emerald-200 bg-emerald-50 font-bold text-slate-900" : "border-dashed border-slate-200 text-slate-300"}`}
                      >
                        {tid ? <span className="truncate">{teamName(tid)}</span> : <span className="font-mono text-lg">?</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* 抽签操作区 */}
          <div className="flex flex-wrap items-center justify-center gap-4 border-t border-slate-200 p-6">
            {done ? (
              <>
                <button onClick={publish} disabled={publishing} className="bg-[#ff4655] px-10 py-4 text-base font-black text-white transition hover:bg-[#d83b48] disabled:opacity-60">
                  {publishing ? "发布中…" : "发布对阵"}
                </button>
                <button onClick={redraw} className="border border-slate-300 px-8 py-4 text-sm font-bold text-slate-600 hover:border-slate-950">重新抽签</button>
              </>
            ) : (
              <>
                <button onClick={drawOne} disabled={queue.length === 0} className="bg-[#ff4655] px-10 py-4 text-base font-black text-white transition hover:bg-[#d83b48] disabled:opacity-60">
                  抽下一队
                </button>
                <button onClick={drawAll} disabled={queue.length === 0} className="border border-slate-300 px-8 py-4 text-sm font-bold text-slate-600 hover:border-slate-950">一键抽完</button>
                <button onClick={redraw} className="text-xs font-bold text-slate-400 hover:text-[#c83242]">重新开始</button>
              </>
            )}
            {lastDraw && !done && (
              <p className="w-full text-center text-sm font-black text-[#c83242]">
                → {teamName(lastDraw.teamId)} 进入 {groups[lastDraw.groupIndex]?.name}
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
