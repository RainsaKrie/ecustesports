import { Metadata } from "next";
import Container from "@/components/layout/Container";

export const metadata: Metadata = {
  title: "公告 | 华东理工大学电竞部",
  description: "查看华东理工大学电竞部最新公告、赛事通知和活动动态。",
};

export default function NewsPage() {
  return (
    <div className="min-h-screen bg-[#0f1923] text-white py-16">
      <Container>
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <div className="inline-block px-4 py-1 rounded-full bg-[#C4612F]/10 text-[#C4612F] text-sm font-medium mb-6">
              ANNOUNCEMENTS
            </div>
            <h1 className="text-4xl md:text-5xl font-bold mb-6">公告</h1>
            <p className="text-[#94a3b8] text-lg">
              查看电竞部最新公告、赛事通知和活动动态。
            </p>
          </div>

          <div className="space-y-6">
            <article className="bg-[#1a2332] border border-[#2d3748] rounded-lg p-6 hover:border-[#C4612F]/30 transition-colors">
              <div className="flex items-center gap-3 mb-3">
                <span className="px-3 py-1 text-xs font-medium bg-[#C4612F]/10 text-[#C4612F] rounded-full">
                  赛事通知
                </span>
                <time className="text-sm text-[#94a3b8]">2026-09-01</time>
              </div>
              <h2 className="text-xl font-semibold mb-3">第三届瓦理杯已结束</h2>
              <p className="text-[#94a3b8]">
                疾风战队在总决赛以 3:2 战胜赤霄战队，夺得第三届瓦理杯冠军。感谢所有参赛队伍的精彩表现！
              </p>
            </article>

            <article className="bg-[#1a2332] border border-[#2d3748] rounded-lg p-6 hover:border-[#C4612F]/30 transition-colors">
              <div className="flex items-center gap-3 mb-3">
                <span className="px-3 py-1 text-xs font-medium bg-blue-500/10 text-blue-400 rounded-full">
                  活动公告
                </span>
                <time className="text-sm text-[#94a3b8]">2026-08-25</time>
              </div>
              <h2 className="text-xl font-semibold mb-3">三角洲行动社群开放</h2>
              <p className="text-[#94a3b8]">
                欢迎加入三角洲行动 QQ 群（552750103），与校内玩家组队开黑，参与战术射击体验。
              </p>
            </article>

            <article className="bg-[#1a2332] border border-[#2d3748] rounded-lg p-6 hover:border-[#C4612F]/30 transition-colors">
              <div className="flex items-center gap-3 mb-3">
                <span className="px-3 py-1 text-xs font-medium bg-green-500/10 text-green-400 rounded-full">
                  系统更新
                </span>
                <time className="text-sm text-[#94a3b8]">2026-08-20</time>
              </div>
              <h2 className="text-xl font-semibold mb-3">网站导航更新</h2>
              <p className="text-[#94a3b8]">
                网站导航已更新，新增社群和公告入口，方便查看最新动态和加入社群。
              </p>
            </article>

            <div className="text-center py-8">
              <p className="text-[#94a3b8]">更多公告即将发布，敬请关注。</p>
            </div>
          </div>
        </div>
      </Container>
    </div>
  );
}
