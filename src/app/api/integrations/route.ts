import { NextResponse } from "next/server";
import { CHANNEL_DEFINITIONS } from "@/channels/definitions";
import { encryptCredentials } from "@/lib/crypto";
import { getStore } from "@/lib/db";
import { workspaceId } from "@/lib/utils";
import { newId } from "@/lib/utils";
import type { Inbox } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    inboxId?: string;
    name?: string;
    enabled?: boolean;
    credentials?: Record<string, string>;
    clear?: string[];
  };
  const store = getStore();
  const wsId = workspaceId();
  const inboxes = await store.listInboxes(wsId);
  const existing = inboxes.find((inbox) => inbox.id === body.inboxId);

  if (!existing && !body.inboxId) {
    return NextResponse.json({ error: "Falta inboxId" }, { status: 400 });
  }
  if (!existing) return NextResponse.json({ error: "Inbox no encontrado" }, { status: 404 });

  const definition = CHANNEL_DEFINITIONS.find((item) => item.type === existing.channel);
  const allowed = new Set(definition?.fields.map((field) => field.key) ?? []);
  const nextCredentials: Record<string, string> = { ...(existing.credentials ?? {}) };

  for (const key of body.clear ?? []) {
    if (allowed.has(key)) delete nextCredentials[key];
  }
  for (const [key, value] of Object.entries(body.credentials ?? {})) {
    if (!allowed.has(key)) continue;
    if (typeof value === "string" && value.trim()) {
      nextCredentials[key] = value.trim();
    } else if (value === "") {
      delete nextCredentials[key];
    }
  }

  const now = new Date().toISOString();
  const inbox: Inbox = {
    ...existing,
    name: body.name?.trim() || existing.name,
    enabled: typeof body.enabled === "boolean" ? body.enabled : existing.enabled,
    credentials: encryptCredentials(nextCredentials),
    updatedAt: now,
  };
  const saved = await store.upsertInbox(inbox);

  return NextResponse.json({
    ok: true,
    inbox: {
      id: saved.id,
      name: saved.name,
      channel: saved.channel,
      enabled: saved.enabled,
      credentialKeys: Object.entries(saved.credentials ?? {})
        .filter(([, value]) => Boolean(value))
        .map(([key]) => key),
    },
  });
}
