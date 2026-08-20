"use client";

import { use, useState } from "react";
import { useCurrentEventConfig } from "@/hooks/useCurrentEventConfig";
import { useSchedule } from "@/lib/scheduling/useSchedule";
import { useRegistration } from "@/lib/scheduling/useRegistration";
import Container from "@/components/layout/Container";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";

function winCount(
  games: { teamAScore: number; teamBScore: number }[] | undefined,
  side: "A" | "B",
): number {
  if (!games) return 0;
  return games.filter((g) => (side === "A" ? g.teamAScore > g.teamBScore : g.teamBScore > g.teamAScore)).length;
}

export default function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const event = useCurrentEventConfig(id);
  const { state: schedule } = useSchedule(id);
  const { state: registration } = useRegistration(id);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [highlights, setHighlights] = useState("");
  const [activeTab, setActiveTab] = useState<"report" | "social" | "moment">("report");

  const completed = schedule.matches.filter((m) => m.status === "已完成" && m.winnerTeamId);
  const finalMatch =
    schedule.matches.find((m) => m.round === "总决赛" && m.winnerTeamId) ??
    completed[completed.length - 1];
  const champion = finalMatch
    ? finalMatch.winnerTeamId === finalMatch.teamAId
      ? finalMatch.teamAName
      : finalMatch.teamBName
    : null;
  const runnerUp = finalMatch
    ? finalMatch.winnerTeamId === finalMatch.teamAId
      ? finalMatch.teamBName
      : finalMatch.teamAName
    : null;

  const teamCount = registration.teams.length;
  const totalMatches = schedule.matches.length;
  const completedCount = completed.length;

  const finalScore = finalMatch
    ? `${winCount(finalMatch.gameResults, "A")} : ${winCount(finalMatch.gameResults, "B")}`
    : "—";

  const finalGameDetails =
    finalMatch?.gameResults
      ?.map(
        (g, i) =>
          `第${i + 1}局${g.map ? `（${g.map}）` : ""} ${g.teamAScore}:${g.teamBScore}`,
      )
      .join("，") ?? "";

  const headline = champion
    ? `${champion} 在决赛中 ${finalScore} 击败 ${runnerUp}，夺得本届冠军`
    : "赛事进行中，冠军待定";

  const mockReport = `# ${event.name} 赛事回顾

## 赛果总览

- 参赛队伍：${teamCount} 支
- 比赛总场次：${totalMatches} 场，已完成 ${completedCount} 场
- 冠军：${champion ?? "待定"}

${finalMatch ? `## 决赛

${finalMatch.teamAName} ${finalScore} ${finalMatch.teamBName}（${finalMatch.boType}）

${finalGameDetails ? `比分明细：${finalGameDetails}` : ""}

${headline}。` : `## 决赛

比赛尚未进行。`}

${highlights ? `## 比赛亮点\n\n${highlights}` : ""}

感谢所有参赛选手的精彩表现，下一届赛事我们再见！`;

  const mockSocial = champion
    ? `🏆【${event.name} 冠军诞生！】

恭喜 @${champion} 在决赛中 ${finalScore} 击败 @${runnerUp}，夺得本届赛事冠军！

${teamCount} 支队伍，${totalMatches} 场比赛，感谢每一位选手的精彩表现！

#校园电竞 #无畏契约 #电竞社`
    : `【${event.name} 进行中】

目前已进行 ${completedCount} 场比赛，冠军归属即将揭晓！

#校园电竞 #无畏契约 #电竞社`;

  const mockMoment = champion
    ? `🏆 ${event.name} 圆满落幕！\n\n冠军：${champion}\n亚军：${runnerUp}\n\n${completedCount} 场比赛，感谢所有选手的精彩表现！下一届再见！🎮`
    : `🎮 ${event.name} 进行中！\n\n已完成 ${completedCount} 场比赛，关注赛事动态，冠军即将揭晓！`;

  const handleGenerate = () => {
    setGenerating(true);
    setTimeout(() => {
      setGenerating(false);
      setGenerated(true);
    }, 600);
  };

  const content = activeTab === "report" ? mockReport : activeTab === "social" ? mockSocial : mockMoment;

  return (
    <Container className="py-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">赛事回顾</h1>
        <p className="text-sm text-gray-500 mb-8">{event.name} · 基于实时赛果生成</p>

        {/* Input Section */}
        <div className="border border-gray-200 bg-white p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">比赛亮点（可选）</h2>
          <p className="text-xs text-gray-500 mb-3">补充关键操作、逆转场面等亮点，会融入赛事回顾</p>
          <textarea
            rows={4}
            value={highlights}
            onChange={(e) => setHighlights(e.target.value)}
            placeholder="例如：决赛第24回合，队长四杀翻盘，全场沸腾..."
            className="w-full border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff4655] focus:border-transparent"
          />
          <div className="flex gap-3 mt-4">
            <Button onClick={handleGenerate} disabled={generating}>
              {generating ? "生成中..." : generated ? "重新生成" : "生成回顾"}
            </Button>
            {generated && <Badge className="bg-green-100 text-green-700 self-center">已生成</Badge>}
          </div>
        </div>

        {/* Output Section */}
        {generated && (
          <div className="border border-gray-200 bg-white p-6">
            {/* Tabs */}
            <div className="flex gap-2 mb-4 border-b border-gray-200">
              {[
                { key: "report" as const, label: "回顾文章" },
                { key: "social" as const, label: "社媒推文" },
                { key: "moment" as const, label: "朋友圈文案" },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab.key
                      ? "border-[#ff4655] text-[#ff4655]"
                      : "border-transparent text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Content */}
            <pre className="whitespace-pre-wrap text-sm text-gray-700 font-sans leading-relaxed">
              {content}
            </pre>

            {/* Actions */}
            <div className="flex gap-3 mt-6 pt-4 border-t border-gray-200">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigator.clipboard.writeText(content)}
              >
                复制内容
              </Button>
            </div>
          </div>
        )}

        {/* Champion Display */}
        <div className="bg-gradient-to-br from-yellow-50 to-orange-50 border border-yellow-200 p-6 mt-6 text-center">
          <div className="text-4xl mb-2">🏆</div>
          <p className="text-sm text-gray-500">本届冠军</p>
          <h3 className="text-xl font-bold text-gray-900">{champion ?? "待定"}</h3>
          {finalMatch && champion && (
            <p className="mt-2 text-xs text-gray-500">
              决赛：{finalMatch.teamAName} {finalScore} {finalMatch.teamBName}
            </p>
          )}
        </div>
      </div>
    </Container>
  );
}
