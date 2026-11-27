import { InboxClient } from "@/components/InboxClient";
import { getSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  return <InboxClient snapshot={await getSnapshot()} />;
}
