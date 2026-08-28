import type { ReactNode } from "react";
import type { ScheduleMatch } from "@/lib/scheduling/schedule-data";

interface TournamentBracketCanvasProps {
  matches: ScheduleMatch[];
  renderMatch: (match: ScheduleMatch) => ReactNode;
}

/** 仅在赛程数据明确给出晋级关系时显示；旧数据缺关系字段时不猜测冠军路径。 */
export function advancementPath(match: ScheduleMatch): string | null {
  if (match.nextMatchId || match.nextLoserMatchId) {
    const winner = match.nextMatchId ? `胜 → ${match.nextMatchId}` : "胜 → 晋级";
    const loser = match.nextLoserMatchId ? ` · 败 → ${match.nextLoserMatchId}` : match.nextMatchId ? " · 败 → 淘汰" : "";
    return `${winner}${loser}`;
  }
  if (match.round === "决赛" || match.round === "总决赛") return "胜 → 冠军";
  return null;
}

function roundMatches(matches: ScheduleMatch[], round: string) {
  return matches.filter((match) => match.round === round);
}

function RoundColumn({ title, matches, renderMatch }: { title: string; matches: ScheduleMatch[]; renderMatch: (match: ScheduleMatch) => ReactNode }) {
  return (
    <section className="min-w-0">
      <div className="mb-2 flex items-end justify-between gap-2 border-b border-slate-200 pb-2">
        <h4 className="text-[0.625rem] font-black text-slate-700">{title}</h4>
        <span className="font-mono text-[0.5rem] text-slate-400">{matches.length} 场</span>
      </div>
      <div className="flex h-[calc(100%-2rem)] min-h-20 flex-col justify-around gap-3">
        {matches.map((match) => <div key={match.id}>{renderMatch(match)}</div>)}
      </div>
    </section>
  );
}

function genericRounds(matches: ScheduleMatch[]) {
  const rounds: string[] = [];
  for (const match of matches) {
    const round = match.round ?? "未分组";
    if (!rounds.includes(round)) rounds.push(round);
  }
  return rounds;
}

function SingleRoundGrid({ title, matches, renderMatch }: { title: string; matches: ScheduleMatch[]; renderMatch: (match: ScheduleMatch) => ReactNode }) {
  return (
    <section className="border border-slate-200 bg-slate-50/50 p-3">
      <div className="mb-3 flex items-end justify-between gap-2 border-b border-slate-200 pb-2">
        <div>
          <p className="font-mono text-[0.5rem] font-black tracking-[0.12em] text-[#c83242]">SINGLE ROUND MATCHUPS</p>
          <h4 className="mt-1 text-xs font-black text-slate-800">{title}</h4>
        </div>
        <span className="font-mono text-[0.5rem] text-slate-400">{matches.length} 场 · 胜者晋级下一阶段</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {matches.map((match) => <div key={match.id}>{renderMatch(match)}</div>)}
      </div>
    </section>
  );
}

function GenericBracket({ matches, renderMatch }: TournamentBracketCanvasProps) {
  const rounds = genericRounds(matches);
  if (rounds.length === 1 && matches.length > 1) {
    return <SingleRoundGrid title={rounds[0]} matches={matches} renderMatch={renderMatch} />;
  }
  return (
    <div className="overflow-x-auto pb-2">
      <div
        className="grid min-w-[640px] items-stretch gap-5"
        style={{ gridTemplateColumns: `repeat(${rounds.length}, minmax(10rem, 1fr))` }}
      >
        {rounds.map((round) => (
          <RoundColumn
            key={round}
            title={round}
            matches={matches.filter((match) => (match.round ?? "未分组") === round)}
            renderMatch={renderMatch}
          />
        ))}
      </div>
    </div>
  );
}

function groupName(round: string | undefined) {
  return round?.match(/^(.+?)\s(?:揭幕战|胜者组出线战|败者组淘汰战|最终出线战)$/)?.[1];
}

function GroupStageBracket({ matches, renderMatch }: TournamentBracketCanvasProps) {
  const groups = [...new Set(matches.map((match) => groupName(match.round)).filter((name): name is string => Boolean(name)))];
  return (
    <div className="grid gap-4 2xl:grid-cols-2">
      {groups.map((group) => {
        const openers = roundMatches(matches, `${group} 揭幕战`);
        const middle = [
          ...roundMatches(matches, `${group} 胜者组出线战`),
          ...roundMatches(matches, `${group} 败者组淘汰战`),
        ];
        const decider = roundMatches(matches, `${group} 最终出线战`);
        return (
          <section key={group} className="min-w-0 border border-slate-200 bg-slate-50/60 p-3">
            <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-2">
              <h4 className="text-xs font-black text-slate-950">{group}</h4>
              <span className="font-mono text-[0.5rem] font-bold text-slate-400">两胜晋级 · 两败淘汰</span>
            </div>
            <div className="overflow-x-auto pb-1">
              <div className="grid min-w-[31rem] grid-cols-[1fr_2rem_1fr_2rem_1fr] items-stretch gap-2">
                <RoundColumn title="揭幕战" matches={openers} renderMatch={renderMatch} />
                <div className="flex items-center justify-center font-mono text-sm font-black text-slate-300" aria-hidden>→</div>
                <RoundColumn title="胜者 / 败者战" matches={middle} renderMatch={renderMatch} />
                <div className="flex flex-col items-center justify-center text-center font-mono text-[0.5rem] font-bold leading-4 text-slate-400" aria-hidden>
                  <span>败者</span><span>＋</span><span>胜者 →</span>
                </div>
                <RoundColumn title="最终出线战" matches={decider} renderMatch={renderMatch} />
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

const WINNER_ROUNDS = ["胜者组第一轮", "胜者组半决赛", "胜者组决赛", "总决赛"];
const LOSER_ROUNDS = ["败者组第一轮", "败者组第二轮", "败者组第三轮", "败者组决赛"];

function DoubleEliminationBracket({ matches, renderMatch }: TournamentBracketCanvasProps) {
  return (
    <div className="overflow-x-auto pb-2">
      <div className="min-w-[640px] space-y-5">
        <section className="border-l-2 border-[#ff4655] pl-4">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-xs font-black text-slate-950">胜者组</h4>
            <span className="font-mono text-[0.5rem] text-slate-400">落败队伍按卡片标注进入败者组</span>
          </div>
          <div className="grid grid-cols-4 items-stretch gap-5">
            {WINNER_ROUNDS.map((round) => (
              <RoundColumn key={round} title={round} matches={roundMatches(matches, round)} renderMatch={renderMatch} />
            ))}
          </div>
        </section>
        <section className="border-l-2 border-slate-400 pl-4">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-xs font-black text-slate-950">败者组</h4>
            <span className="font-mono text-[0.5rem] text-slate-400">再负一场即淘汰</span>
          </div>
          <div className="grid grid-cols-4 items-stretch gap-5">
            {LOSER_ROUNDS.map((round) => (
              <RoundColumn key={round} title={round} matches={roundMatches(matches, round)} renderMatch={renderMatch} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function PhaseBracket({ matches, renderMatch }: TournamentBracketCanvasProps) {
  const isGroupStage = matches.some((match) => match.round?.includes("揭幕战"))
    && matches.some((match) => match.round?.includes("最终出线战"));
  if (isGroupStage) return <GroupStageBracket matches={matches} renderMatch={renderMatch} />;
  if (matches.some((match) => Boolean(match.nextLoserMatchId))) {
    return <DoubleEliminationBracket matches={matches} renderMatch={renderMatch} />;
  }
  return <GenericBracket matches={matches} renderMatch={renderMatch} />;
}

export default function TournamentBracketCanvas({ matches, renderMatch }: TournamentBracketCanvasProps) {
  const phases = [...new Set(matches.map((match) => match.phase))];
  return (
    <div className="min-w-0 space-y-7">
      {phases.map((phase) => {
        const phaseMatches = matches.filter((match) => match.phase === phase);
        const isSingleRound = new Set(phaseMatches.map((match) => match.round ?? "未分组")).size === 1;
        return (
          <section key={phase} className="min-w-0">
            <div className="mb-3 flex items-center gap-3">
              <h3 className="font-mono text-[0.6875rem] font-black tracking-[0.12em] text-slate-700">{phase}</h3>
              <span className="h-px flex-1 bg-slate-200" />
              <span className="font-mono text-[0.5rem] text-slate-400">{phaseMatches.length} 场</span>
            </div>
            {!isSingleRound && (
              <p className="mb-2 font-mono text-[0.5rem] text-slate-400 md:hidden">左右滑动查看完整晋级路径 →</p>
            )}
            <PhaseBracket matches={phaseMatches} renderMatch={renderMatch} />
          </section>
        );
      })}
    </div>
  );
}
