import { getConfiguredEvents } from "@/lib/configured-events";
import { getSiteConfig } from "@/lib/site-config";
import ScheduleBracket from "@/components/events/ScheduleBracket";
import Button from "@/components/ui/Button";
import { getStatusInfo } from "@/lib/utils";
import { notFound } from "next/navigation";

interface BracketFullScreenProps {
  params: Promise<{ id: string }>;
}

/**
 * 对阵图全屏视图（2026-10-20 按 v8 基准改版）
 * 改了三处：① 整页 bg-white/[0.06] 换成透明（让 body 的黑底透出）
 * ② 1600px 宽保留 —— 对阵图需要横向空间，但左右留白与公开面一致（28px）
 * ③ 页头从「标题 + Badge」换成 v8 Hero + .ui-tag，返回按钮用 outline 变体
 */
export default async function BracketFullScreenPage({ params }: BracketFullScreenProps) {
  const { id } = await params;
  const events = getConfiguredEvents(await getSiteConfig());
  const event = events.find((item) => item.id === id);
  if (!event) notFound();
  const statusInfo = getStatusInfo(event.status);

  return (
    <div className="min-h-screen">
      <div className="mx-auto w-full max-w-[1600px] px-7 pb-16 pt-9">
        <header className="ui-hero">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`ui-tag${event.status === "ongoing" ? " live" : ""}`}>{statusInfo.label}</span>
            <span className="font-mono text-[11.5px] tracking-[0.14em] text-[var(--pub-txt-mute)]">BRACKET / 对阵图</span>
          </div>
          <h1>
            {event.name}
            <em>.</em>
          </h1>
          <p className="ui-sub">完整对阵图 —— 点击任意场次可查看逐图结果与时间。</p>
        </header>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <Button href={`/events/${event.id}`} variant="outline">
            ← 返回赛事详情
          </Button>
          <span className="font-mono text-[11.5px] tracking-[0.1em] text-[var(--pub-txt-mute)]">FULL VIEW</span>
        </div>

        <div className="ui-frame mt-4 overflow-x-auto p-4">
          <ScheduleBracket eventId={id} />
        </div>
      </div>
    </div>
  );
}
