/**
 * Telegram Bot API.
 *
 * Entrada: webhook JSON con `message` / `edited_message`. Telegram no firma el
 * cuerpo; la protección opcional es el `secret_token` enviado en la cabecera
 * `X-Telegram-Bot-Api-Secret-Token` al configurar `setWebhook`.
 *
 * Salida: POST https://api.telegram.org/bot<TOKEN>/sendMessage con `fetch`.
 * Ninguna función de este módulo lanza excepciones.
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
  errorMessage,
  failedResult,
  getCredential,
  headerValue,
  payloadBody,
  requireCredentials,
  resolveCredential,
  stringValue,
  toIsoTimestamp,
} from "./types";
import { safeEqual } from "./crypto";

const SECRET_HEADER = "x-telegram-bot-api-secret-token";
const TELEGRAM_API = "https://api.telegram.org";

/** Telegram envía IDs numéricos; los normalizamos a string sin perder precisión. */
function idValue(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return stringValue(value);
}

function verify(payload: ChannelPayload, credentials: ChannelCredentials): boolean {
  try {
    const secretToken = resolveCredential(credentials, "secretToken", "telegram");
    if (!secretToken) return true;

    const provided = headerValue(payload, SECRET_HEADER);
    if (!provided) return false;
    return safeEqual(provided, secretToken);
  } catch {
    return false;
  }
}

function normalize(payload: ChannelPayload, inbox: Inbox): InboundMessage | null {
  try {
    const body = payloadBody(payload);
    const raw = asRecord(body.message) ?? asRecord(body.edited_message);
    if (!raw) return null;

    const externalMessageId = idValue(raw.message_id);
    const chat = asRecord(raw.chat) ?? {};
    const externalContactId = idValue(chat.id);
    if (!externalMessageId || !externalContactId) return null;

    const text = stringValue(raw.text) || stringValue(raw.caption);
    if (!text) return null;

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
      body: text,
      timestamp: toIsoTimestamp(raw.date),
      raw,
    };
  } catch {
    return null;
  }
}

async function send(message: OutboundMessage, inbox: Inbox): Promise<OutboundResult> {
  try {
    const missing = requireCredentials(inbox, ["botToken"], "telegram");
    if (missing.length) {
      return failedResult(`Telegram: faltan credenciales (${missing.join(", ")})`);
    }

    const botToken = getCredential(inbox, "botToken");
    if (!botToken) return failedResult("Telegram: falta botToken");

    const to = stringValue(message?.to) || getCredential(inbox, "defaultChatId");
    if (!to) {
      return failedResult("Telegram: falta el chat_id de destino (to) y no hay defaultChatId");
    }

    const text = stringValue(message?.body);
    if (!text) return failedResult("Telegram: el mensaje no tiene texto");

    const response = await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: to, text }),
    });

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return failedResult(`Telegram: respuesta no válida del Bot API (HTTP ${response.status})`);
    }

    const record = asRecord(data);
    if (!response.ok || record?.ok === false) {
      const description = stringValue(record?.description);
      return failedResult(description || `Telegram: error HTTP ${response.status}`);
    }

    const result = asRecord(record?.result) ?? record;
    const externalMessageId = idValue(result?.message_id);
    return { delivered: true, externalMessageId: externalMessageId || undefined };
  } catch (error) {
    return failedResult(`Telegram: ${errorMessage(error)}`);
  }
}

export const telegramAdapter: ChannelAdapter = {
  type: "telegram",
  label: "Telegram Bot API",
  requiredCredentials: ["botToken"],
  verify,
  normalize,
  send,
};
