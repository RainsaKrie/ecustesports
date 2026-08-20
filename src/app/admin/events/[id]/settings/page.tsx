import AdminPageHeader from "@/components/admin/AdminPageHeader";
import SiteContentEditor from "@/components/admin/SiteContentEditor";
import { getSiteConfig } from "@/lib/site-config";

interface SettingsPageProps { params: Promise<{ id: string }> }

export default async function SettingsPage({ params }: SettingsPageProps) {
  await params;
  const config = await getSiteConfig();
  return <div>
    <AdminPageHeader eyebrow="MODULE 08 / GOVERN" title="公开内容与赛事设置" description="由赛事负责人维护公开页面文案、本届赛事信息、参赛规则和往届说明。保存后前台直接读取，无需修改代码。" status="仅负责人可修改" />
    <SiteContentEditor initialConfig={config} />
  </div>;
}
