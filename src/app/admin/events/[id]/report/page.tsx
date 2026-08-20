import { redirect } from "next/navigation";

// 赛事报告暂缓
export default async function ReportRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/admin/events/${id}/schedule`);
}
