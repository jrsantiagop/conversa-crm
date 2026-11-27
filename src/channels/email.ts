/**
 * Email entrante por webhook (Resend / Postmark) y saliente por Resend REST.
 * El remitente se toma siempre de EMAIL_FROM_ADDRESS (o de la credencial del Inbox).
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
  headerValue,
  payloadBody,
  payloadHeaders,
  payloadRawBody,
  queryValue,
  requireCredentials,
  resolveCredential,
  stringValue,
  toIsoTimestamp,
} from "./types";
import { safeEqual, verifyHexSignature, verifySvixSignature } from "./crypto";
import { requestJson, responseId } from "./http";

function parseAddress(value: string): { email: string; name?: string } {
  const match = value.match(/<([^>]+)>/);
  const email = (match?.[1] ?? value).trim();
  const name = match
    ? value
        .slice(0, match.index ?? 0)
        .trim()
        .replace(/^["']|["']$/g, "")
    : "";
  return { email, name: name || undefined };
}

function plainText(payload: Record<string, unknown>): string {
  const text =
    stringValue(payload.text) ||
    stringValue(payload.TextBody) ||
    stringValue(payload.plain) ||
    stringValue(payload.body);
  if (text) return text;
  const html = stringValue(payload.html) || stringValue(payload.HtmlBody);
  return html ? html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : "";
}

function verify(payload: ChannelPayload, credentials: ChannelCredentials): boolean {
  const secret = resolveCredential(credentials, "inboundWebhookSecret", "email");
  if (!secret) return true;

  const rawBody = payloadRawBody(payload);
  const headers = payloadHeaders(payload);
  if (!rawBody) {
    // Sin cuerpo crudo no hay HMAC posible: se admite un secreto explícito.
    const token = headerValue(payload, "x-webhook-secret") || queryValue(payload, "secret");
    return token ? safeEqual(token, secret) : true;
  }
  if (headers["svix-id"]) {
    return verifySvixSignature(secret, rawBody, headers) === true;
  }
  const signature =
    headerValue(payload, "x-webhook-signature") || headerValue(payload, "x-signature");
  if (signature) return verifyHexSignature(secret, rawBody, signature, "") === true;
  return true;
}

function normalize(payload: ChannelPayload, inbox: Inbox): InboundMessage | null {
  const body = payloadBody(payload);
  const headers = payloadHeaders(payload);
  const fromRaw =
    stringValue(body.from) ||
    stringValue(body.From) ||
    stringValue(headers.from) ||
    "";
  if (!fromRaw) return null;
  const sender = parseAddress(fromRaw);
  if (!sender.email) return null;

  const externalMessageId =
    stringValue(body.messageId) ||
    stringValue(body.MessageID) ||
    stringValue(headers["message-id"]) ||
    stringValue(body.id) ||
    `${sender.email}:${stringValue(body.timestamp) || "unknown"}`;

  return {
    channel: "email",
    inboxId: inbox.id,
    externalMessageId,
    externalContactId: sender.email,
    contactName: sender.name,
    contactEmail: sender.email,
    subject: stringValue(body.subject) || stringValue(body.Subject) || undefined,
    body: plainText(body),
    timestamp: toIsoTimestamp(body.timestamp ?? body.Date ?? headers.date),
    raw: body,
  };
}

async function send(message: OutboundMessage, inbox: Inbox): Promise<OutboundResult> {
  const missing = requireCredentials(inbox, ["resendApiKey", "fromAddress"]);
  if (missing.length) {
    return failedResult(`Email: faltan credenciales (${missing.join(", ")})`);
  }
  if (!message.to) return failedResult("Email: falta la dirección de destino (to)");

  const result = await requestJson("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getCredential(inbox, "resendApiKey")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: getCredential(inbox, "fromAddress"),
      to: [message.to],
      subject: message.subject || "(sin asunto)",
      text: message.body,
      ...(message.replyTo ? { reply_to: message.replyTo } : {}),
    }),
  });

  if (!result.ok) return failedResult(`Email: ${result.error ?? "error desconocido"}`);
  return { delivered: true, externalMessageId: responseId(result.data) };
}

export const emailAdapter: ChannelAdapter = {
  type: "email",
  label: "Email (Resend / Postmark)",
  requiredCredentials: ["resendApiKey", "fromAddress"],
  verify,
  normalize,
  send,
};
