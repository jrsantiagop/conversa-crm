import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { newId, workspaceId } from "@/lib/utils";
import type { Deal, Task } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    kind?: "deal" | "task";
    title?: string;
    value?: number;
    currency?: string;
    stage?: string;
    contactId?: string;
    dueAt?: string;
  };
  const title = body.title?.trim();
  if (!title) return NextResponse.json({ error: "Título obligatorio" }, { status: 400 });

  const store = getStore();
  const wsId = workspaceId();
  const now = new Date().toISOString();

  if (body.kind === "task") {
    const task: Task = {
      id: newId("task"),
      workspaceId: wsId,
      title,
      done: false,
      ...(body.dueAt ? { dueAt: body.dueAt } : {}),
      ...(body.contactId ? { contactId: body.contactId } : {}),
      createdAt: now,
    };
    return NextResponse.json(await store.upsertTask(task));
  }

  const deal: Deal = {
    id: newId("deal"),
    workspaceId: wsId,
    contactId: body.contactId || "",
    title,
    value: Number(body.value) || 0,
    currency: body.currency?.trim() || "EUR",
    stage: body.stage?.trim() || "Nuevo",
    createdAt: now,
    updatedAt: now,
  };
  return NextResponse.json(await store.upsertDeal(deal));
}
