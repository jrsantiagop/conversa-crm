/**
 * Telegram Bot API.
 * Webhook: el token puede viajar en la URL (?token=...) o como secret_token
 * (X-Telegram-Bot-Api-Secret-Token). Telegram no firma el cuerpo.
 * Envío: POST https://api.telegram.org/bot<TOKEN>/sendMessage.
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
  queryValue,
  requireCredentials,
  resolveCredential,
  stringValue,
  toIsoTimestamp,
} from "./types";
import { safeEqual } from "./crypto";
import { requestJson, responseId } from "./http";

function verify(payload: ChannelPayload, credentials: ChannelCredentials): boolean {
  const secretToken = resolveCredential(credentials, "secretToken", "telegram");
  const headerToken = headerValue(payload, "x-telegram-bot-api-secret-token");
  if (secretToken && headerToken) return safeEqual(headerToken, secretToken);

  const urlToken = queryValue(payload, "token") || queryValue(payload, "secret_token");
  if (urlToken) {
    const secret =
      secretToken || resolveCredential(credentials, "botToken", "telegram");
    return Boolean(secret) && safeEqual(urlToken, secret);
  }

  return true;
}

function normalize(payload: ChannelPayload, inbox: Inbox): InboundMessage | null {
  const body = payloadBody(payload);
  const callbackQuery = asRecord(body.callback_query);
  const raw =
    asRecord(body.message) ??
    asRecord(body.edited_message) ??
    asRecord(body.channel_post) ??
    asRecord(callbackQuery?.message);

  if (!raw) return null;

  const externalMessageId = stringValue(raw.message_id);
  const chat = asRecord(raw.chat) ?? {};
  const externalContactId = stringValue(chat.id);
  if (!externalMessageId || !externalContactId) return null;

  const from = asRecord(raw.from) ?? {};
  const firstName = stringValue(from.first_name);
  const lastName = stringValue(from.last_name);
  const username = stringValue(from.username);
  const contactName = [firstName, lastName].filter(Boolean).join(" ") || username || undefined;

  return {
    channel: "telegram",
    inboxId: inbox.id,
    externalMessageId,
    externalContactId,
    contactName,
    body:
      stringValue(raw.text) ||
      stringValue(raw.caption) ||
      stringValue(asRecord(body.callback_query)?.data) ||
      "",
    timestamp: toIsoTimestamp(raw.date),
    raw,
  };
}

async function send(message: OutboundMessage, inbox: Inbox): Promise<OutboundResult> {
  const missing = requireCredentials(inbox, ["botToken"]);
  if (missing.length) {
    return failedResult(`Telegram: faltan credenciales (${missing.join(", ")})`);
  }
  const to = message.to || getCredential(inbox, "defaultChatId");
  if (!to) return failedResult("Telegram: falta el chat_id de destino (to)");

  const botToken = getCredential(inbox, "botToken");
  const result = await requestJson(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: to, text: message.body }),
  });

  if (!result.ok) return failedResult(`Telegram: ${result.error ?? "error desconocido"}`);
  const data = asRecord(result.data);
  const messageId = data ? stringValue(data.message_id) : "";
  return { delivered: true, externalMessageId: messageId || responseId(result.data) };
}

export const telegramAdapter: ChannelAdapter = {
  type: "telegram",
  label: "Telegram Bot API",
  requiredCredentials: ["botToken"],
  verify,
  normalize,
  send,
};
