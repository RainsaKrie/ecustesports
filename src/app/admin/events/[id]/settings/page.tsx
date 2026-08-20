import AdminPageHeader from "@/components/admin/AdminPageHeader";
import EventSettingsEditor from "@/components/admin/EventSettingsEditor";
import { getSiteConfig } from "@/lib/site-config";
import { notFound } from "next/navigation";

interface SettingsPageProps { params: Promise<{ id: string }> }

export default async function SettingsPage({ params }: SettingsPageProps) {
  const { id } = await params;
  const config = await getSiteConfig();
  const event = config.events.find((candidate) => candidate.id === id);
  if (!event) notFound();
  return <div>
    <AdminPageHeader eyebrow="MODULE 04 / SETTINGS" title="赛事设置" description="维护本届赛事信息、参赛规则、地图池和玩家侧公开内容。" status="负责人确认后发布" />
    <EventSettingsEditor initialEvent={event} />
  </div>;
}
