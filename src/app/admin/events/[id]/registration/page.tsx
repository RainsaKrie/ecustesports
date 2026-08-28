import RegistrationOperationsWorkspace from "@/components/admin/RegistrationOperationsWorkspace";

export default async function RegistrationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RegistrationOperationsWorkspace eventId={id} />;
}
