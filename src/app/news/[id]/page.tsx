import Link from "next/link";
import { notFound } from "next/navigation";
import Container from "@/components/layout/Container";
import { LEGACY_ANNOUNCEMENTS } from "@/lib/legacy-site-content";

export default async function NewsDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = LEGACY_ANNOUNCEMENTS.find((announcement) => announcement.id === id);
  if (!item) notFound();

  return (
    <Container className="py-12 sm:py-16">
      <article className="mx-auto max-w-3xl border border-[var(--pub-line-soft)] bg-[var(--pub-card)] p-6 sm:p-10">
        <p className="section-kicker"><span /> NEWS / 公告</p>
        <h1 className="mt-4 text-3xl font-black leading-tight text-[var(--pub-txt)] sm:text-4xl">{item.title}</h1>
        <p className="mt-4 border-b border-[var(--pub-line-soft)] pb-5 font-mono text-xs text-[var(--pub-txt-soft)]">发布于：{item.date}</p>
        <p className="whitespace-pre-wrap pt-7 text-sm leading-8 text-[var(--pub-txt-soft)]">{item.content}</p>
      </article>
      <div className="mt-8 text-center">
        <Link href="/news" className="text-sm font-bold text-[var(--pub-red)] hover:underline">← 返回公告列表</Link>
      </div>
    </Container>
  );
}
