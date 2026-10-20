import type { ReactNode } from "react";
import type { ScheduleMatch } from "@/lib/domains/schedule/schedule-data";

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
      <div className="mb-1.5 flex items-end justify-between gap-2 border-b border-[var(--pub-line)] pb-1.5">
        <h4 className="text-[0.625rem] font-black text-[var(--pub-txt-soft)]">{title}</h4>
        <span className="font-mono text-[0.5rem] text-[var(--pub-txt-mute)]">{matches.length} 场</span>
      </div>
      <div className="flex h-[calc(100%-2rem)] min-h-16 flex-col justify-around gap-2">
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
    <section className="border border-[var(--pub-line)] bg-white/[0.03] p-2.5">
      <div className="mb-2 flex items-end justify-between gap-2 border-b border-[var(--pub-line)] pb-1.5">
        <div>
          <p className="font-mono text-[0.5rem] font-black tracking-[0.12em] text-[var(--pub-red)]">SINGLE ROUND MATCHUPS</p>
          <h4 className="mt-1 text-xs font-black text-[var(--pub-txt)]">{title}</h4>
        </div>
        <span className="font-mono text-[0.5rem] text-[var(--pub-txt-mute)]">{matches.length} 场 · 胜者晋级下一阶段</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
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
    <div
      className="grid min-w-0 items-stretch gap-3"
      style={{ gridTemplateColumns: `repeat(${rounds.length}, minmax(0, 1fr))` }}
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
  );
}

function groupName(round: string | undefined) {
  return round?.match(/^(.+?)\s(?:揭幕战|胜者组出线战|败者组淘汰战|最终出线战)$/)?.[1];
}

function GroupStageBracket({ matches, renderMatch }: TournamentBracketCanvasProps) {
  const groups = [...new Set(matches.map((match) => groupName(match.round)).filter((name): name is string => Boolean(name)))];
  return (
    <div className="grid min-w-0 gap-3 xl:grid-cols-2">
      {groups.map((group) => {
        const openers = roundMatches(matches, `${group} 揭幕战`);
        const middle = [
          ...roundMatches(matches, `${group} 胜者组出线战`),
          ...roundMatches(matches, `${group} 败者组淘汰战`),
        ];
        const decider = roundMatches(matches, `${group} 最终出线战`);
        return (
          <section key={group} className="min-w-0 overflow-hidden border border-[var(--pub-line)] bg-white/[0.06] p-2.5">
            <div className="mb-2 flex items-center justify-between border-b border-[var(--pub-line)] pb-1.5">
              <h4 className="text-xs font-black text-[var(--pub-txt)]">{group}</h4>
              <span className="font-mono text-[0.5rem] font-bold text-[var(--pub-txt-mute)]">两胜晋级 · 两败淘汰</span>
            </div>
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_0.75rem_minmax(0,1fr)_1rem_minmax(0,1fr)] items-stretch gap-1">
                <RoundColumn title="揭幕战" matches={openers} renderMatch={renderMatch} />
                <div className="flex items-center justify-center font-mono text-sm font-black text-[var(--pub-txt-soft)]" aria-hidden>→</div>
                <RoundColumn title="胜者 / 败者战" matches={middle} renderMatch={renderMatch} />
                <div className="flex flex-col items-center justify-center text-center font-mono text-[0.5rem] font-bold leading-4 text-[var(--pub-txt-mute)]" aria-hidden>
                  <span>败者</span><span>＋</span><span>胜者 →</span>
                </div>
                <RoundColumn title="最终出线战" matches={decider} renderMatch={renderMatch} />
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
    <div className="min-w-0 space-y-4">
        <section className="min-w-0 border-l-2 border-[#ff4655] pl-3">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-black text-[var(--pub-txt)]">胜者组</h4>
            <span className="font-mono text-[0.5rem] text-[var(--pub-txt-mute)]">落败队伍按卡片标注进入败者组</span>
          </div>
          <div className="grid grid-cols-2 items-stretch gap-3 lg:grid-cols-4">
            {WINNER_ROUNDS.map((round) => (
              <RoundColumn key={round} title={round} matches={roundMatches(matches, round)} renderMatch={renderMatch} />
            ))}
          </div>
        </section>
        <section className="min-w-0 border-l-2 border-[var(--pub-txt-mute)] pl-3">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-black text-[var(--pub-txt)]">败者组</h4>
            <span className="font-mono text-[0.5rem] text-[var(--pub-txt-mute)]">再负一场即淘汰</span>
          </div>
          <div className="grid grid-cols-2 items-stretch gap-3 lg:grid-cols-4">
            {LOSER_ROUNDS.map((round) => (
              <RoundColumn key={round} title={round} matches={roundMatches(matches, round)} renderMatch={renderMatch} />
            ))}
          </div>
        </section>
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
  // 阶段顺序（2026-10-20 负责人指定）：小组赛 → 入围赛 → 资格赛。
  // 不按生成顺序 —— 生成是"资格赛在前"，但那是流程顺序，不是阅读顺序。
  const PHASE_ORDER = ["小组赛", "入围赛", "资格赛", "淘汰赛"];
  const phaseRank = (phase: string) => {
    const index = PHASE_ORDER.findIndex((key) => phase.includes(key));
    return index < 0 ? 99 : index;
  };
  const phases = [...new Set(matches.map((match) => match.phase))].sort((a, b) => phaseRank(a) - phaseRank(b));
  return (
    <div className="min-w-0 space-y-5 overflow-x-auto">
      {phases.map((phase) => {
        const phaseMatches = matches.filter((match) => match.phase === phase);
        return (
          <section key={phase} className="min-w-0">
            <div className="mb-2 flex items-center gap-3">
              <h3 className="font-mono text-[0.6875rem] font-black tracking-[0.12em] text-[var(--pub-txt-soft)]">{phase}</h3>
              <span className="h-px flex-1 bg-[var(--pub-line)]" />
              <span className="font-mono text-[0.5rem] text-[var(--pub-txt-mute)]">{phaseMatches.length} 场</span>
            </div>
            <PhaseBracket matches={phaseMatches} renderMatch={renderMatch} />
          </section>
        );
      })}
    </div>
  );
}
