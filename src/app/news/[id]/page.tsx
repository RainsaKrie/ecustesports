import Link from "next/link";
import { notFound } from "next/navigation";
import Container from "@/components/layout/Container";
import { LEGACY_ANNOUNCEMENTS } from "@/lib/legacy-site-content";

/** 公告详情（2026-10-20 按 v8 基准改版）：眉标 → 大标题 → 元信息 → 玻璃正文卡。 */
export default async function NewsDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = LEGACY_ANNOUNCEMENTS.find((announcement) => announcement.id === id);
  if (!item) notFound();

  return (
    <Container className="ui-page">
      <article className="ui-article mx-auto">
        <p className="ui-eyebrow">NEWS / 公告</p>
        <h1 className="mt-3 text-[clamp(26px,3.4vw,38px)] font-black leading-[1.15] tracking-[-0.02em] text-[var(--pub-txt)]">
          {item.title}
        </h1>
        <p className="mt-3 font-mono text-[11.5px] tracking-[0.1em] text-[var(--pub-txt-mute)]">发布于 {item.date}</p>

        <div className="ui-frame ui-pad mt-6">
          <p className="whitespace-pre-wrap text-[14.5px] leading-[1.9] text-[var(--pub-txt-soft)]">{item.content}</p>
        </div>

        <Link href="/news" className="mt-8 inline-block text-[13.5px] font-bold text-[var(--pub-red)] hover:underline">
          ← 返回公告列表
        </Link>
      </article>
    </Container>
  );
}
