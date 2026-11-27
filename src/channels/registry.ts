/**
 * Registro único de canales de Conversa CRM (un solo inbox, multi-canal).
 *
 * Punto de entrada para el resto de la aplicación:
 *   verifyAndNormalize(type, payload, inbox) -> InboundMessage | null
 *   sendViaChannel(type, message, inbox)      -> Promise<OutboundResult>
 *
 * Ninguna función lanza: los canales no configurados o con credenciales
 * ausentes degradan a OutboundResult(delivered: false, error descriptivo).
 */

import type { ChannelType, Inbox, InboundMessage, OutboundResult } from "@/lib/types";
import type { ChannelAdapter, ChannelPayload, SendInput } from "./types";
import {
  errorMessage,
  failedResult,
  requireCredentials,
  toOutboundMessage,
} from "./types";
import { whatsappAdapter } from "./whatsapp";
import { telegramAdapter } from "./telegram";
import { instagramAdapter } from "./instagram";
import { messengerAdapter } from "./messenger";
import { emailAdapter } from "./email";
import { smsAdapter } from "./sms";
import { voiceAdapter } from "./voice";
import { widgetAdapter } from "./widget";
import { apiAdapter } from "./api";

/** Mapa inmutable de tipo -> adaptador. */
export const CHANNEL_ADAPTERS: Record<ChannelType, ChannelAdapter> = {
  widget: widgetAdapter,
  whatsapp: whatsappAdapter,
  telegram: telegramAdapter,
  instagram: instagramAdapter,
  messenger: messengerAdapter,
  email: emailAdapter,
  sms: smsAdapter,
  voice: voiceAdapter,
  api: apiAdapter,
};

/** Devuelve el adaptador de un tipo, o undefined si el tipo no existe. */
export function getAdapter(type: ChannelType | string | null | undefined): ChannelAdapter | undefined {
  if (!type || typeof type !== "string") return undefined;
  if (!Object.prototype.hasOwnProperty.call(CHANNEL_ADAPTERS, type)) return undefined;
  return CHANNEL_ADAPTERS[type as ChannelType];
}

/** Lista de adaptadores registrados, en el orden de las tarjetas de /integraciones. */
export function listChannels(): ChannelAdapter[] {
  return Object.values(CHANNEL_ADAPTERS);
}

/** Verifica y normaliza un webhook. Nunca lanza. */
export function verifyAndNormalize(
  type: ChannelType | string | null | undefined,
  payload: ChannelPayload,
  inbox: Inbox,
): InboundMessage | null {
  try {
    const adapter = getAdapter(type);
    if (!adapter || !inbox) return null;
    if (!adapter.verify(payload, inbox.credentials ?? {})) return null;
    return adapter.normalize(payload, inbox);
  } catch {
    return null;
  }
}

/** Envía un mensaje por el canal indicado. Nunca lanza. */
export async function sendViaChannel(
  type: ChannelType | string | null | undefined,
  message: SendInput,
  inbox: Inbox,
): Promise<OutboundResult> {
  try {
    if (!inbox || typeof inbox !== "object") {
      return failedResult("Inbox no válido: no se puede enviar el mensaje");
    }
    if (inbox.enabled === false) {
      return failedResult(`El inbox "${inbox.name || inbox.id}" está deshabilitado`);
    }

    const adapter = getAdapter(type);
    if (!adapter) {
      return failedResult(`Canal no soportado: ${String(type ?? "desconocido")}`);
    }

    const missing = requireCredentials(inbox, adapter.requiredCredentials ?? [], adapter.type);
    if (missing.length) {
      return failedResult(
        `${adapter.label ?? adapter.type}: faltan credenciales (${missing.join(", ")})`,
      );
    }

    return await adapter.send(toOutboundMessage(message), inbox);
  } catch (error) {
    return failedResult(`Error al enviar por ${String(type ?? "desconocido")}: ${errorMessage(error)}`);
  }
}
