import { redirect } from "next/navigation";

// 通知中心已删除
export default async function NotificationsRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/admin/events/${id}/schedule`);
}
