/**
 * Contratos internos de la capa de canales de Conversa CRM.
 *
 * Esta capa es independiente de cualquier librería de terceros: todos los
 * adaptadores usan `fetch` global y los tipos compartidos de `@/lib/types`.
 * Ningún módulo realiza llamadas de red al importarse.
 */

import type {
  Attachment,
  ChannelType,
  Inbox,
  InboundMessage,
  Message,
  OutboundResult,
} from "@/lib/types";

/** Carga útil de un webhook. Puede ser el body, o un sobre { body, headers, query, rawBody }. */
export type ChannelPayload = unknown;

/** Credenciales en texto plano ya desencriptadas por el servidor. */
export type ChannelCredentials = Record<string, string>;

/** Mensaje de salida que cualquier módulo (motor, API, UI) entrega a un canal. */
export interface OutboundMessage {
  body: string;
  /** Destinatario externo: chat id, número de teléfono, email, etc. */
  to?: string;
  subject?: string;
  attachments?: Attachment[];
  /** Plantilla de texto (WhatsApp). */
  template?: {
    name?: string;
    language?: string;
    variables?: string[];
  };
  replyTo?: string;
  metadata?: Record<string, unknown>;
}

/** Acepta tanto un OutboundMessage como un Message persistido por el CRM. */
export type SendInput = OutboundMessage | Message;

/** Contrato que debe cumplir cada canal. */
export interface ChannelAdapter {
  readonly type: ChannelType;
  readonly label?: string;
  /** Credenciales imprescindibles para poder enviar. El registry las valida antes de `send`. */
  readonly requiredCredentials?: readonly string[];
  /** Comprueba token/firma del webhook. Nunca debe lanzar. */
  verify(payload: ChannelPayload, credentials: ChannelCredentials): boolean;
  /** Convierte el payload externo al evento interno. Devuelve null si no es un mensaje. */
  normalize(payload: ChannelPayload, inbox: Inbox): InboundMessage | null;
  /** Envía el mensaje. Debe devolver OutboundResult, nunca lanzar. */
  send(message: OutboundMessage, inbox: Inbox): Promise<OutboundResult>;
}

/** Configuración derivada de un Inbox, con valores no sensibles separados. */
export interface ChannelConfig {
  type: ChannelType;
  enabled: boolean;
  credentials: ChannelCredentials;
  options: Record<string, string>;
  webhookPath: string;
}

/** Rutas canónicas de los webhooks (el owner de src/app puede montarlas donde quiera). */
export const WEBHOOK_PATHS: Record<ChannelType, string> = {
  widget: "/api/webhooks/widget",
  whatsapp: "/api/webhooks/whatsapp",
  telegram: "/api/webhooks/telegram",
  instagram: "/api/webhooks/instagram",
  messenger: "/api/webhooks/messenger",
  email: "/api/webhooks/email",
  sms: "/api/webhooks/sms",
  voice: "/api/webhooks/voice",
  api: "/api/webhooks/api",
};

/** Mapeo canónico de cada credencial a su variable de entorno en Vercel. */
export const CREDENTIAL_ENV_KEYS: Record<ChannelType, Record<string, string>> = {
  widget: {
    widgetId: "WIDGET_ID",
    identitySecret: "WIDGET_IDENTITY_SECRET",
  },
  whatsapp: {
    phoneNumberId: "WHATSAPP_PHONE_NUMBER_ID",
    accessToken: "WHATSAPP_ACCESS_TOKEN",
    businessAccountId: "WHATSAPP_BUSINESS_ACCOUNT_ID",
    verifyToken: "WHATSAPP_VERIFY_TOKEN",
    appSecret: "META_APP_SECRET",
    templateName: "WHATSAPP_TEMPLATE_NAME",
    templateLanguage: "WHATSAPP_TEMPLATE_LANGUAGE",
    apiVersion: "META_API_VERSION",
  },
  telegram: {
    botToken: "TELEGRAM_BOT_TOKEN",
    secretToken: "TELEGRAM_WEBHOOK_SECRET",
    defaultChatId: "TELEGRAM_DEFAULT_CHAT_ID",
  },
  instagram: {
    accessToken: "INSTAGRAM_ACCESS_TOKEN",
    appSecret: "INSTAGRAM_APP_SECRET",
    igAccountId: "INSTAGRAM_ACCOUNT_ID",
    verifyToken: "INSTAGRAM_VERIFY_TOKEN",
    apiVersion: "META_API_VERSION",
  },
  messenger: {
    pageAccessToken: "FACEBOOK_PAGE_ACCESS_TOKEN",
    appSecret: "META_APP_SECRET",
    pageId: "FACEBOOK_PAGE_ID",
    verifyToken: "FACEBOOK_VERIFY_TOKEN",
    apiVersion: "META_API_VERSION",
  },
  email: {
    resendApiKey: "RESEND_API_KEY",
    fromAddress: "EMAIL_FROM_ADDRESS",
    inboundWebhookSecret: "EMAIL_INBOUND_WEBHOOK_SECRET",
  },
  sms: {
    accountSid: "TWILIO_ACCOUNT_SID",
    authToken: "TWILIO_AUTH_TOKEN",
    phoneNumber: "TWILIO_PHONE_NUMBER",
    messagingServiceSid: "TWILIO_MESSAGING_SERVICE_SID",
  },
  voice: {
    accountSid: "TWILIO_ACCOUNT_SID",
    authToken: "TWILIO_AUTH_TOKEN",
    phoneNumber: "TWILIO_PHONE_NUMBER",
  },
  api: {
    apiKey: "API_CHANNEL_KEY",
  },
};

/* -------------------------------------------------------------------------- */
/* Helpers de lectura segura                                                  */
/* -------------------------------------------------------------------------- */

/** Convierte cualquier valor en un objeto plano, o null. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Devuelve un array de objetos plano; ignora entradas corruptas. */
export function asRecords(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => asRecord(item) !== null);
}

/** Devuelve un string recortado, o "" si el valor no es usable. */
export function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Acceso seguro a rutas con puntos: "entry.0.changes". */
export function getPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const part of path.split(".")) {
    const record = asRecord(current);
    if (!record || !Object.prototype.hasOwnProperty.call(record, part)) return undefined;
    current = record[part];
  }
  return current;
}

/** Body del webhook, tanto si viene directo como envuelto en { body }. */
export function payloadBody(payload: ChannelPayload): Record<string, unknown> {
  const root = asRecord(payload);
  if (!root) return {};
  if (Object.prototype.hasOwnProperty.call(root, "body")) {
    return asRecord(root.body) ?? {};
  }
  return root;
}

/** Cabeceras normalizadas a minúsculas. Acepta Headers, object o { request: { headers } }. */
export function payloadHeaders(payload: ChannelPayload): Record<string, string> {
  const root = asRecord(payload);
  if (!root) return {};
  let source: unknown = root.headers ?? getPath(root, "request.headers");
  if (typeof (source as { forEach?: unknown })?.forEach === "function") {
    const headers: Record<string, string> = {};
    try {
      (source as Headers).forEach((value: string, key: string) => {
        headers[key.toLowerCase()] = value;
      });
      return headers;
    } catch {
      return {};
    }
  }
  const record = asRecord(source);
  if (!record) return {};
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string") headers[key.toLowerCase()] = value;
  }
  return headers;
}

/** Query string del webhook: { query } / { params } o directamente en el body. */
export function payloadQuery(payload: ChannelPayload): Record<string, string> {
  const root = asRecord(payload);
  if (!root) return {};
  const source = asRecord(root.query) ?? asRecord(root.params) ?? {};
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string") query[key] = value;
    else if (typeof value === "number") query[key] = String(value);
  }
  return query;
}

/** Cuerpo crudo (necesario para validar firmas HMAC). */
export function payloadRawBody(payload: ChannelPayload): string | undefined {
  const root = asRecord(payload);
  if (!root) return undefined;
  if (typeof root.rawBody === "string") return root.rawBody;
  if (typeof root.body === "string") return root.body;
  return undefined;
}

export function headerValue(payload: ChannelPayload, name: string): string {
  return payloadHeaders(payload)[name.toLowerCase()] ?? "";
}

export function queryValue(payload: ChannelPayload, key: string): string {
  const query = payloadQuery(payload)[key];
  if (query) return query;
  return stringValue(getPath(payloadBody(payload), key));
}

/** Convierte segundos Unix (o ISO) en ISO 8601. */
export function toIsoTimestamp(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value < 1e12 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  return undefined;
}

/** Mensaje de error legible y acotado, sin lanzar nunca. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message.slice(0, 300);
  if (typeof error === "string" && error) return error.slice(0, 300);
  if (error && typeof error === "object") {
    const message = stringValue((error as Record<string, unknown>).message);
    if (message) return message.slice(0, 300);
  }
  return "error desconocido";
}

/** Identificador local para canales internos (sin red). */
export function localId(prefix: string): string {
  const crypto = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  const random =
    crypto && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${random}`;
}

/* -------------------------------------------------------------------------- */
/* Helpers de credenciales                                                    */
/* -------------------------------------------------------------------------- */

function readEnv(name: string | undefined): string {
  if (!name) return "";
  try {
    const env = typeof process !== "undefined" ? process.env : undefined;
    const value = env?.[name];
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

/**
 * Resuelve una credencial priorizando los valores guardados en el Inbox
 * (cifrados en reposo y desencriptados en servidor) sobre las variables de entorno.
 */
export function resolveCredential(
  credentials: ChannelCredentials | undefined,
  key: string,
  type?: ChannelType,
  explicitEnvKey?: string,
): string {
  const value = stringValue(credentials?.[key]);
  if (value) return value;
  const envKey = explicitEnvKey ?? (type ? CREDENTIAL_ENV_KEYS[type]?.[key] : undefined);
  return readEnv(envKey);
}

/** Igual que resolveCredential pero partiendo de un Inbox. */
export function getCredential(inbox: Inbox, key: string): string {
  return resolveCredential(inbox?.credentials, key, inbox?.channel);
}

/** Devuelve las claves que faltan, para construir errores descriptivos. */
export function requireCredentials(
  inbox: Inbox,
  keys: readonly string[],
  type?: ChannelType,
): string[] {
  const channel = type ?? inbox?.channel;
  return keys.filter((key) => !resolveCredential(inbox?.credentials, key, channel));
}

/** Comprueba que todas las credenciales indicadas estén disponibles. */
export function hasCredentials(inbox: Inbox, keys: readonly string[]): boolean {
  return requireCredentials(inbox, keys).length === 0;
}

/** Configuración del canal derivada de un Inbox. */
export function getChannelConfig(inbox: Inbox): ChannelConfig {
  const type = inbox?.channel;
  return {
    type,
    enabled: inbox?.enabled !== false,
    credentials: { ...(inbox?.credentials ?? {}) },
    options: {},
    webhookPath: WEBHOOK_PATHS[type] ?? "/api/webhooks/unknown",
  };
}

/** Convierte cualquier mensaje entrante del CRM en un OutboundMessage. */
export function toOutboundMessage(input: SendInput): OutboundMessage {
  if (!input || typeof input !== "object") return { body: "" };
  const record = input as unknown as Record<string, unknown>;
  const metadata = asRecord(record.metadata) ?? {};
  const template = asRecord(record.template);
  const variables = template?.variables;

  return {
    body: stringValue(record.body),
    to:
      stringValue(
        record.to ??
          metadata.to ??
          metadata.recipient ??
          metadata.externalContactId ??
          metadata.chatId ??
          metadata.phone ??
          metadata.email,
      ) || undefined,
    subject: stringValue(record.subject ?? metadata.subject) || undefined,
    attachments: Array.isArray(record.attachments)
      ? (record.attachments as Attachment[])
      : undefined,
    template: template
      ? {
          name: stringValue(template.name) || undefined,
          language: stringValue(template.language) || undefined,
          variables: Array.isArray(variables)
            ? variables.map((item) => stringValue(item))
            : undefined,
        }
      : undefined,
    replyTo: stringValue(record.replyTo ?? metadata.replyTo) || undefined,
    metadata,
  };
}

/** Resultado de fallo controlado (nunca lanza). */
export function failedResult(error: string): OutboundResult {
  return { delivered: false, error };
}
