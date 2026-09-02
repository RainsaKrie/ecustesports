import type { Metadata } from "next";
import Link from "next/link";
import Container from "@/components/layout/Container";
import { LEGACY_ANNOUNCEMENTS } from "@/lib/legacy-site-content";

export const metadata: Metadata = {
  title: "公告 | 华东理工大学电竞部",
  description: "查看华东理工大学电竞部最新公告、赛事通知和活动动态。",
};

export default function NewsPage() {
  return (
    <Container className="py-10 sm:py-16">
      <header className="border-b border-black/15 pb-7">
        <p className="section-kicker"><span /> NEWS</p>
        <h1 className="text-3xl font-black text-slate-950 sm:text-5xl">公告</h1>
      </header>
      <div className="mt-6 grid gap-3">
        {LEGACY_ANNOUNCEMENTS.map((item) => (
          <Link key={item.id} href={`/news/${item.id}`} className="group grid gap-3 border border-black/10 bg-[#fffdf8] p-5 transition hover:border-[#ff4655] sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:items-center">
            <time className="font-mono text-xs font-bold text-slate-500">{item.date}</time>
            <h2 className="text-base font-black text-slate-950 sm:text-lg">{item.title}</h2>
            <span className="text-[#ff4655] transition group-hover:translate-x-1" aria-hidden>→</span>
          </Link>
        ))}
      </div>
    </Container>
  );
}
