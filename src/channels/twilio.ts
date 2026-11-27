/** Utilidades compartidas por los canales SMS y Voz de Twilio. */

import type { Inbox } from "@/lib/types";
import type { ChannelCredentials, ChannelPayload } from "./types";
import {
  asRecord,
  getCredential,
  headerValue,
  payloadBody,
  payloadRawBody,
  queryValue,
  resolveCredential,
  stringValue,
} from "./types";
import { verifyTwilioSignature } from "./crypto";
import { basicAuthHeader } from "./http";

/** Twilio envía application/x-www-form-urlencoded; algunos gateways ya lo parsean. */
export function parseTwilioPayload(payload: ChannelPayload): Record<string, unknown> {
  const rawBody = payloadRawBody(payload);
  if (rawBody && rawBody.includes("=")) {
    return Object.fromEntries(new URLSearchParams(rawBody));
  }
  return payloadBody(payload);
}

/**
 * La firma de Twilio es opcional: si no hay cabecera o no se puede reconstruir
 * la URL absoluta, no se bloquea el webhook (se documenta en docs/CHANNELS.md).
 */
export function verifyTwilioWebhook(
  payload: ChannelPayload,
  credentials: ChannelCredentials,
): boolean {
  const signature =
    headerValue(payload, "x-twilio-signature") ||
    queryValue(payload, "X-Twilio-Signature");
  if (!signature) return true;

  const root = asRecord(payload);
  const url =
    stringValue(root?.url) ||
    stringValue(root?.requestUrl) ||
    headerValue(payload, "x-webhook-url") ||
    queryValue(payload, "__url");
  const authToken = resolveCredential(credentials, "authToken", "sms");
  if (!url || !authToken) return true;

  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(parseTwilioPayload(payload))) {
    if (typeof value === "string") params[key] = value;
  }
  return verifyTwilioSignature(authToken, url, params, signature) === true;
}

export interface TwilioAuth {
  sid: string;
  token: string;
  phone: string;
  serviceSid: string;
  authorization: string;
}

export function twilioAuth(inbox: Inbox): TwilioAuth {
  const sid = getCredential(inbox, "accountSid");
  const token = getCredential(inbox, "authToken");
  return {
    sid,
    token,
    phone: getCredential(inbox, "phoneNumber"),
    serviceSid: getCredential(inbox, "messagingServiceSid"),
    authorization: basicAuthHeader(sid, token),
  };
}

/** URL base de la API REST de Twilio. */
export function twilioApiUrl(inbox: Inbox, resource: string): string {
  const { sid } = twilioAuth(inbox);
  return `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/${resource}`;
}
