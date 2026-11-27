import { NextResponse } from "next/server";
import { sendViaChannel, verifyAndNormalize } from "@/channels/registry";
import { decryptCredentials, decryptInboxCredentials } from "@/lib/crypto";
import { getStore } from "@/lib/db";
import { handleInboundMessage } from "@/engine/handler";
import { workspaceId } from "@/lib/utils";
import type { ChannelType } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ channel: string }> };

function findInbox(channel: string) {
  const store = getStore();
  return store.listInboxes(workspaceId()).then((inboxes) => {
    const ofChannel = inboxes.filter((inbox) => inbox.channel === channel);
    return ofChannel.find((inbox) => inbox.enabled) ?? ofChannel[0];
  });
}

/** Verificación inicial de webhooks (Meta challenge, Telegram, etc.). */
export async function GET(request: Request, context: Ctx) {
  const { channel } = await context.params;
  const url = new URL(request.url);
  const inbox = await findInbox(channel);
  if (!inbox) return NextResponse.json({ error: "Canal no configurado" }, { status: 404 });

  const credentials = decryptCredentials(inbox.credentials);
  const token = url.searchParams.get("hub.verify_token") ?? url.searchParams.get("verify_token") ?? "";
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  const expected =
    credentials.verifyToken ?? credentials.secretToken ?? credentials.inboundWebhookSecret ?? "";

  if (expected && token && token === expected && challenge) {
    return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  }
  if (channel === "telegram" && !expected) {
    return new Response("ok", { status: 200 });
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}

/** Entrada universal: verifica, normaliza y persiste un mensaje de cualquier canal. */
export async function POST(request: Request, context: Ctx) {
  const { channel } = await context.params;
  const store = getStore();
  const wsId = workspaceId();
  const inbox = await findInbox(channel);
  if (!inbox) return NextResponse.json({ error: "Canal no configurado" }, { status: 404 });

  const rawBody = await request.text();
  let body: unknown;
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    body = rawBody;
  }

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  const query = Object.fromEntries(new URL(request.url).searchParams.entries());

  const payload = { body, rawBody, headers, query };
  const plainInbox = decryptInboxCredentials(inbox);
  const inbound = verifyAndNormalize(channel as ChannelType, payload, plainInbox);
  if (!inbound) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const result = await handleInboundMessage(inbound, store, wsId, {
    defaultInboxName: inbox.name,
  });

  let delivery: { delivered: boolean; error?: string } | undefined;
  if (result.autoReplyEnabled && result.outboundMessage) {
    delivery = await sendViaChannel(
      channel as ChannelType,
      {
        body: result.reply.body,
        to: result.contact.externalIds?.[channel] || result.contact.email || result.contact.phone,
        metadata: {
          to: result.contact.externalIds?.[channel] || result.contact.email || result.contact.phone,
        },
      },
      plainInbox,
    );
  }

  return NextResponse.json({
    ok: true,
    conversationId: result.conversation.id,
    autoReply: result.autoReplyEnabled,
    handoff: result.handoffApplied,
    delivery,
  });
}
