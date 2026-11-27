/** Utilidades compartidas por los canales que usan Graph API de Meta. */

import type { Inbox, OutboundResult } from "@/lib/types";
import type { ChannelCredentials, ChannelPayload } from "./types";
import {
  asRecords,
  failedResult,
  getCredential,
  getPath,
  headerValue,
  payloadBody,
  payloadRawBody,
  queryValue,
  resolveCredential,
} from "./types";
import { safeEqual, verifyHexSignature } from "./crypto";
import { requestJson, responseId } from "./http";

export type MetaChannel = "whatsapp" | "instagram" | "messenger";

/** Verifica el token de mano (GET) o la firma X-Hub-Signature-256 (POST). */
export function verifyMetaWebhook(
  payload: ChannelPayload,
  credentials: ChannelCredentials,
  type: MetaChannel,
): boolean {
  const verifyToken = resolveCredential(credentials, "verifyToken", type);
  const received = queryValue(payload, "hub.verify_token");
  if (received) {
    return Boolean(verifyToken) && safeEqual(received, verifyToken);
  }

  const appSecret = resolveCredential(credentials, "appSecret", type);
  if (appSecret) {
    const rawBody = payloadRawBody(payload);
    const signature = headerValue(payload, "x-hub-signature-256");
    if (rawBody && signature) {
      return verifyHexSignature(appSecret, rawBody, signature) === true;
    }
  }

  // Sin datos de verificación no se puede validar; `normalize` decidirá si hay mensaje.
  return true;
}

/** Devuelve el challenge de la verificación inicial, solo si el token coincide. */
export function getMetaChallenge(
  payload: ChannelPayload,
  inbox: Inbox,
  type: MetaChannel,
): string | null {
  const configured = getCredential(inbox, "verifyToken");
  const received = queryValue(payload, "hub.verify_token");
  if (!configured || !received || !safeEqual(received, configured)) return null;
  return queryValue(payload, "hub.challenge") || null;
}

/** Extrae `entry[]` del payload de forma tolerante. */
export function metaEntries(payload: ChannelPayload): Array<Record<string, unknown>> {
  return asRecords(getPath(payloadBody(payload), "entry"));
}

/** Envío de texto por Graph API /me/messages (Instagram y Messenger). */
export async function sendGraphText(
  inbox: Inbox,
  token: string,
  to: string,
  text: string,
  label: string,
): Promise<OutboundResult> {
  if (!token) return failedResult(`${label}: falta el token de acceso de Meta`);
  if (!to) return failedResult(`${label}: falta el identificador del destinatario (to)`);

  const version = getCredential(inbox, "apiVersion") || "v21.0";
  const result = await requestJson(`https://graph.facebook.com/${version}/me/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_type: "RESPONSE",
      recipient: { id: to },
      message: { text },
    }),
  });

  if (!result.ok) return failedResult(`${label}: ${result.error ?? "error desconocido"}`);
  return { delivered: true, externalMessageId: responseId(result.data) };
}
