import { IntegracionesClient } from "@/components/IntegracionesClient";
import { CHANNEL_DEFINITIONS } from "@/channels/definitions";
import { getSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

export default async function IntegracionesPage() {
  const snapshot = await getSnapshot();
  return <IntegracionesClient definitions={CHANNEL_DEFINITIONS} initialInboxes={snapshot.inboxes} />;
}
