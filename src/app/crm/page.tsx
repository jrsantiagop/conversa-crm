import { CrmClient } from "@/components/CrmClient";
import { getSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

export default async function CrmPage() {
  return <CrmClient snapshot={await getSnapshot()} />;
}
