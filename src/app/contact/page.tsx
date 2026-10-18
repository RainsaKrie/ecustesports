import Container from "@/components/layout/Container";
import { GAME_COMMUNITIES } from "@/lib/legacy-site-content";

export default function ContactPage() {
  return (
    <Container className="py-12 sm:py-16">
      <div className="mx-auto max-w-4xl text-center">
        <p className="section-kicker justify-center"><span /> ECUST COMMUNITY</p>
        <h1 className="mt-3 text-4xl font-black text-[#171a1f]">联系我们 & 游戏社群</h1>
        <p className="mt-4 text-sm leading-7 text-[#5b626c]">各大游戏群请参考以下群号，大家玩的开心！</p>
        <p className="mt-2 text-xs leading-6 text-[#5b626c]">部分社群可能已不活跃，电竞部只负责宣传。欢迎同好组建新群后联系我们更新。</p>
      </div>
      <div className="mx-auto mt-10 grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {GAME_COMMUNITIES.map(([name, id]) => (
          <div key={`${name}-${id}`} className="border border-black/10 bg-[#fffdf8] p-5 transition hover:-translate-y-1 hover:border-[#ff4655]/50 hover:shadow-[0_15px_30px_rgba(15,25,35,0.08)]">
            <h2 className="font-black text-[#171a1f]">{name}</h2>
            <p className="mt-2 font-mono text-sm text-[#c83242]">{id}</p>
          </div>
        ))}
      </div>

      <div className="mx-auto mt-16 max-w-4xl border-t border-black/10 pt-10">
        <div className="mb-6 text-center">
          <p className="section-kicker justify-center"><span /> CONTACT US</p>
          <h2 className="mt-3 text-3xl font-black text-[#171a1f]">联系电竞部</h2>
        </div>
        <div className="space-y-4 rounded border border-black/10 bg-[#fffdf8] p-6">
          <div>
            <h3 className="font-bold text-[#171a1f]">微信公众号</h3>
            <p className="mt-1 text-[#5b626c]">花梨电竞</p>
          </div>
          <div>
            <h3 className="font-bold text-[#171a1f]">电竞部官方群</h3>
            <p className="mt-1 font-mono text-[#5b626c]">691265713</p>
          </div>
          <div>
            <h3 className="font-bold text-[#171a1f]">赛事咨询</h3>
            <p className="mt-1 text-sm text-[#5b626c]">如需赛事合作、宣传推广或其他事务，请通过微信公众号或官方群联系我们。</p>
          </div>
        </div>
      </div>
    </Container>
  );
}
