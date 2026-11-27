/**
 * Widget web propio (canal interno).
 * No realiza llamadas de red: la recepción llega por un webhook propio y el
 * "envío" se considera entregado al persistirlo localmente en el CRM.
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
  payloadRawBody,
  queryValue,
  resolveCredential,
  stringValue,
  toIsoTimestamp,
} from "./types";
import { verifyHexSignature } from "./crypto";

function verify(payload: ChannelPayload, credentials: ChannelCredentials): boolean {
  const secret = resolveCredential(credentials, "identitySecret", "widget");
  if (!secret) return true;
  const signature =
    headerValue(payload, "x-widget-signature") || queryValue(payload, "signature");
  const rawBody = payloadRawBody(payload);
  if (!signature || !rawBody) return false;
  return verifyHexSignature(secret, rawBody, signature, "") === true;
}

function normalize(payload: ChannelPayload, inbox: Inbox): InboundMessage | null {
  const body = payloadBody(payload);
  const sender = asRecord(body.sender) ?? {};
  const message = asRecord(body.message) ?? {};

  const externalContactId =
    stringValue(body.externalContactId) ||
    stringValue(body.userId) ||
    stringValue(body.contactId) ||
    stringValue(sender.id);
  const text =
    stringValue(body.body) ||
    stringValue(body.text) ||
    stringValue(message.text) ||
    stringValue(message.body);
  if (!externalContactId && !text) return null;

  return {
    channel: "widget",
    inboxId: inbox.id,
    externalMessageId:
      stringValue(body.externalMessageId) ||
      stringValue(body.id) ||
      stringValue(message.id) ||
      localId("widget"),
    externalContactId: externalContactId || localId("visitor"),
    contactName:
      stringValue(body.contactName) ||
      stringValue(sender.name) ||
      stringValue(sender.firstName) ||
      undefined,
    contactEmail: stringValue(body.contactEmail) || stringValue(sender.email) || undefined,
    body: text,
    subject: stringValue(body.subject) || undefined,
    timestamp: toIsoTimestamp(body.timestamp ?? body.createdAt),
    raw: body,
  };
}

/** No-op local: no hay proveedor externo; el mensaje ya queda en la store del CRM. */
async function send(message: OutboundMessage): Promise<OutboundResult> {
  return {
    delivered: true,
    externalMessageId: stringValue(message.metadata?.externalMessageId) || localId("widget-local"),
  };
}

export const widgetAdapter: ChannelAdapter = {
  type: "widget",
  label: "Web widget",
  verify,
  normalize,
  send,
};
