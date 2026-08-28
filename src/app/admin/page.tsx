import Link from "next/link";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import EventListSwitcher from "@/components/admin/EventListSwitcher";
import { getSiteConfig } from "@/lib/site-config";

export default async function AdminPage() {
  const config = await getSiteConfig();
  return (
    <div className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <AdminPageHeader
        eyebrow="STAFF ONLY / 工作人员入口"
        title="赛事列表"
        actions={<div className="flex gap-2"><Link href="/admin/site-content" className="border border-black/15 bg-[#fffdf8] px-5 py-3 text-xs font-black text-[#34383f]">官网内容</Link><Link href="/admin/events/new" className="bg-[#ff4655] px-5 py-3 text-xs font-black text-white transition hover:bg-[#d83b48]">＋ 新建比赛</Link></div>}
      />
      <EventListSwitcher events={config.events} />
    </div>
  );
}
