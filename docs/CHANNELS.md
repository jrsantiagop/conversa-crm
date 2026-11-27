# Canales de Conversa CRM

Esta capa implementa **un único inbox multi-canal**. Todos los proveedores se convierten al mismo evento interno (`InboundMessage`) y todo envío devuelve el mismo resultado (`OutboundResult`). El código vive en `src/channels/**` y solo usa `fetch` global (sin SDKs externos ni listeners persistentes).

## Arquitectura en breve

| Archivo | Responsabilidad |
| --- | --- |
| `src/channels/types.ts` | `ChannelAdapter`, `ChannelConfig`, `OutboundMessage` y helpers de credenciales/payload. |
| `src/channels/definitions.ts` | Tarjetas para `/integraciones`: qué ID/token se pide a cada canal. |
| `src/channels/registry.ts` | `getAdapter`, `listChannels`, `verifyAndNormalize`, `sendViaChannel`. |
| `src/channels/*.ts` | Un adaptador por proveedor (Meta, Telegram, Twilio, Resend) o canales internos. |

Un route handler típico (fuera de esta carpeta, propiedad de `src/app`) solo necesita:

```ts
import { verifyAndNormalize, sendViaChannel } from "@/channels/registry";

const inbound = verifyAndNormalize("whatsapp", { body, headers, query, rawBody }, inbox);
const result = await sendViaChannel("whatsapp", { body: "Hola", to: "346..." }, inbox);
```

El payload aceptado puede ser el body directo o un sobre `{ body, headers, query, rawBody }`. Las cabeceras se leen en minúsculas; `rawBody` (string) es necesario para validar firmas HMAC.

## Tabla de canales

| Canal (`ChannelType`) | Credenciales requeridas | Opcionales | Entrada (webhook) | Salida |
| --- | --- | --- | --- | --- |
| `widget` | `widgetId` | `identitySecret` | Payload propio del chat | No-op local (ya persistido en el CRM) |
| `whatsapp` | `phoneNumberId`, `accessToken`, `verifyToken` | `businessAccountId`, `appSecret`, `templateName`, `templateLanguage`, `apiVersion` | `entry[].changes[].value.messages[]` | `POST /{PHONE_NUMBER_ID}/messages` (plantilla de texto) |
| `telegram` | `botToken` | `secretToken`, `defaultChatId` | `message` / `edited_message` / `callback_query` | `POST /bot{TOKEN}/sendMessage` |
| `instagram` | `accessToken`, `appSecret` | `igAccountId`, `verifyToken`, `apiVersion` | `entry[].changes[].value.items[]` o `entry[].messaging[]` | `POST /me/messages` |
| `messenger` | `pageAccessToken`, `appSecret` | `pageId`, `verifyToken`, `apiVersion` | `entry[].messaging[]` | `POST /me/messages` |
| `email` | `fromAddress`, `resendApiKey` (para enviar) | `inboundWebhookSecret` | Resend/Postmark: `from`, `subject`, `text` | `POST https://api.resend.com/emails` |
| `sms` | `accountSid`, `authToken`, `phoneNumber` | `messagingServiceSid` | Twilio form-urlencoded (`From`, `Body`, `MessageSid`) | `POST /Accounts/{SID}/Messages.json` (Basic Auth) |
| `voice` | `accountSid`, `authToken`, `phoneNumber` | — | `CallSid`, `SpeechResult`, `Digits` | `POST /Accounts/{SID}/Calls.json` con TwiML `<Say>` |
| `api` | — | `apiKey` | Payload propio | No-op local |

Las credenciales se leen primero de `inbox.credentials` (cifradas en reposo y desencriptadas en servidor) y, si faltan, de las variables de entorno definidas en `CREDENTIAL_ENV_KEYS` (`src/channels/types.ts`). El mapeo coincide con `.env.example`. Nunca se devuelven credenciales al cliente.

## Cómo funciona cada webhook

### WhatsApp Cloud API (Meta)

- **Verificación inicial (GET):** Meta llama con `hub.mode=subscribe`, `hub.challenge` y `hub.verify_token`. El helper `whatsappVerifyChallenge(payload, inbox)` devuelve el challenge solo si el token coincide con `verifyToken`. El route handler debe responder el challenge como texto plano.
- **Mensajes (POST):** se recorren `entry[].changes[].value.messages[]`; se extraen `id`, `from`, `text.body` (o `button`, `interactive`, caption) y el nombre desde `value.contacts`. Si hay `appSecret` y `rawBody`, se valida `X-Hub-Signature-256` (HMAC-SHA256).
- **Envío:** se usa siempre una plantilla de texto aprobada (`type: "template"`), con `templateName` / `templateLanguage` o los valores del mensaje. El texto se envía como parámetro `body`. Meta solo permite mensajes de texto libre durante 24 h después del último mensaje del cliente.
- **Adjuntos:** el webhook trae IDs de media, no URLs públicas. Se guarda la URL de Graph `https://graph.facebook.com/{version}/{mediaId}`; para descargarla hace falta el Access Token.

### Telegram

- Registrar con `setWebhook`. La verificación acepta `secret_token` en la cabecera `X-Telegram-Bot-Api-Secret-Token` o un token en la URL (`?token=` / `?secret_token=`). Telegram no firma el cuerpo.
- Se normalizan `message`, `edited_message`, `channel_post` y mensajes dentro de `callback_query` (`chat.id` como contacto, `message_id` como id externo).
- Envío: `sendMessage` con `chat_id` y `text`. Si el mensaje no trae destinatario se usa `defaultChatId`.

### Instagram y Messenger (Meta Graph)

- Misma mano inicial que WhatsApp: `hub.verify_token` + challenge (helpers `instagramVerifyChallenge` y `messengerVerifyChallenge`).
- Firma opcional `X-Hub-Signature-256` con `appSecret` sobre el cuerpo crudo.
- Instagram acepta `entry[].changes[].value.items[]` (y el formato legado `messaging[]`); Messenger usa `entry[].messaging[]` (`message.text`, `postback.title`, attachments).
- Envío: `POST https://graph.facebook.com/v21.0/me/messages` con `Authorization: Bearer <token>`. Solo responde dentro de la ventana de 24 h permitida por Meta, salvo excepciones.

### Email (Resend / Postmark)

- Entrada: webhook de Resend (firma Svix: `svix-id`, `svix-timestamp`, `svix-signature`) o Postmark. Se extraen `from` (nombre y email), `subject` y `text` (o `TextBody`; si solo hay HTML se limpia).
- Si no hay firma Svix, se admite `X-Webhook-Signature` / `X-Signature` como HMAC hexadecimal con `inboundWebhookSecret`. Sin secreto configurado no se valida (degradación segura).
- Salida: `POST https://api.resend.com/emails` con Bearer `resendApiKey`, `from` = `EMAIL_FROM_ADDRESS`, `to`, `subject` y `text`. Sin API key el adaptador devuelve `delivered: false` con un error descriptivo.

### SMS y Voz (Twilio)

- Twilio envía `application/x-www-form-urlencoded`; el adaptador lo parsea (o acepta el body ya parseado).
- Verificación **opcional**: si llega `X-Twilio-Signature` y se dispone de `authToken` y de la URL absoluta del webhook (`url`, `requestUrl` o `?__url=`), se valida `base64(HMAC-SHA1(authToken, url + parámetros ordenados))`. Sin esos datos no se bloquea el webhook.
- SMS: salida con Basic Auth (`Account SID:Auth Token`) a `Messages.json`, usando `From` o `MessagingServiceSid`.
- Voz: salida a `Calls.json` con TwiML `<Response><Say>...</Say></Response>`; la entrada normaliza `SpeechResult` o `Digits`.

### Widget y API (internos)

- No hay proveedor externo: `normalize` lee un payload propio (`externalContactId`, `body`, etc.) y `send` devuelve `delivered: true` con un ID local, porque el mensaje ya se persiste en la store.
- Opcionalmente, `widget` valida HMAC-SHA256 con `identitySecret` (`X-Widget-Signature`) y `api` valida `Bearer`/`?apiKey=` con `apiKey`.

## Limitaciones en Vercel

- Las funciones son **stateless**: no se pueden abrir listeners, sockets persistentes ni workers en segundo plano. Todo es petición webhook → normalizar → persistir, o petición → enviar.
- Las rutas de webhook deben ser HTTPS públicas y responder rápido (el proveedor espera un 2xx). Procesar trabajos largos debe hacerse fuera de la respuesta.
- Para validar firmas hay que conservar el **cuerpo crudo** (`await request.text()`) y pasar `rawBody` en el payload. Un `await request.json()` pierde la representación exacta.
- Meta y Twilio pueden reenviar eventos: usa `externalMessageId` para idempotencia (`Store.getMessageByExternalId`).
- No se descargan medios dentro del webhook: se guarda el ID/URL de Graph y la descarga se hace bajo demanda con el token.
- Twilio Voice no soporta audio en vivo en este modelo; solo transcripción/DTMF por webhook.
- La API de Meta restringe mensajes salientes a plantillas aprobadas fuera de la ventana de 24 h.
- `node:crypto` se usa solo para HMAC en el runtime de Node de Vercel. No importes `registry` o los adaptadores desde componentes de cliente; la UI debe importar `definitions.ts`.

## Añadir un canal nuevo

1. Añadir el literal al tipo `ChannelType` en `src/lib/types.ts` (fuera de esta carpeta) y su `WEBHOOK_PATHS` / `CREDENTIAL_ENV_KEYS` en `src/channels/types.ts`.
2. Crear `src/channels/<canal>.ts` exportando un `ChannelAdapter` con `type`, `verify`, `normalize` y `send`. Usar `fetch` global, helpers de `./types` y `./http`; devolver `failedResult(...)` en vez de lanzar.
3. Registrar el adaptador en `CHANNEL_ADAPTERS` (`src/channels/registry.ts`). `sendViaChannel` y `verifyAndNormalize` lo usarán automáticamente.
4. Añadir la tarjeta en `CHANNEL_DEFINITIONS` (`src/channels/definitions.ts`) con los `fields` que piden el ID/token y sus URLs de documentación oficial.
5. Documentar el webhook, las credenciales y las limitaciones en este archivo, y crear el route handler correspondiente en `src/app/api/webhooks/<canal>/route.ts`.

Los canales no configurados degradan sin excepciones: `sendViaChannel` devuelve `{ delivered: false, error: "..." }` y `verifyAndNormalize` devuelve `null`.
