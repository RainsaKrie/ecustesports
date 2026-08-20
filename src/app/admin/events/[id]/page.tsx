import { redirect } from "next/navigation";

// 已取消独立总览页：点击赛事直接进入「赛程」（对阵图是办赛主场）
export default async function EventWorkspaceRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/admin/events/${id}/schedule`);
}
