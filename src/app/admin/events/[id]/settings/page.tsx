import AdminPageHeader from "@/components/admin/AdminPageHeader";
import EventSettingsWorkspace from "@/components/admin/EventSettingsWorkspace";
import { getSiteConfig } from "@/lib/site-config";
import { getCommonRuleLibrary } from "@/lib/rule-library";
import { notFound } from "next/navigation";

interface SettingsPageProps { params: Promise<{ id: string }> }

export default async function SettingsPage({ params }: SettingsPageProps) {
  const { id } = await params;
  const [config, commonRules] = await Promise.all([getSiteConfig(), getCommonRuleLibrary()]);
  const event = config.events.find((candidate) => candidate.id === id);
  if (!event) notFound();
  return <div>
    <AdminPageHeader eyebrow="模块 03" title="赛事设置" />
    <EventSettingsWorkspace initialEvent={event} initialCommonRules={commonRules} eventCount={config.events.length} />
  </div>;
}
