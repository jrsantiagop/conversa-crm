/**
 * Canal API interna: integraciones programáticas sin proveedor externo.
 * El payload propio se normaliza al mismo InboundMessage que cualquier canal,
 * y el envío es un no-op local (el mensaje ya se persiste en la store del CRM).
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
  headerValue,
  localId,
  payloadBody,
  queryValue,
  resolveCredential,
  stringValue,
  toIsoTimestamp,
} from "./types";
import { safeEqual } from "./crypto";

function verify(payload: ChannelPayload, credentials: ChannelCredentials): boolean {
  const configured = resolveCredential(credentials, "apiKey", "api");
  if (!configured) return true;
  const bearer = headerValue(payload, "authorization").replace(/^Bearer\s+/i, "");
  const provided = bearer || queryValue(payload, "apiKey") || queryValue(payload, "key");
  return provided ? safeEqual(provided, configured) : false;
}

function normalize(payload: ChannelPayload, inbox: Inbox): InboundMessage | null {
  const body = payloadBody(payload);
  const contact = asRecord(body.contact) ?? {};
  const text =
    stringValue(body.body) ||
    stringValue(body.text) ||
    stringValue(body.message) ||
    "";
  if (!text && !body.externalContactId && !contact.id) return null;

  return {
    channel: "api",
    inboxId: inbox.id,
    externalMessageId:
      stringValue(body.externalMessageId) || stringValue(body.id) || localId("api"),
    externalContactId:
      stringValue(body.externalContactId) ||
      stringValue(contact.id) ||
      localId("api-contact"),
    contactName: stringValue(body.contactName) || stringValue(contact.name) || undefined,
    contactEmail: stringValue(body.contactEmail) || stringValue(contact.email) || undefined,
    contactPhone: stringValue(body.contactPhone) || stringValue(contact.phone) || undefined,
    body: text,
    subject: stringValue(body.subject) || undefined,
    timestamp: toIsoTimestamp(body.timestamp ?? body.createdAt),
    raw: body,
  };
}

async function send(message: OutboundMessage): Promise<OutboundResult> {
  return {
    delivered: true,
    externalMessageId: stringValue(message.metadata?.externalMessageId) || localId("api-local"),
  };
}

export const apiAdapter: ChannelAdapter = {
  type: "api",
  label: "API interna",
  verify,
  normalize,
  send,
};
