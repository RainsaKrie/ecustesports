import Link from "next/link";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import EventListSwitcher from "@/components/admin/EventListSwitcher";
import { getSiteConfig } from "@/lib/site-config";

export default async function AdminPage() {
  const config = await getSiteConfig();
  return (
    <div className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <AdminPageHeader
        eyebrow="工作人员入口"
        title="赛事列表"
        actions={<div className="flex gap-2"><Link href="/admin/site-content" className="adm-btn adm-btn--secondary adm-btn--md">官网内容</Link><Link href="/admin/events/new" className="adm-btn adm-btn--primary adm-btn--md hover:bg-[var(--adm-red-hover)]">＋ 新建比赛</Link></div>}
      />
      <EventListSwitcher events={config.events} />
    </div>
  );
}
