/**
 * WhatsApp Cloud API (Meta).
 * Webhook: verificación con hub.verify_token + challenge; eventos en entry[].changes[].value.messages[].
 * Envío: POST https://graph.facebook.com/{version}/{PHONE_NUMBER_ID}/messages con plantilla de texto.
 */

import type { Attachment, Inbox, InboundMessage, OutboundResult } from "@/lib/types";
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
  getPath,
  requireCredentials,
  stringValue,
  toIsoTimestamp,
} from "./types";
import { requestJson, responseId } from "./http";
import { getMetaChallenge, metaEntries, verifyMetaWebhook } from "./meta";

const DEFAULT_VERSION = "v21.0";

function version(inbox: Inbox): string {
  return getCredential(inbox, "apiVersion") || DEFAULT_VERSION;
}

function verify(payload: ChannelPayload, credentials: ChannelCredentials): boolean {
  return verifyMetaWebhook(payload, credentials, "whatsapp");
}

/** Helper para el route handler de verificación GET. */
export function whatsappVerifyChallenge(payload: ChannelPayload, inbox: Inbox): string | null {
  return getMetaChallenge(payload, inbox, "whatsapp");
}

function extractContent(message: Record<string, unknown>): {
  body: string;
  attachments?: Attachment[];
} {
  const body =
    stringValue(getPath(message, "text.body")) ||
    stringValue(getPath(message, "button.text")) ||
    stringValue(getPath(message, "interactive.button_reply.title")) ||
    stringValue(getPath(message, "interactive.list_reply.title")) ||
    stringValue(getPath(message, "image.caption")) ||
    stringValue(getPath(message, "video.caption")) ||
    stringValue(getPath(message, "document.caption")) ||
    "";

  const attachments: Attachment[] = [];
  for (const type of ["image", "video", "audio", "document", "sticker"]) {
    const media = asRecord(message[type]);
    if (!media) continue;
    const mediaId = stringValue(media.id);
    if (!mediaId) continue;
    attachments.push({
      name: stringValue(media.filename) || `${type}-${mediaId}`,
      // El ID de media se descarga con la API de Graph usando el Access Token.
      url: `https://graph.facebook.com/${DEFAULT_VERSION}/${mediaId}`,
      mime: stringValue(media.mime_type) || undefined,
      size: typeof media.size === "number" ? media.size : undefined,
    });
  }

  return { body, attachments: attachments.length ? attachments : undefined };
}

/** Normaliza todos los mensajes del webhook (útil para procesamiento por lotes). */
export function normalizeWhatsAppAll(
  payload: ChannelPayload,
  inbox: Inbox,
): InboundMessage[] {
  const messages: InboundMessage[] = [];

  for (const entry of metaEntries(payload)) {
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const rawChange of changes) {
      const change = asRecord(rawChange);
      if (!change) continue;
      const value = asRecord(change.value);
      if (!value) continue;
      const contacts = asRecord(value.contacts) ?? {};
      const incoming = Array.isArray(value.messages) ? value.messages : [];

      for (const rawMessage of incoming) {
        const message = asRecord(rawMessage);
        if (!message) continue;
        const externalMessageId = stringValue(message.id);
        const externalContactId = stringValue(message.from);
        if (!externalMessageId || !externalContactId) continue;

        const contact = asRecord(contacts[externalContactId]) ?? {};
        const content = extractContent(message);
        messages.push({
          channel: "whatsapp",
          inboxId: inbox.id,
          externalMessageId,
          externalContactId,
          contactName: stringValue(contact.name) || undefined,
          contactPhone: externalContactId,
          body: content.body,
          attachments: content.attachments,
          timestamp: toIsoTimestamp(message.timestamp),
          raw: message,
        });
      }
    }
  }

  return messages;
}

function normalize(payload: ChannelPayload, inbox: Inbox): InboundMessage | null {
  return normalizeWhatsAppAll(payload, inbox)[0] ?? null;
}

async function send(message: OutboundMessage, inbox: Inbox): Promise<OutboundResult> {
  const missing = requireCredentials(inbox, ["phoneNumberId", "accessToken"]);
  if (missing.length) {
    return failedResult(`WhatsApp: faltan credenciales (${missing.join(", ")})`);
  }
  const to = message.to;
  if (!to) return failedResult("WhatsApp: falta el número de destino (to)");

  const templateName =
    message.template?.name || getCredential(inbox, "templateName") || "hello_world";
  const language =
    message.template?.language || getCredential(inbox, "templateLanguage") || "es_ES";
  const variables =
    message.template?.variables ?? (message.body ? [message.body] : []);
  const components = variables.length
    ? [
        {
          type: "body",
          parameters: variables.map((value) => ({ type: "text", text: value })),
        },
      ]
    : undefined;

  const phoneNumberId = getCredential(inbox, "phoneNumberId");
  const accessToken = getCredential(inbox, "accessToken");
  const result = await requestJson(
    `https://graph.facebook.com/${version(inbox)}/${encodeURIComponent(phoneNumberId)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: language },
          ...(components ? { components } : {}),
        },
      }),
    },
  );

  if (!result.ok) return failedResult(`WhatsApp: ${result.error ?? "error desconocido"}`);
  return { delivered: true, externalMessageId: responseId(result.data) };
}

export const whatsappAdapter: ChannelAdapter = {
  type: "whatsapp",
  label: "WhatsApp Cloud API",
  requiredCredentials: ["phoneNumberId", "accessToken"],
  verify,
  normalize,
  send,
};
