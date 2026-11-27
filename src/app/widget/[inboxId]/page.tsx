import { notFound } from "next/navigation";
import { WidgetClient } from "@/components/WidgetClient";
import { getStore } from "@/lib/db";
import { workspaceId } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function WidgetPage({
  params,
}: {
  params: Promise<{ inboxId: string }>;
}) {
  const { inboxId } = await params;
  const inboxes = await getStore().listInboxes(workspaceId());
  const inbox = inboxes.find((item) => item.id === inboxId);
  if (!inbox || inbox.channel !== "widget") notFound();
  return <WidgetClient inboxId={inboxId} />;
}
