import { NextResponse } from "next/server";
import { sendViaChannel } from "@/channels/registry";
import { decryptInboxCredentials } from "@/lib/crypto";
import { getStore } from "@/lib/db";
import { newId, workspaceId } from "@/lib/utils";
import type { Message } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const store = getStore();
  const conversation = await store.getConversation(id);
  if (!conversation) return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
  const messages = await store.listMessages(id);
  return NextResponse.json(messages);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = (await request.json()) as { body?: string; authorName?: string };
  const text = body.body?.trim();
  if (!text) return NextResponse.json({ error: "Mensaje vacío" }, { status: 400 });

  const store = getStore();
  const wsId = workspaceId();
  const conversation = await store.getConversation(id);
  if (!conversation) return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
  const [contact, inboxes] = await Promise.all([
    store.getContact(conversation.contactId),
    store.listInboxes(wsId),
  ]);
  const inbox = inboxes.find((item) => item.id === conversation.inboxId);

  const now = new Date().toISOString();
  const message: Message = {
    id: newId("msg"),
    conversationId: conversation.id,
    direction: "outbound",
    senderType: "agent",
    authorName: body.authorName?.trim() || "Tú",
    body: text,
    createdAt: now,
    metadata: { channel: conversation.channel },
  };

  const delivery = inbox
    ? await sendViaChannel(
        conversation.channel,
        {
          body: text,
          to: contact?.externalIds?.[conversation.channel] || contact?.email || contact?.phone,
          subject: conversation.subject,
          metadata: {
            to: contact?.externalIds?.[conversation.channel] || contact?.email || contact?.phone,
          },
        },
        decryptInboxCredentials(inbox),
      )
    : { delivered: false, error: "No se encontró el inbox de este canal" };

  const saved = await store.addMessage(message);
  await store.upsertConversation({
    ...conversation,
    status: conversation.status === "resolved" ? "open" : conversation.status,
    unread: false,
    lastMessageAt: now,
    updatedAt: now,
  });

  return NextResponse.json({ message: saved, delivery });
}
