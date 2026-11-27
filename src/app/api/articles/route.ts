import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { newId, workspaceId } from "@/lib/utils";
import type { KnowledgeArticle } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    title?: string;
    content?: string;
    locale?: string;
    published?: boolean;
  };
  const title = body.title?.trim();
  const content = body.content?.trim();
  if (!title || !content) {
    return NextResponse.json({ error: "Título y contenido son obligatorios" }, { status: 400 });
  }
  const now = new Date().toISOString();
  const article: KnowledgeArticle = {
    id: newId("art"),
    workspaceId: workspaceId(),
    title,
    content,
    locale: body.locale?.trim() || "es",
    published: body.published ?? true,
    showInSearch: true,
    createdAt: now,
    updatedAt: now,
  };
  const saved = await getStore().upsertArticle(article);
  return NextResponse.json(saved);
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });
  const store = getStore();
  const article = (await store.listArticles(workspaceId())).find((item) => item.id === id);
  if (!article) return NextResponse.json({ error: "Artículo no encontrado" }, { status: 404 });
  await store.upsertArticle({ ...article, published: false, updatedAt: new Date().toISOString() });
  return NextResponse.json({ ok: true });
}
