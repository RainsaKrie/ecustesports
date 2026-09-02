import { Metadata } from "next";
import Container from "@/components/layout/Container";

export const metadata: Metadata = {
  title: "社群 | 华东理工大学电竞部",
  description: "加入华东理工大学电竞社群，与校内玩家交流，组队开黑，参与活动。",
};

export default function CommunityPage() {
  return (
    <div className="min-h-screen bg-[#0f1923] text-white py-16">
      <Container>
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-block px-4 py-1 rounded-full bg-[#C4612F]/10 text-[#C4612F] text-sm font-medium mb-6">
            COMMUNITY
          </div>
          <h1 className="text-4xl md:text-5xl font-bold mb-6">社群</h1>
          <p className="text-[#94a3b8] text-lg mb-12">
            加入华东理工大学电竞社群，与校内玩家交流，组队开黑，参与活动。
          </p>

          <div className="grid gap-6 md:grid-cols-2 text-left">
            <div className="bg-[#1a2332] border border-[#2d3748] rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-3">QQ 群</h2>
              <p className="text-[#94a3b8] mb-4">加入 QQ 群与校内玩家交流，获取赛事通知和活动信息。</p>
              <div className="space-y-2">
                <div className="flex justify-between items-center py-2 border-b border-[#2d3748]/50">
                  <span className="text-sm text-[#94a3b8]">英雄联盟</span>
                  <code className="text-sm font-mono">123456789</code>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-[#2d3748]/50">
                  <span className="text-sm text-[#94a3b8]">无畏契约</span>
                  <code className="text-sm font-mono">123456789</code>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-[#2d3748]/50">
                  <span className="text-sm text-[#94a3b8]">CS2</span>
                  <code className="text-sm font-mono">123456789</code>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-sm text-[#94a3b8]">三角洲行动</span>
                  <code className="text-sm font-mono">552750103</code>
                </div>
              </div>
            </div>

            <div className="bg-[#1a2332] border border-[#2d3748] rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-3">Discord 频道</h2>
              <p className="text-[#94a3b8] mb-4">加入 Discord 频道，参与语音交流和实时互动。</p>
              <a
                href="#"
                className="inline-flex items-center gap-2 px-4 py-2 bg-[#5865F2] hover:bg-[#4752C4] rounded-lg transition-colors"
              >
                <span>加入 Discord</span>
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M13.545 2.907a13.227 13.227 0 0 0-3.257-1.011.05.05 0 0 0-.052.025c-.141.25-.297.577-.406.833a12.19 12.19 0 0 0-3.658 0 8.258 8.258 0 0 0-.412-.833.051.051 0 0 0-.052-.025c-1.125.194-2.22.534-3.257 1.011a.041.041 0 0 0-.021.018C.356 6.024-.213 9.047.066 12.032c.001.014.01.028.021.037a13.276 13.276 0 0 0 3.995 2.02.05.05 0 0 0 .056-.019c.308-.42.582-.863.818-1.329a.05.05 0 0 0-.01-.059.051.051 0 0 0-.018-.011 8.875 8.875 0 0 1-1.248-.595.05.05 0 0 1-.02-.066.051.051 0 0 1 .015-.019c.084-.063.168-.129.248-.195a.05.05 0 0 1 .051-.007c2.619 1.196 5.454 1.196 8.041 0a.052.052 0 0 1 .053.007c.08.066.164.132.248.195a.051.051 0 0 1-.004.085 8.254 8.254 0 0 1-1.249.594.05.05 0 0 0-.03.03.052.052 0 0 0 .003.041c.24.465.515.909.817 1.329a.05.05 0 0 0 .056.019 13.235 13.235 0 0 0 4.001-2.02.049.049 0 0 0 .021-.037c.334-3.451-.559-6.449-2.366-9.106a.034.034 0 0 0-.02-.019Zm-8.198 7.307c-.789 0-1.438-.724-1.438-1.612 0-.889.637-1.613 1.438-1.613.807 0 1.45.73 1.438 1.613 0 .888-.637 1.612-1.438 1.612Zm5.316 0c-.788 0-1.438-.724-1.438-1.612 0-.889.637-1.613 1.438-1.613.807 0 1.451.73 1.438 1.613 0 .888-.631 1.612-1.438 1.612Z"/>
                </svg>
              </a>
            </div>
          </div>

          <div className="mt-12 p-6 bg-[#1a2332] border border-[#2d3748] rounded-lg">
            <h2 className="text-xl font-semibold mb-3">线下活动</h2>
            <p className="text-[#94a3b8]">
              关注电竞部官方通知，参与线下聚会、观赛派对和训练活动。
            </p>
          </div>
        </div>
      </Container>
    </div>
  );
}
