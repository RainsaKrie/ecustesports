import Container from "@/components/layout/Container";
import { GAME_COMMUNITIES } from "@/lib/legacy-site-content";

/**
 * 联系我们（2026-10-20 按 v8 基准改版）
 * 结构：Hero → 分区标题 → 社群卡（玻璃 + 折角）→ 分区标题 → 官方联系。
 * 删掉了旧的圆角 / 阴影 / 上移动效：v8 是零圆角、零阴影、不位移。
 */
export default function ContactPage() {
  return (
    <Container className="ui-page">
      <header className="ui-hero">
        <p className="ui-eyebrow">ECUST COMMUNITY</p>
        <h1>
          联系我们<em>.</em>
        </h1>
        <p className="ui-sub">
          各大游戏群请参考以下群号，大家玩的开心。部分社群可能已不活跃，电竞部只负责宣传；欢迎同好组建新群后联系我们更新。
        </p>
      </header>

      <div className="ui-sec">
        <h2>游戏社群</h2>
        <span>{String(GAME_COMMUNITIES.length).padStart(2, "0")} 个群</span>
      </div>
      <div className="ui-grid ui-grid-3 mt-4">
        {GAME_COMMUNITIES.map(([name, id]) => (
          <div key={`${name}-${id}`} className="ui-frame ui-pad">
            <p className="font-mono text-[11.5px] tracking-[0.14em] text-[var(--pub-txt-mute)]">{name}</p>
            <p className="mt-2 font-mono text-[17px] font-bold text-[var(--pub-red)]">{id}</p>
          </div>
        ))}
      </div>

      <div className="ui-sec">
        <h2>联系电竞部</h2>
        <span>OFFICIAL</span>
      </div>
      <div className="ui-frame ui-pad mt-4">
        <dl className="grid gap-6 sm:grid-cols-3">
          <div>
            <dt className="ui-eyebrow">微信公众号</dt>
            <dd className="mt-2 text-[15px] font-bold text-[var(--pub-txt)]">花梨电竞</dd>
          </div>
          <div>
            <dt className="ui-eyebrow">电竞部官方群</dt>
            <dd className="mt-2 font-mono text-[15px] font-bold text-[var(--pub-txt)]">691265713</dd>
          </div>
          <div>
            <dt className="ui-eyebrow">赛事咨询</dt>
            <dd className="mt-2 text-[13.5px] leading-6 text-[var(--pub-txt-soft)]">
              赛事合作、宣传推广或其他事务，请通过微信公众号或官方群联系我们。
            </dd>
          </div>
        </dl>
      </div>
    </Container>
  );
}
