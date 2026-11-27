import { NextResponse } from "next/server";
import { generateReplyDetailed } from "@/engine/handler";
import { getStore } from "@/lib/db";
import { workspaceId } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const store = getStore();
  const wsId = workspaceId();
  const conversation = await store.getConversation(id);
  if (!conversation) return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });

  const [contact, messages, articles] = await Promise.all([
    store.getContact(conversation.contactId),
    store.listMessages(id),
    store.listArticles(wsId),
  ]);
  if (!contact) return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });

  const resolution = await generateReplyDetailed({
    workspaceId: wsId,
    conversation,
    contact,
    messages,
    articles,
  });

  return NextResponse.json({
    reply: resolution.reply,
    rankedArticles: resolution.rankedArticles.map(({ article, score }) => ({
      id: article.id,
      title: article.title,
      score,
    })),
    autoReplyEnabled: resolution.autoReplyEnabled,
  });
}
