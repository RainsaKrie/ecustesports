import Image from "next/image";
import { mapImageOf } from "@/lib/games";
import type { EsportEvent } from "@/types";

export type HandbookEvent = Pick<
  EsportEvent,
  | "description"
  | "organizer"
  | "teamCount"
  | "teamSize"
  | "dateLabel"
  | "registrationLabel"
  | "stageSummary"
  | "prizePool"
  | "preparationSteps"
  | "rulesList"
  | "mapPool"
  | "stageConfigs"
>;


// ⚠️ 这是全仓库**第四处**「阶段类型 → 文案」映射（另三处：`scheduling/format-templates` 的
// STAGE_TYPE_LABELS、`types/index.ts` 的类型联合、两处 validTypes 白名单）。
// 这里写成 Record<string, string> 而不是 Record<StageType, string>，**漏一种不会报错**，
// 只会让玩家侧手册显示空白 —— 2026-10-14 加 single-elim-groups 时就踩到了。
import { RULE_GROUPS, RuleGroup, Section, STAGE_TYPE_LABELS, categoryOf } from "@/components/events/EventHandbookParts";

export default function EventHandbook({ event }: { event: HandbookEvent }) {
  const rules = event.rulesList ?? [];
  const formatRules = rules.filter((rule) => categoryOf(rule) === "format");
  const matchDayRules = rules.filter((rule) => categoryOf(rule) === "match-day");
  const otherFormatRules = formatRules.filter(
    (rule) => !event.stageConfigs?.some((stage) => rule.title.includes(stage.name)),
  );
  const facts = [
    { label: "报名状态", value: event.registrationLabel || "待公布" },
    { label: "参赛席位", value: `${event.teamCount} 支队伍 / 每队 ${event.teamSize} 名首发选手` },
    { label: "竞赛日期", value: event.dateLabel || "待公布" },
    { label: "竞赛赛制", value: event.stageSummary || "待公布" },
  ];
  const directory = [
    ["#handbook-entry", "01", "参赛程序"],
    ["#handbook-format", "02", "竞赛赛制"],
    ["#handbook-match", "03", "比赛程序"],
    ["#handbook-rules", "04", "纪律与裁决"],
  ];

  return (
    <div className="bg-[#fffdf8] text-[#171a1f]">
      <section className="border-b border-black/10 bg-[#f2eee6] px-5 py-8 sm:px-8 lg:px-12 lg:py-10">
        <div className="mx-auto max-w-7xl border-t-4 border-[#ff4655] pt-5">
          <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr] lg:items-end lg:gap-12">
            <div>
              <p className="font-mono text-[10px] font-black tracking-[0.2em] text-[#ff4655]">
                OFFICIAL COMPETITION HANDBOOK
              </p>
              <h2 className="mt-4 max-w-4xl text-4xl font-black leading-[0.98] tracking-[-0.055em] sm:text-5xl lg:text-6xl">
                竞赛规程
              </h2>
            </div>
            <div className="border-l-2 border-[#ff4655] pl-5">
              <p className="max-w-2xl text-sm font-medium leading-7 text-[#34383e]">{event.description}</p>
              <p className="mt-3 font-mono text-[10px] font-bold tracking-[0.12em] text-[#575c62]">
                赛事主办 / {event.organizer}
              </p>
            </div>
          </div>

          <dl className="mt-7 grid border-l border-t border-black/15 sm:grid-cols-2 lg:grid-cols-4">
            {facts.map((fact) => (
              <div key={fact.label} className="border-b border-r border-black/15 bg-[#fffdf8]/70 px-5 py-4">
                <dt className="text-[10px] font-black tracking-wider text-[#686d73]">{fact.label}</dt>
                <dd className="mt-2 text-sm font-black leading-6 text-[#171a1f]">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <nav aria-label="参赛手册目录" className="border-b border-black/10 bg-[#fffdf8]">
        <div className="mx-auto grid max-w-7xl grid-cols-2 sm:grid-cols-4">
          {directory.map(([href, index, label]) => (
            <a
              key={href}
              href={href}
              className="group flex min-h-14 min-w-0 items-center gap-3 border-b border-r border-black/10 px-4 transition hover:bg-[#171a1f] hover:text-white sm:border-b-0 sm:px-5"
            >
              <span className="font-mono text-[10px] font-black text-[#ff4655]">{index}</span>
              <span className="text-xs font-black">{label}</span>
            </a>
          ))}
        </div>
      </nav>

      <Section id="handbook-entry" index="01" eyebrow="ENTRY PROCEDURE" title="报名与参赛程序">
        {event.preparationSteps?.length ? (
          <ol className="grid border-l border-t border-black/15 md:grid-cols-2 lg:grid-cols-3">
            {event.preparationSteps.map((step, index) => (
              <li
                key={`${step.number}-${step.title}`}
                className="grid min-h-40 grid-cols-[3rem_1fr] gap-4 border-b border-r border-black/15 p-5"
              >
                <span className="font-mono text-xs font-black text-[#ff4655]">
                  {step.number || String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <p className="font-mono text-[9px] font-black tracking-[0.16em] text-[#777b80]">ENTRY STEP</p>
                  <h4 className="mt-2 text-base font-black text-[#171a1f]">{step.title}</h4>
                  <p className="mt-3 text-xs font-medium leading-6 text-[#2b3038]">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="border-y border-black/15 py-6 text-sm font-bold">参赛程序待公布</p>
        )}
      </Section>

      <Section id="handbook-format" index="02" eyebrow="TOURNAMENT FORMAT" title="竞赛赛制与地图池" tone="cream">
        {event.stageConfigs?.length ? (
          <div className="grid border-l border-t border-black/15 lg:grid-cols-3">
            {event.stageConfigs.map((stage, index) => {
              const matchingRule = formatRules.find((rule) => rule.title.includes(stage.name));
              return (
                <article
                  key={`${stage.name}-${index}`}
                  className="relative border-b border-r border-black/15 bg-[#fffdf8] p-5 lg:min-h-56"
                >
                  <div className="flex items-start justify-between gap-4">
                    <p className="font-mono text-[10px] font-black tracking-widest text-[#ff4655]">
                      STAGE {String(index + 1).padStart(2, "0")}
                    </p>
                    {index < event.stageConfigs!.length - 1 && (
                      <span className="font-mono text-sm font-black text-[#ff4655]">NEXT →</span>
                    )}
                  </div>
                  <h4 className="mt-4 text-2xl font-black tracking-[-0.03em]">{stage.name}</h4>
                  <p className="mt-3 text-sm font-black">{stage.teamCount} 支队伍 · {stage.boType}</p>
                  <p className="mt-1 text-xs font-bold text-[#565b61]">
                    {STAGE_TYPE_LABELS[stage.type] ?? stage.type}
                    {stage.groupCount ? ` · ${stage.groupCount} 个小组` : ""}
                  </p>
                  {matchingRule && (
                    <p className="mt-4 border-t border-black/10 pt-3 text-xs font-medium leading-6 text-[#2b3038]">
                      {matchingRule.detail}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <p className="border-y border-black/15 py-6 text-sm font-bold">竞赛赛制待公布</p>
        )}

        {otherFormatRules.length > 0 && (
          <div className="mt-4 border-l border-t border-black/15 bg-[#fffdf8]">
            {otherFormatRules.map((rule, index) => (
              <article
                key={rule.title}
                className="grid gap-2 border-b border-r border-black/15 px-5 py-5 md:grid-cols-[3rem_12rem_1fr] md:gap-5"
              >
                <span className="font-mono text-[10px] font-black text-[#ff4655]">F{String(index + 1).padStart(2, "0")}</span>
                <h5 className="text-sm font-black">{rule.title}</h5>
                <p className="text-xs font-medium leading-6 text-[#2b3038]">{rule.detail}</p>
              </article>
            ))}
          </div>
        )}

        <div className="mt-7 border-t-2 border-[#171a1f] pt-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] font-black tracking-[0.18em] text-[#ff4655]">ACTIVE MAP POOL</p>
              <h4 className="mt-2 text-xl font-black">赛事地图池</h4>
            </div>
            <p className="font-mono text-[10px] font-black tracking-widest text-[#777b80]">
              {String(event.mapPool?.length ?? 0).padStart(2, "0")} MAPS
            </p>
          </div>
          {event.mapPool?.length ? (
            <div className="mt-4 grid grid-cols-2 border-l border-t border-black/15 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
              {event.mapPool.map((map, index) => (
                <article key={map.id} className="relative aspect-[4/3] overflow-hidden border-b border-r border-black/15 bg-[#292c31]">
                  {mapImageOf(map) && (
                    <Image
                      src={mapImageOf(map)!}
                      alt={map.name}
                      fill
                      sizes="(max-width: 639px) 50vw, (max-width: 1023px) 33vw, (max-width: 1279px) 25vw, 14vw"
                      className="object-cover opacity-80 transition duration-500 hover:scale-105"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-transparent" />
                  <span className="absolute left-4 top-4 font-mono text-[10px] font-black text-white/70">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h5 className="absolute inset-x-4 bottom-4 text-base font-black text-white">{map.name}</h5>
                </article>
              ))}
            </div>
          ) : (
            <p className="mt-5 border-y border-black/15 py-6 text-sm font-bold">赛事地图池待公布</p>
          )}
        </div>
      </Section>

      <Section id="handbook-match" index="03" eyebrow="MATCH PROCEDURE" title="比赛程序">
        {matchDayRules.length ? (
          <ol className="border-l border-t border-black/15">
            {matchDayRules.map((rule, index) => (
              <li
                key={`${rule.title}-${index}`}
                className={`grid gap-2 border-b border-r border-black/15 px-5 py-4 sm:px-6 md:grid-cols-[3.5rem_13rem_1fr] md:gap-5 md:py-5 ${
                  rule.emphasis === "important" ? "bg-[#faf6f0]" : "bg-[#fffdf8]"
                }`}
              >
                <span className="font-mono text-xs font-black text-[#ff4655]">{String(index + 1).padStart(2, "0")}</span>
                <h4 className="text-sm font-black leading-6">{rule.title}</h4>
                <p className="text-xs font-medium leading-6 text-[#2b3038]">{rule.detail}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="border-y border-black/15 py-6 text-sm font-bold">比赛程序待公布</p>
        )}
      </Section>

      <Section id="handbook-rules" index="04" eyebrow="COMPETITION RULES" title="竞赛纪律、赛务处理与申诉" tone="cream">
        <div className="space-y-3">
          {RULE_GROUPS.map((group) => (
            <RuleGroup
              key={group.category}
              index={group.index}
              eyebrow={group.eyebrow}
              title={group.title}
              description={group.description}
              rules={rules.filter((rule) => categoryOf(rule) === group.category)}
            />
          ))}
        </div>
      </Section>

      <footer className="bg-[#fffdf8] px-5 py-8 sm:px-8 lg:px-12 lg:py-9">
        <div className="mx-auto grid max-w-7xl border-l border-t border-black/15 lg:grid-cols-2">
          <section className="border-b border-r border-black/15 p-6">
            <div className="h-1 w-10 bg-[#ff4655]" />
            <p className="mt-4 font-mono text-[10px] font-black tracking-[0.2em] text-[#ff4655]">PRIZES</p>
            <h3 className="mt-2 text-2xl font-black">奖金与奖项</h3>
            <p className="mt-3 text-sm font-medium leading-7 text-[#2b3038]">{event.prizePool || "奖金与奖项待公布"}</p>
          </section>
          <section className="border-b border-r border-black/15 bg-[#f2eee6] p-6">
            <p className="font-mono text-[10px] font-black tracking-[0.2em] text-[#ff4655]">TOURNAMENT ADMINISTRATION</p>
            <h3 className="mt-2 text-2xl font-black">赛事通知与裁决</h3>
            <p className="mt-3 text-sm font-medium leading-7 text-[#2b3038]">
              赛程变更、竞赛判罚及申诉结果由 {event.organizer} 正式发布。赛事平台公告与赛事组通知共同构成本届赛事的有效信息。
            </p>
          </section>
        </div>
      </footer>
    </div>
  );
}
