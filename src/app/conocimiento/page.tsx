import { ConocimientoClient } from "@/components/ConocimientoClient";
import { getSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

export default async function ConocimientoPage() {
  const snapshot = await getSnapshot();
  return <ConocimientoClient initialArticles={snapshot.articles} />;
}
