import Link from "next/link";
import { EsportEvent } from "@/types";
import { getStatusInfo, formatDate } from "@/lib/utils";
import Badge from "@/components/ui/Badge";

interface EventCardProps {
  event: EsportEvent;
}

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
    <Link
      href={`/events/${event.id}`}
      className="event-card"
      style={{ "--event-color": event.coverColor } as React.CSSProperties}
    >
      <div className="event-card__visual" aria-hidden="true">
        <span className="event-card__serial">EVENT / {event.id.replace("event-", "0")}</span>
        <span className="event-card__monogram">{monogram}</span>
      </div>
      <div className="event-card__content">
        <div className="event-card__status">
          <Badge className={statusInfo.color}>{statusInfo.label}</Badge>
          <span>华理校内赛</span>
        </div>
        <p className="event-card__game">{event.game} / ECUST</p>
        <h3>{event.name}</h3>
        <p className="event-card__description">{event.description}</p>
        <div className="event-card__meta">
          <span>{event.status === "archived" ? "历史资料待补录" : `${event.teamCount} 支队伍`}</span>
          <span>{dateLabel}</span>
        </div>
      </div>
    </Link>
  );
}
