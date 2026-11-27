/**
 * Facebook Messenger (Graph API).
 * Webhook: entry[].messaging[] (message, postback, attachments). Firma X-Hub-Signature-256.
 * Envío: POST /me/messages con Page Access Token.
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

interface MessengerEvent {
  id: string;
  senderId: string;
  text: string;
  timestamp?: string;
}

function collectEvents(payload: ChannelPayload): MessengerEvent[] {
  const events: MessengerEvent[] = [];

  for (const entry of metaEntries(payload)) {
    const messaging = Array.isArray(entry.messaging) ? entry.messaging : [];
    for (const rawEvent of messaging) {
      const event = asRecord(rawEvent);
      if (!event) continue;
      const sender = asRecord(event.sender) ?? {};
      const message = asRecord(event.message) ?? {};
      const postback = asRecord(event.postback) ?? {};
      const attachments = Array.isArray(message.attachments) ? message.attachments : [];
      const firstAttachment = asRecord(attachments[0]);
      const attachmentPayload = asRecord(firstAttachment?.payload);

      events.push({
        id:
          stringValue(message.mid) ||
          stringValue(message.id) ||
          stringValue(postback.mid) ||
          stringValue(event.message_id),
        senderId: stringValue(sender.id),
        text:
          stringValue(message.text) ||
          stringValue(postback.title) ||
          stringValue(firstAttachment?.title) ||
          stringValue(attachmentPayload?.url) ||
          "",
        timestamp: toIsoTimestamp(event.timestamp),
      });
    }
  }

  return events;
}

function verify(payload: ChannelPayload, credentials: ChannelCredentials): boolean {
  return verifyMetaWebhook(payload, credentials, "messenger");
}

export function messengerVerifyChallenge(payload: ChannelPayload, inbox: Inbox): string | null {
  return getMetaChallenge(payload, inbox, "messenger");
}

function normalize(payload: ChannelPayload, inbox: Inbox): InboundMessage | null {
  const event = collectEvents(payload).find((item) => item.id && item.senderId);
  if (!event) return null;
  return {
    channel: "messenger",
    inboxId: inbox.id,
    externalMessageId: event.id,
    externalContactId: event.senderId,
    body: event.text,
    timestamp: event.timestamp,
    raw: event,
  };
}

async function send(message: OutboundMessage, inbox: Inbox): Promise<OutboundResult> {
  const missing = requireCredentials(inbox, ["pageAccessToken"]);
  if (missing.length) {
    return failedResult(`Messenger: faltan credenciales (${missing.join(", ")})`);
  }
  return sendGraphText(
    inbox,
    getCredential(inbox, "pageAccessToken"),
    message.to ?? "",
    message.body,
    "Messenger",
  );
}

export const messengerAdapter: ChannelAdapter = {
  type: "messenger",
  label: "Facebook Messenger",
  requiredCredentials: ["pageAccessToken"],
  verify,
  normalize,
  send,
};
