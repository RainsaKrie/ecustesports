import { redirect } from "next/navigation";
import { getSiteConfig } from "@/lib/site-config";

export default async function BracketCompatPage() {
  const config = await getSiteConfig();
  const event = config.events.find((item) => item.id === config.currentEventId) ?? config.events[0];
  redirect(event ? `/events/${event.id}?tab=${encodeURIComponent("对阵图")}` : "/events");
}
