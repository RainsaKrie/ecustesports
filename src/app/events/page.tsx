import { getSiteConfig } from "@/lib/site-config";
import ClientRedirect from "@/components/ClientRedirect";

export default async function EventsPage() {
  const config = await getSiteConfig();
  return <ClientRedirect to={`/events/${config.currentEventId}`} />;
}