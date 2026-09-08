import ReviewWorkspace from "@/components/admin/ReviewWorkspace";

export const metadata = {
  title: "异常赛果工作台",
  description: "管理员异常赛果裁决",
};

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReviewWorkspace eventId={id} />;
}