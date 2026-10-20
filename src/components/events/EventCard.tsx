import Link from "next/link";
import { EsportEvent } from "@/types";
import { getStatusInfo, formatDate } from "@/lib/utils";

interface EventCardProps {
  event: EsportEvent;
}

/**
 * 赛事卡（2026-10-20 按 v8 基准重写）
 *
 * 旧版是"海报卡"：clip-path 切角 + 每个赛事一个强调色（coverColor）。
 * v8 的规则是**只有一种强调色**、直角、玻璃底 + 左上红折线/右下灰折线 —— 所以：
 *   1. 去掉按赛事的强调色（coverColor 不再参与视觉，数据字段保留）
 *   2. 去掉切角，改用 .ui-frame 的取景框折角
 *   3. 状态标签改用 .ui-tag（mono 10.5px + 1px 线），不再用后台的填充色块
 */
export default function EventCard({ event }: EventCardProps) {
  const statusInfo = getStatusInfo(event.status);
  const monogram = event.game.includes("无畏契约") ? "V" : event.game.slice(0, 1).toUpperCase();
  const dateLabel =
    event.status === "draft"
      ? event.dateLabel ?? "比赛时间待公布"
      : event.status === "archived"
        ? event.dateLabel ?? "查看历史资料"
        : event.dateLabel ?? formatDate(event.eventStart);

  return (
    <Link href={`/events/${event.id}`} className="ui-frame ui-pad group block">
      <div className="flex items-start justify-between gap-4">
        <p className="ui-eyebrow">
          {event.game} / ECUST
        </p>
        <span className={`ui-tag${event.status === "ongoing" ? " live" : ""}`}>{statusInfo.label}</span>
      </div>

      <h3 className="mt-3 text-[22px] font-black leading-[1.15] tracking-[-0.02em] text-[var(--pub-txt)]">
        {event.name}
      </h3>
      <p className="mt-2 line-clamp-2 text-[13.5px] leading-6 text-[var(--pub-txt-soft)]">{event.description}</p>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-[var(--pub-line-soft)] pt-3 font-mono text-[11.5px] text-[var(--pub-txt-mute)]">
        <span aria-hidden>{monogram} / 华理校内赛</span>
        <span>{event.status === "archived" ? "历史资料待补录" : `${event.teamCount} 支队伍`}</span>
        <span>{dateLabel}</span>
      </div>
    </Link>
  );
}
