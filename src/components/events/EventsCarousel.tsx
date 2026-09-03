"use client";

import { useState } from "react";
import Image from "next/image";
import { EsportEvent } from "@/types";
import { getStatusInfo } from "@/lib/utils";
import { STAGE_CONFIGS, type EventStage } from "@/lib/scheduling/stage";
import { useParticipant } from "@/lib/scheduling/useParticipant";
import Button from "@/components/ui/Button";

interface Props {
  events: EsportEvent[];
  height?: string;
  stage?: EventStage;
}

export default function EventsCarousel({ events, height = "min-h-screen", stage = "筹备" }: Props) {
  // active 用索引表示，列表 永远按 events 数组顺序排（不重排）
  const [activeIndex, setActiveIndex] = useState(0);
  const total = events.length;
  const active = events[activeIndex];
  const stageConfig = STAGE_CONFIGS[stage];
  const primaryHref = stageConfig.ctaHref.replace("{id}", active.id);
  const participant = useParticipant(active.id);
  const participantTeamHref = `/events/${active.id}/manage?section=team`;
  const participantPrimary = stage === "报名" && Boolean(participant.data);
  const resolvedPrimaryHref = participantPrimary ? participantTeamHref : primaryHref;
  const resolvedPrimaryLabel = participantPrimary
    ? participant.data?.team ? "我的队伍" : "创建或加入队伍"
    : stageConfig.cta;
  const primaryOpensEventDetail = resolvedPrimaryHref === `/events/${active.id}`
    || resolvedPrimaryHref.startsWith(`/events/${active.id}?`);

  // prev/next 按列表当前顺序 ±1，循环
  const prev = () => setActiveIndex((i) => (i - 1 + total) % total);
  const next = () => setActiveIndex((i) => (i + 1) % total);
  // 点击缩略图：直接跳到对应索引（不重排）
  const select = (id: string) => setActiveIndex(events.findIndex((e) => e.id === id));

  return (
    <>
      <style>{`
        @keyframes fadeInActive {
          from { opacity: 0.35; transform: scale(0.96); }
          to { opacity: 1; transform: scale(1); }
        }
        .animate-active-in {
          animation: fadeInActive 380ms cubic-bezier(0.22, 1, 0.36, 1);
        }
      `}</style>

      <div className={`relative ${height} overflow-hidden bg-[#0a1318] text-white`}>
        {/* 海报铺满全屏 */}
        {active.posterImage ? (
          <>
            <Image
              key={`${active.id}-poster`}
              src={active.posterImage}
              alt={`${active.name} 宣传海报`}
              fill
              priority
              sizes="100vw"
              className="object-cover transition-opacity duration-700"
            />
            <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-[#0a1318]/95 via-[#0a1318]/55 to-transparent" />
            <div aria-hidden className="absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-[#0a1318] via-[#0a1318]/85 to-transparent" />
          </>
        ) : (
          <div
            aria-hidden
            className="absolute inset-0 transition-[background] duration-700"
            style={{
              background: `radial-gradient(ellipse at 30% 40%, ${active.coverColor}77 0%, transparent 55%), linear-gradient(180deg, ${active.coverColor}22 0%, #0a1318 80%)`,
            }}
          />
        )}

        {/* 顶部条（仅多届赛事时显示序号） */}
        {total > 1 && (
          <div className="absolute inset-x-0 top-0 z-10 px-8 py-6 md:px-24 md:py-8">
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs font-bold text-white/90">
                {String(activeIndex + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
              </span>
            </div>
          </div>
        )}

        {/* 左箭头：垂直居中 */}
        {total > 1 && (
          <button
            type="button"
            onClick={prev}
            aria-label="上一届"
            className="absolute left-10 top-1/2 z-10 grid h-14 w-14 -translate-y-1/2 place-items-center border border-white/25 text-2xl text-white/85 transition hover:border-white hover:text-white md:left-16"
          >
            ←
          </button>
        )}

        {/* 主文字：移动端铺满左右，桌面左侧偏移 */}
        <div className="absolute inset-x-4 top-1/2 z-10 -translate-y-1/2 max-w-xl md:left-36 md:right-auto md:inset-x-auto md:max-w-2xl">
          <h1 className="text-3xl font-black tracking-[-0.04em] text-white md:text-6xl lg:text-7xl">
            {active.name}
          </h1>
          <p className="mt-3 max-w-md text-sm leading-6 text-white/75 md:mt-4 md:max-w-xl md:text-base md:leading-7">
            {active.description}
          </p>
          <div className="mt-5 flex flex-wrap gap-3 md:mt-7 md:gap-4">
            {stage !== "报名" || !participant.loading ? (
              <>
                <Button href={resolvedPrimaryHref} size="lg">{resolvedPrimaryLabel}</Button>
                {!primaryOpensEventDetail && (
                  <Button href={`/events/${active.id}`} variant="dark-outline" size="lg">赛事详情</Button>
                )}
              </>
            ) : <span className="h-12 w-36" aria-hidden />}
          </div>
        </div>

        {/* 右箭头：垂直居中 */}
        {total > 1 && (
          <button
            type="button"
            onClick={next}
            aria-label="下一届"
            className="absolute right-10 top-1/2 z-10 grid h-14 w-14 -translate-y-1/2 place-items-center border border-white/25 text-2xl text-white/85 transition hover:border-white hover:text-white md:right-16"
          >
            →
          </button>
        )}

        {/* 右下卡片条：carousel 滑动（多届赛事时才显示） */}
        {total > 1 && (
          <div className="absolute bottom-10 right-10 z-10 flex flex-col items-end gap-3 md:right-16">
            <div className="w-[600px] overflow-hidden">
              <div
                className="flex gap-3 transition-transform duration-500 ease-out"
                style={{ transform: `translateX(-${activeIndex * 188}px)` }}
              >
                {events.map((e, i) => {
                  const st = getStatusInfo(e.status);
                  const isActive = i === activeIndex;
                  // 距离 active 越远越暗（两边都衰减）
                  const distance = Math.abs(i - activeIndex);
                  const opacity = Math.max(0.15, 1 - distance * 0.3);
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => select(e.id)}
                      className={`relative h-24 w-44 shrink-0 overflow-hidden border text-left transition-opacity duration-300 ${isActive ? "border-white animate-active-in" : "border-white/15 hover:border-white/40"}`}
                      style={{ opacity }}
                    >
                      {e.posterImage ? (
                        <Image src={e.posterImage} alt="" aria-hidden fill sizes="176px" className="object-cover" />
                      ) : null}
                      <div aria-hidden className={`absolute inset-0 ${isActive ? "bg-black/10" : "bg-[#0a1318]/65"}`} />
                      <div
                        aria-hidden
                        className={`absolute inset-y-0 left-0 w-1.5 ${isActive ? "" : "opacity-60"}`}
                        style={{ background: e.coverColor }}
                      />
                      <div className="relative flex h-full items-center gap-3 px-4">
                        <span className="font-mono text-lg font-black tracking-tight text-white/95">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black text-white">{e.name}</p>
                          <p className="mt-0.5 text-[10px] font-bold tracking-wider text-white/55">{st.label}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 指示器 */}
            <div className="flex gap-1.5">
              {events.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => select(events[i].id)}
                  aria-label={`第 ${i + 1} 届`}
                  className={`h-1 w-10 transition ${i === activeIndex ? "bg-[#ff4655]" : "bg-white/25"}`}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
