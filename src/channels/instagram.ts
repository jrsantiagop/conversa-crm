/**
 * Instagram DM (Messenger Platform / Graph API).
 * Acepta tanto el formato entry[].changes[].value.items[] como el legado
 * entry[].messaging[]. El envío usa POST /me/messages con texto.
 */

import type { Inbox, InboundMessage, OutboundResult } from "@/lib/types";
import type {
  ChannelAdapter,
  ChannelCredentials,
  ChannelPayload,
  OutboundMessage,
} from "./types";
import {
  asRecord,
  failedResult,
  getCredential,
  requireCredentials,
  stringValue,
  toIsoTimestamp,
} from "./types";
import { getMetaChallenge, metaEntries, sendGraphText, verifyMetaWebhook } from "./meta";

interface InstagramEvent {
  id: string;
  senderId: string;
  senderName?: string;
  text: string;
  timestamp?: string;
}

function collectEvents(payload: ChannelPayload): InstagramEvent[] {
  const events: InstagramEvent[] = [];

  for (const entry of metaEntries(payload)) {
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const rawChange of changes) {
      const change = asRecord(rawChange);
      if (!change) continue;
      const value = asRecord(change.value);
      if (!value) continue;
      const from = asRecord(value.from) ?? {};
      const items = Array.isArray(value.items) ? value.items : [];

      for (const rawItem of items) {
        const item = asRecord(rawItem);
        if (!item) continue;
        const itemFrom = asRecord(item.from) ?? {};
        const attachments = Array.isArray(item.attachments) ? item.attachments : [];
        const firstAttachment = asRecord(attachments[0]);
        events.push({
          id: stringValue(item.id),
          senderId:
            stringValue(itemFrom.id) || stringValue(from.id) || stringValue(item.from),
          senderName: stringValue(itemFrom.username) || stringValue(from.username) || undefined,
          text: stringValue(item.text) || stringValue(firstAttachment?.title) || "",
          timestamp: toIsoTimestamp(item.timestamp ?? value.timestamp ?? entry.time),
        });
      }
    }

    const messaging = Array.isArray(entry.messaging) ? entry.messaging : [];
    for (const rawEvent of messaging) {
      const event = asRecord(rawEvent);
      if (!event) continue;
      const sender = asRecord(event.sender) ?? {};
      const message = asRecord(event.message) ?? {};
      const postback = asRecord(event.postback) ?? {};
      events.push({
        id: stringValue(message.id) || stringValue(event.message_id),
        senderId: stringValue(sender.id),
        senderName: stringValue(sender.name) || undefined,
        text: stringValue(message.text) || stringValue(postback.title) || "",
        timestamp: toIsoTimestamp(event.timestamp),
      });
    }
  }

  return events;
}

function verify(payload: ChannelPayload, credentials: ChannelCredentials): boolean {
  return verifyMetaWebhook(payload, credentials, "instagram");
}

export function instagramVerifyChallenge(payload: ChannelPayload, inbox: Inbox): string | null {
  return getMetaChallenge(payload, inbox, "instagram");
}

function normalize(payload: ChannelPayload, inbox: Inbox): InboundMessage | null {
  const event = collectEvents(payload).find((item) => item.id && item.senderId);
  if (!event) return null;
  return {
    channel: "instagram",
    inboxId: inbox.id,
    externalMessageId: event.id,
    externalContactId: event.senderId,
    contactName: event.senderName,
    body: event.text,
    timestamp: event.timestamp,
    raw: event,
  };
}

async function send(message: OutboundMessage, inbox: Inbox): Promise<OutboundResult> {
  const missing = requireCredentials(inbox, ["accessToken"]);
  if (missing.length) {
    return failedResult(`Instagram: faltan credenciales (${missing.join(", ")})`);
  }
  return sendGraphText(
    inbox,
    getCredential(inbox, "accessToken"),
    message.to ?? "",
    message.body,
    "Instagram",
  );
}

export const instagramAdapter: ChannelAdapter = {
  type: "instagram",
  label: "Instagram DM",
  requiredCredentials: ["accessToken"],
  verify,
  normalize,
  send,
};
