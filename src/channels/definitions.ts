/**
 * Tarjetas de configuración para la pantalla /integraciones.
 *
 * Es un módulo de datos puro: no importa crypto, fetch ni credenciales, por lo
 * que puede consumirse tanto desde servidor como desde cliente.
 */

import type { ChannelDefinition } from "@/lib/types";

/**
 * Una sola definición por canal. Los `key` coinciden exactamente con las
 * claves que los adaptadores leen de `inbox.credentials` y con
 * `CREDENTIAL_ENV_KEYS` en `./types`.
 */
export const CHANNEL_DEFINITIONS: ChannelDefinition[] = [
  {
    type: "widget",
    name: "Web widget",
    description:
      "Chat propio para tu web. No necesita credenciales externas: el identificador del widget se usa en el script y el secreto opcional firma la identidad del visitante.",
    docsUrl: "/docs/CHANNELS.md#widget-y-api-internos",
    inbound: true,
    outbound: true,
    fields: [
      {
        key: "widgetId",
        label: "ID del widget",
        type: "text",
        placeholder: "site-principal",
        help: "Identificador público que se incluye en el snippet del sitio (WIDGET_ID).",
        required: true,
      },
      {
        key: "identitySecret",
        label: "Secreto de identidad (opcional)",
        type: "password",
        placeholder: "whsec_...",
        help: "Si se rellena, el webhook exige la cabecera X-Widget-Signature con HMAC-SHA256 del cuerpo crudo (WIDGET_IDENTITY_SECRET).",
        required: false,
      },
    ],
  },
  {
    type: "whatsapp",
    name: "WhatsApp Cloud API",
    description:
      "WhatsApp Business mediante la Cloud API de Meta. Necesitas el Phone Number ID y un token de acceso permanente; la verificación del webhook usa el Verify Token elegido por ti.",
    docsUrl: "https://developers.facebook.com/docs/whatsapp/cloud-api/",
    inbound: true,
    outbound: true,
    fields: [
      {
        key: "phoneNumberId",
        label: "Phone Number ID",
        type: "text",
        placeholder: "123456789012345",
        help: "ID del número de teléfono en Meta Business Manager (WHATSAPP_PHONE_NUMBER_ID). Se usa en la URL /{ID}/messages.",
        required: true,
      },
      {
        key: "accessToken",
        label: "Access Token",
        type: "password",
        placeholder: "EAAG...",
        help: "Token de acceso del sistema o permanente con permisos whatsapp_business_messaging (WHATSAPP_ACCESS_TOKEN).",
        required: true,
      },
      {
        key: "verifyToken",
        label: "Verify Token",
        type: "text",
        placeholder: "mi-token-secreto-wa",
        help: "Cadena arbitraria que Meta envía como hub.verify_token al configurar el webhook (WHATSAPP_VERIFY_TOKEN).",
        required: true,
      },
      {
        key: "businessAccountId",
        label: "WhatsApp Business Account ID (opcional)",
        type: "text",
        placeholder: "123456789012346",
        help: "WABA ID; útil para registrar números o consultar plantillas (WHATSAPP_BUSINESS_ACCOUNT_ID).",
        required: false,
      },
      {
        key: "appSecret",
        label: "App Secret (opcional)",
        type: "password",
        placeholder: "abc123...",
        help: "Secreto de la app de Meta para validar X-Hub-Signature-256 en los webhooks (META_APP_SECRET).",
        required: false,
      },
      {
        key: "templateName",
        label: "Plantilla de texto por defecto",
        type: "text",
        placeholder: "hello_world",
        help: "Meta exige plantillas aprobadas fuera de la ventana de 24 h. Se usa si el mensaje no especifica una (WHATSAPP_TEMPLATE_NAME).",
        required: false,
      },
      {
        key: "templateLanguage",
        label: "Idioma de la plantilla",
        type: "text",
        placeholder: "es_ES",
        help: "Código de idioma de la plantilla, p. ej. es_ES o en_US (WHATSAPP_TEMPLATE_LANGUAGE).",
        required: false,
      },
    ],
  },
  {
    type: "telegram",
    name: "Telegram",
    description:
      "Bot de Telegram mediante Bot API. El token del bot se usa tanto para las llamadas a la API como para la verificación opcional del webhook.",
    docsUrl: "https://core.telegram.org/bots/api",
    inbound: true,
    outbound: true,
    fields: [
      {
        key: "botToken",
        label: "Bot Token",
        type: "password",
        placeholder: "123456789:AAF-...",
        help: "Token que entrega @BotFather. Se usa en https://api.telegram.org/bot<TOKEN>/... (TELEGRAM_BOT_TOKEN).",
        required: true,
      },
      {
        key: "secretToken",
        label: "Secret Token (opcional)",
        type: "text",
        placeholder: "mi-secreto-telegram",
        help: "Valor pasado a setWebhook como secret_token; Telegram lo envía en X-Telegram-Bot-Api-Secret-Token (TELEGRAM_WEBHOOK_SECRET).",
        required: false,
      },
      {
        key: "defaultChatId",
        label: "Chat ID por defecto (opcional)",
        type: "text",
        placeholder: "123456789",
        help: "Destinatario usado cuando el mensaje saliente no trae uno (TELEGRAM_DEFAULT_CHAT_ID).",
        required: false,
      },
    ],
  },
  {
    type: "instagram",
    name: "Instagram DM",
    description:
      "Mensajes directos de Instagram mediante Messenger Platform / Graph API. Requiere el token de la cuenta de Instagram y el App Secret para firmar el webhook.",
    docsUrl: "https://developers.facebook.com/docs/messenger-platform/instagram/overview",
    inbound: true,
    outbound: true,
    fields: [
      {
        key: "accessToken",
        label: "Instagram Access Token",
        type: "password",
        placeholder: "EAAG...",
        help: "Token de la cuenta profesional de Instagram con permiso instagram_manage_messages (INSTAGRAM_ACCESS_TOKEN).",
        required: true,
      },
      {
        key: "appSecret",
        label: "App Secret",
        type: "password",
        placeholder: "abc123...",
        help: "Secreto de la app de Meta para validar X-Hub-Signature-256 (INSTAGRAM_APP_SECRET o META_APP_SECRET).",
        required: true,
      },
      {
        key: "igAccountId",
        label: "Instagram Account ID (opcional)",
        type: "text",
        placeholder: "17841400000000000",
        help: "ID de la cuenta de Instagram; el webhook lo suele incluir en entry.id (INSTAGRAM_ACCOUNT_ID).",
        required: false,
      },
      {
        key: "verifyToken",
        label: "Verify Token (opcional)",
        type: "text",
        placeholder: "mi-token-secreto-ig",
        help: "Cadena arbitraria para la mano inicial del webhook de Meta (INSTAGRAM_VERIFY_TOKEN).",
        required: false,
      },
    ],
  },
  {
    type: "messenger",
    name: "Facebook Messenger",
    description:
      "Mensajes de páginas de Facebook mediante Graph API. Necesitas el Page Access Token y el App Secret; el envío usa el endpoint /me/messages.",
    docsUrl: "https://developers.facebook.com/docs/messenger-platform/",
    inbound: true,
    outbound: true,
    fields: [
      {
        key: "pageAccessToken",
        label: "Page Access Token",
        type: "password",
        placeholder: "EAAG...",
        help: "Token de la página con permiso pages_manage_messages (FACEBOOK_PAGE_ACCESS_TOKEN).",
        required: true,
      },
      {
        key: "appSecret",
        label: "App Secret",
        type: "password",
        placeholder: "abc123...",
        help: "Secreto de la app de Meta para validar X-Hub-Signature-256 (META_APP_SECRET).",
        required: true,
      },
      {
        key: "pageId",
        label: "Page ID (opcional)",
        type: "text",
        placeholder: "123456789012345",
        help: "ID de la página de Facebook vinculada (FACEBOOK_PAGE_ID).",
        required: false,
      },
      {
        key: "verifyToken",
        label: "Verify Token (opcional)",
        type: "text",
        placeholder: "mi-token-secreto-fb",
        help: "Cadena arbitraria para la verificación inicial del webhook (FACEBOOK_VERIFY_TOKEN).",
        required: false,
      },
    ],
  },
  {
    type: "email",
    name: "Email (Resend / Postmark)",
    description:
      "Correo entrante por webhook y salida por la API REST de Resend. La dirección de origen se toma de EMAIL_FROM_ADDRESS.",
    docsUrl: "https://resend.com/docs/dashboard/emails/receive-emails",
    inbound: true,
    outbound: true,
    fields: [
      {
        key: "fromAddress",
        label: "Dirección de envío",
        type: "text",
        placeholder: "Conversa <soporte@tuempresa.com>",
        help: "Remitente autorizado en Resend (EMAIL_FROM_ADDRESS). Debe estar verificado en Resend.",
        required: true,
      },
      {
        key: "resendApiKey",
        label: "Resend API Key",
        type: "password",
        placeholder: "re_...",
        help: "Clave de API de Resend para POST /emails (RESEND_API_KEY). Sin ella el canal solo recibe.",
        required: false,
      },
      {
        key: "inboundWebhookSecret",
        label: "Secreto del webhook entrante (opcional)",
        type: "text",
        placeholder: "whsec_...",
        help: "Secreto Svix/HMAC para validar la firma del webhook entrante (EMAIL_INBOUND_WEBHOOK_SECRET).",
        required: false,
      },
    ],
  },
  {
    type: "sms",
    name: "SMS (Twilio)",
    description:
      "SMS entrantes y salientes con Twilio. Se autentica con Basic Auth usando Account SID y Auth Token; la firma del webhook es opcional.",
    docsUrl: "https://www.twilio.com/docs/messaging/guides/webhook-request",
    inbound: true,
    outbound: true,
    fields: [
      {
        key: "accountSid",
        label: "Account SID",
        type: "text",
        placeholder: "AC...",
        help: "SID de la cuenta de Twilio (TWILIO_ACCOUNT_SID).",
        required: true,
      },
      {
        key: "authToken",
        label: "Auth Token",
        type: "password",
        placeholder: "••••••••••••",
        help: "Token de la cuenta; se usa para Basic Auth y, si está disponible, para validar X-Twilio-Signature (TWILIO_AUTH_TOKEN).",
        required: true,
      },
      {
        key: "phoneNumber",
        label: "Número de Twilio",
        type: "text",
        placeholder: "+15551234567",
        help: "Número con formato E.164 usado como remitente (TWILIO_PHONE_NUMBER).",
        required: true,
      },
      {
        key: "messagingServiceSid",
        label: "Messaging Service SID (opcional)",
        type: "text",
        placeholder: "MG...",
        help: "Si se indica, sustituye al número como remitente (TWILIO_MESSAGING_SERVICE_SID).",
        required: false,
      },
    ],
  },
  {
    type: "voice",
    name: "Voz (Twilio)",
    description:
      "Llamadas salientes con Twilio y transcripción/DTMF entrantes por webhook. En Vercel no se mantiene audio en vivo: solo eventos HTTP.",
    docsUrl: "https://www.twilio.com/docs/voice/quickstart",
    inbound: true,
    outbound: true,
    fields: [
      {
        key: "accountSid",
        label: "Account SID",
        type: "text",
        placeholder: "AC...",
        help: "SID de la cuenta de Twilio (TWILIO_ACCOUNT_SID).",
        required: true,
      },
      {
        key: "authToken",
        label: "Auth Token",
        type: "password",
        placeholder: "••••••••••••",
        help: "Token para Basic Auth y validación opcional de X-Twilio-Signature (TWILIO_AUTH_TOKEN).",
        required: true,
      },
      {
        key: "phoneNumber",
        label: "Número de Twilio",
        type: "text",
        placeholder: "+15551234567",
        help: "Número llamante en formato E.164 (TWILIO_PHONE_NUMBER).",
        required: true,
      },
    ],
  },
  {
    type: "api",
    name: "API interna",
    description:
      "Canal programático para integraciones propias. No llama a proveedores externos: normaliza un payload propio y el envío queda registrado localmente.",
    docsUrl: "/docs/CHANNELS.md#widget-y-api-internos",
    inbound: true,
    outbound: true,
    fields: [
      {
        key: "apiKey",
        label: "API Key (opcional)",
        type: "password",
        placeholder: "crm_live_...",
        help: "Si se rellena, el webhook exige Bearer token o ?apiKey= con este valor (API_CHANNEL_KEY).",
        required: false,
      },
    ],
  },
];

/** Acceso rápido por tipo para la UI. */
export function getChannelDefinition(type: string) {
  return CHANNEL_DEFINITIONS.find((definition) => definition.type === type);
}
