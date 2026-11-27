/**
 * Voz de Twilio.
 * Entrada: CallSid, From, SpeechResult o Digits desde el webhook de Twilio.
 * Salida: POST /Accounts/{SID}/Calls.json con TwiML <Say> generado a partir del texto.
 * En Vercel no se mantiene audio en vivo: solo se procesan eventos HTTP.
 */

import type { Inbox, InboundMessage, OutboundResult } from "@/lib/types";
import type {
  ChannelAdapter,
  ChannelCredentials,
  ChannelPayload,
  OutboundMessage,
} from "./types";
import { failedResult, requireCredentials, stringValue, toIsoTimestamp } from "./types";
import { formBody, requestJson, responseId, xmlEscape } from "./http";
import { parseTwilioPayload, twilioApiUrl, twilioAuth, verifyTwilioWebhook } from "./twilio";

function verify(payload: ChannelPayload, credentials: ChannelCredentials): boolean {
  return verifyTwilioWebhook(payload, credentials);
}

function normalize(payload: ChannelPayload, inbox: Inbox): InboundMessage | null {
  const body = parseTwilioPayload(payload);
  const from = stringValue(body.From ?? body.from);
  const callSid = stringValue(body.CallSid ?? body.callSid);
  if (!from && !callSid) return null;

  return {
    channel: "voice",
    inboxId: inbox.id,
    externalMessageId: callSid || `${from}:${stringValue(body.timestamp)}`,
    externalContactId: from,
    contactPhone: from || undefined,
    body: stringValue(body.SpeechResult) || stringValue(body.Digits) || "",
    timestamp: toIsoTimestamp(body.timestamp ?? body.Date),
    raw: body,
  };
}

async function send(message: OutboundMessage, inbox: Inbox): Promise<OutboundResult> {
  const missing = requireCredentials(inbox, ["accountSid", "authToken", "phoneNumber"]);
  if (missing.length) {
    return failedResult(`Voz: faltan credenciales (${missing.join(", ")})`);
  }
  const to = message.to;
  if (!to) return failedResult("Voz: falta el número de destino (to)");

  const auth = twilioAuth(inbox);
  const twiml = `<Response><Say>${xmlEscape(message.body)}</Say></Response>`;
  const result = await requestJson(twilioApiUrl(inbox, "Calls.json"), {
    method: "POST",
    headers: {
      Authorization: auth.authorization,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formBody({ To: to, From: auth.phone, Twiml: twiml }),
  });

  if (!result.ok) return failedResult(`Voz: ${result.error ?? "error desconocido"}`);
  return { delivered: true, externalMessageId: responseId(result.data) };
}

export const voiceAdapter: ChannelAdapter = {
  type: "voice",
  label: "Voz (Twilio)",
  requiredCredentials: ["accountSid", "authToken", "phoneNumber"],
  verify,
  normalize,
  send,
};
