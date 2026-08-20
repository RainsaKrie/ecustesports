import { redirect } from "next/navigation";
import { getSiteConfig } from "@/lib/site-config";

// 赛事策划已挂到赛事下（每届赛事独立策划案）
export default async function PlanningRedirect() {
  const config = await getSiteConfig();
  redirect(`/admin/events/${config.currentEventId}/planning`);
}
