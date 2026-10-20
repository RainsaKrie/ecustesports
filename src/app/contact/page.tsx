import Container from "@/components/layout/Container";
import { GAME_COMMUNITIES } from "@/lib/legacy-site-content";

export default function ContactPage() {
  return (
    <Container className="py-12 sm:py-16">
      <div className="mx-auto max-w-4xl text-center">
        <p className="section-kicker justify-center"><span /> ECUST COMMUNITY</p>
        <h1 className="mt-3 text-4xl font-black text-[var(--pub-txt)]">联系我们 & 游戏社群</h1>
        <p className="mt-4 text-sm leading-7 text-[var(--pub-txt-soft)]">各大游戏群请参考以下群号，大家玩的开心！</p>
        <p className="mt-2 text-xs leading-6 text-[var(--pub-txt-soft)]">部分社群可能已不活跃，电竞部只负责宣传。欢迎同好组建新群后联系我们更新。</p>
      </div>
      <div className="mx-auto mt-10 grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {GAME_COMMUNITIES.map(([name, id]) => (
          <div key={`${name}-${id}`} className="border border-[var(--pub-line-soft)] bg-[var(--pub-card)] p-5 transition hover:border-[#ff4655]/50">
            <h2 className="font-black text-[var(--pub-txt)]">{name}</h2>
            <p className="mt-2 font-mono text-sm text-[var(--pub-red)]">{id}</p>
          </div>
        ))}
      </div>

      <div className="mx-auto mt-16 max-w-4xl border-t border-[var(--pub-line-soft)] pt-10">
        <div className="mb-6 text-center">
          <p className="section-kicker justify-center"><span /> CONTACT US</p>
          <h2 className="mt-3 text-3xl font-black text-[var(--pub-txt)]">联系电竞部</h2>
        </div>
        <div className="space-y-4 border border-[var(--pub-line-soft)] bg-[var(--pub-card)] p-6">
          <div>
            <h3 className="font-bold text-[var(--pub-txt)]">微信公众号</h3>
            <p className="mt-1 text-[var(--pub-txt-soft)]">花梨电竞</p>
          </div>
          <div>
            <h3 className="font-bold text-[var(--pub-txt)]">电竞部官方群</h3>
            <p className="mt-1 font-mono text-[var(--pub-txt-soft)]">691265713</p>
          </div>
          <div>
            <h3 className="font-bold text-[var(--pub-txt)]">赛事咨询</h3>
            <p className="mt-1 text-sm text-[var(--pub-txt-soft)]">如需赛事合作、宣传推广或其他事务，请通过微信公众号或官方群联系我们。</p>
          </div>
        </div>
      </div>
    </Container>
  );
}
