import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import type { Conversation, ConversationStatus, Priority } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUSES: ConversationStatus[] = ["open", "pending", "resolved", "snoozed"];
const PRIORITIES: Priority[] = ["low", "normal", "high", "urgent"];

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = (await request.json()) as Partial<Conversation>;
  const store = getStore();
  const current = await store.getConversation(id);
  if (!current) return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });

  const updated: Conversation = {
    ...current,
    ...(body.status && STATUSES.includes(body.status) ? { status: body.status } : {}),
    ...(body.priority && PRIORITIES.includes(body.priority) ? { priority: body.priority } : {}),
    ...(typeof body.assigneeId === "string" ? { assigneeId: body.assigneeId || undefined } : {}),
    ...(Array.isArray(body.labels) ? { labels: body.labels.filter((l) => typeof l === "string") } : {}),
    ...(typeof body.unread === "boolean" ? { unread: body.unread } : {}),
    updatedAt: new Date().toISOString(),
  };

  const saved = await store.upsertConversation(updated);
  return NextResponse.json(saved);
}
