import type { Metadata } from "next";
import Link from "next/link";
import Container from "@/components/layout/Container";
import { LEGACY_ANNOUNCEMENTS } from "@/lib/legacy-site-content";

export const metadata: Metadata = {
  title: "公告 | 华东理工大学电竞部",
  description: "查看华东理工大学电竞部最新公告、赛事通知和活动动态。",
};

/**
 * 公告列表（2026-10-20 按 v8 基准改版）
 * 结构：Hero（mono 眉标 + clamp 大标题 + 红句号）→ 分区标题（2px 红底线）→ 行列表。
 * 不再用「卡片墙」：v8 的列表语言是行，日期在前、标题居中、箭头收尾。
 */
export default function NewsPage() {
  return (
    <Container className="ui-page">
      <header className="ui-hero">
        <p className="ui-eyebrow">NEWS</p>
        <h1>
          公告<em>.</em>
        </h1>
        <p className="ui-sub">电竞部公告、赛事通知与活动动态。</p>
      </header>

      <div className="ui-sec">
        <h2>全部公告</h2>
        <span>{String(LEGACY_ANNOUNCEMENTS.length).padStart(2, "0")} 条</span>
      </div>

      <div className="ui-stack mt-4">
        {LEGACY_ANNOUNCEMENTS.map((item) => (
          <Link key={item.id} href={`/news/${item.id}`} className="ui-listrow">
            <time>{item.date}</time>
            <h3>{item.title}</h3>
            <span className="ui-arrow" aria-hidden>→</span>
          </Link>
        ))}
      </div>
    </Container>
  );
}
