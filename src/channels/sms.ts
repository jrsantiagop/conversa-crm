/**
 * SMS de Twilio.
 * Entrada: webhook form-urlencoded (From, To, Body, MessageSid).
 * Salida: POST /Accounts/{SID}/Messages.json con Basic Auth.
 */

import type { Inbox, InboundMessage, OutboundResult } from "@/lib/types";
import type {
  ChannelAdapter,
  ChannelCredentials,
  ChannelPayload,
  OutboundMessage,
} from "./types";
import { failedResult, requireCredentials, stringValue, toIsoTimestamp } from "./types";
import { formBody, requestJson, responseId } from "./http";
import { parseTwilioPayload, twilioApiUrl, twilioAuth, verifyTwilioWebhook } from "./twilio";

function verify(payload: ChannelPayload, credentials: ChannelCredentials): boolean {
  return verifyTwilioWebhook(payload, credentials);
}

function normalize(payload: ChannelPayload, inbox: Inbox): InboundMessage | null {
  const body = parseTwilioPayload(payload);
  const from = stringValue(body.From ?? body.from);
  const externalMessageId = stringValue(body.MessageSid ?? body.messageSid ?? body.SmsSid);
  if (!from && !externalMessageId) return null;

  return {
    channel: "sms",
    inboxId: inbox.id,
    externalMessageId: externalMessageId || `${from}:${stringValue(body.timestamp)}`,
    externalContactId: from,
    contactPhone: from || undefined,
    body: stringValue(body.Body ?? body.body),
    timestamp: toIsoTimestamp(body.timestamp ?? body.Date),
    raw: body,
  };
}

async function send(message: OutboundMessage, inbox: Inbox): Promise<OutboundResult> {
  const missing = requireCredentials(inbox, ["accountSid", "authToken"]);
  if (missing.length) {
    return failedResult(`SMS: faltan credenciales (${missing.join(", ")})`);
  }
  const to = message.to;
  if (!to) return failedResult("SMS: falta el número de destino (to)");

  const auth = twilioAuth(inbox);
  const params: Record<string, string> = { To: to, Body: message.body };
  if (auth.serviceSid) {
    params.MessagingServiceSid = auth.serviceSid;
  } else if (auth.phone) {
    params.From = auth.phone;
  } else {
    return failedResult("SMS: falta el número de Twilio (TWILIO_PHONE_NUMBER)");
  }

  const result = await requestJson(twilioApiUrl(inbox, "Messages.json"), {
    method: "POST",
    headers: {
      Authorization: auth.authorization,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formBody(params),
  });

  if (!result.ok) return failedResult(`SMS: ${result.error ?? "error desconocido"}`);
  return { delivered: true, externalMessageId: responseId(result.data) };
}

export const smsAdapter: ChannelAdapter = {
  type: "sms",
  label: "SMS (Twilio)",
  requiredCredentials: ["accountSid", "authToken"],
  verify,
  normalize,
  send,
};
