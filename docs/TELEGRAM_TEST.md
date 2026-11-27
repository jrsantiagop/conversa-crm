# Prueba real de Telegram con Conversa CRM

Guía para conectar un bot de Telegram, recibir mensajes en la bandeja del CRM y responder desde ella. No se necesita ningún SDK ni servicio externo: solo el Bot API de Telegram y `fetch`.

## 1. Requisitos

- Node.js >= 20.9 (para `node --env-file`).
- El proyecto instalado (`npm install` ya hecho) y `npm run dev` funcionando.
- Acceso a Telegram desde el navegador o la app de escritorio.
- Para la prueba con el bot real, una URL HTTPS pública (túnel) o un despliegue. Para simular el webhook no hace falta túnel.

## 2. Crear el bot y obtener el token

1. En Telegram, abre el chat con **@BotFather**.
2. Envía `/newbot` y sigue las instrucciones: nombre visible y username único (debe terminar en `bot`).
3. BotFather devolverá un token parecido a `123456789:AA...`. **Cópialo y no lo compartas ni lo pegues en issues, capturas o logs.**
4. Envía `/setprivacy` a BotFather y elige `Disable` si quieres que el bot reciba **todos** los mensajes de los grupos donde esté (en chats privados no hace falta).

El token se usa en dos sitios: las credenciales del inbox y el script de configuración del webhook.

## 3. Configurar las credenciales

Puedes hacerlo de dos formas. Elige **una**:

### Opción A: desde la UI (`/integraciones`)

Abre la tarjeta de Telegram e introduce:

| Campo | Valor | Obligatorio |
| --- | --- | --- |
| `botToken` | El token de BotFather | Sí |
| `secretToken` | Una cadena larga y aleatoria inventada por ti | No (recomendado) |
| `defaultChatId` | Tu chat id numérico | No (útil como destinatario por defecto) |

Si la app guarda credenciales cifradas, asegúrate de tener `CREDENTIALS_ENCRYPTION_KEY` en `.env.local` (genera una con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).

### Opción B: desde `.env.local`

Copia `.env.example` a `.env.local` y añade/completa:

```dotenv
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
TELEGRAM_DEFAULT_CHAT_ID=
```

`TELEGRAM_WEBHOOK_SECRET` debe ser **exactamente el mismo** valor que `secretToken` si usas la opción A. El adaptador exige la cabecera `x-telegram-bot-api-secret-token` cuando hay secreto configurado; si no hay secreto, no valida nada.

## 4. Levantar la aplicación

```bash
npm run dev
```

Comprueba que la app responde en `http://localhost:3000` y que existe un inbox de canal `telegram` activo (se crea desde `/integraciones`).

## 5. Exponer el webhook (prueba real)

Telegram solo acepta URLs HTTPS públicas. Para un entorno local usa un túnel, por ejemplo:

```bash
ngrok http 3000
# o: cloudflared tunnel --url http://localhost:3000
```

La URL del webhook será la del túnel más la ruta canónica:

```
https://<tu-tunel>.ngrok-free.app/api/webhooks/telegram
```

Cada vez que reinicies el túnel cambia la URL: vuelve a ejecutar el paso 6.

## 6. Registrar el webhook con el script

Desde la raíz del proyecto, con el token ya disponible en el entorno:

```bash
node --env-file=.env.local scripts/telegram-setup.mjs https://<tu-tunel>.ngrok-free.app/api/webhooks/telegram
```

También puedes pasar la URL por variable en lugar de argumento:

```bash
TELEGRAM_WEBHOOK_URL=https://<tu-tunel>.ngrok-free.app/api/webhooks/telegram \
  node --env-file=.env.local scripts/telegram-setup.mjs
```

El script llama a `getMe` (verifica el token) y a `setWebhook` (registra la URL, `allowed_updates` y, si existe, `secret_token`). Imprime el username del bot y el resultado, **nunca el token**. Si algo falla, muestra un error legible y termina con código de salida `1`.

Para comprobar el estado del webhook en cualquier momento:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```

## 7. Probar con un mensaje real

1. Abre un chat con tu bot en Telegram y envía `/start` y luego, por ejemplo, `Hola, probando el CRM`.
2. El bot debe responder (si el auto-respuesta está activo) y el mensaje debe aparecer en la bandeja de conversaciones del CRM como un contacto con el nombre de Telegram y el texto enviado.
3. Responde desde la bandeja. El CRM envía `sendMessage` con `chat_id` = el id externo del contacto; si no hay destinatario, usa `defaultChatId`.
4. Verifica que la respuesta llega al chat de Telegram y que el mensaje queda registrado en la conversación.

> Si el bot no puede escribirte, recuerda que en Telegram **el usuario debe iniciar la conversación** antes de que el bot pueda enviarle mensajes.

## 8. Simular el webhook sin Telegram

Útil para probar la normalización sin túnel. El siguiente payload usa IDs de ejemplo (no son reales):

```json
{
  "update_id": 100001,
  "message": {
    "message_id": 42,
    "from": {
      "id": 987654321,
      "is_bot": false,
      "first_name": "Ana",
      "last_name": "Pérez",
      "username": "ana_test",
      "language_code": "es"
    },
    "chat": {
      "id": 987654321,
      "first_name": "Ana",
      "type": "private"
    },
    "date": 1730000000,
    "text": "Hola, quiero probar el CRM"
  }
}
```

Guárdalo como `simular-telegram.mjs` en la raíz del proyecto (bórralo después) y ejecútalo con `node simular-telegram.mjs`:

```js
const payload = {
  update_id: 100001,
  message: {
    message_id: 42,
    from: {
      id: 987654321,
      is_bot: false,
      first_name: "Ana",
      last_name: "Pérez",
      username: "ana_test",
      language_code: "es",
    },
    chat: { id: 987654321, first_name: "Ana", type: "private" },
    date: 1730000000,
    text: "Hola, quiero probar el CRM",
  },
};

const headers = { "content-type": "application/json" };
// Solo si configuraste secretToken / TELEGRAM_WEBHOOK_SECRET:
if (process.env.TELEGRAM_WEBHOOK_SECRET) {
  headers["x-telegram-bot-api-secret-token"] = process.env.TELEGRAM_WEBHOOK_SECRET;
}

const response = await fetch("http://localhost:3000/api/webhooks/telegram", {
  method: "POST",
  headers,
  body: JSON.stringify(payload),
});

console.log(response.status, await response.text());
```

Con el secreto cargado desde `.env.local`:

```bash
node --env-file=.env.local simular-telegram.mjs
```

Una respuesta `{"ok":true,"conversationId":"...",...}` confirma que el mensaje se normalizó y se persistió. Si devuelve `{"ok":true,"ignored":true}`, revisa el secreto, el formato del payload y que el mensaje tenga `text` o `caption`.

También puedes probar un mensaje editado cambiando la clave `message` por `edited_message`. Los mensajes sin texto (fotos sin caption, stickers, etc.) se ignoran.

## 9. Troubleshooting

| Síntoma | Causa probable | Solución |
| --- | --- | --- |
| `Error: getMe: Unauthorized` en el script | Token incorrecto o revocado | Genera uno nuevo con `/token` en BotFather y actualiza las credenciales. |
| El script dice `Falta TELEGRAM_BOT_TOKEN` | Variable no visible | Usa `node --env-file=.env.local ...` o exporta la variable antes de llamar. Requiere Node >= 20.9. |
| `La URL del webhook debe usar HTTPS` | URL local `http://` | Usa un túnel HTTPS o un despliegue. |
| Telegram responde `Bad Request: can't parse URL` | URL mal formada o inalcanzable | Comprueba la URL con `getWebhookInfo` y vuelve a ejecutar el script. |
| La respuesta del webhook es `ignored: true` | Falta la cabecera secreta, el secreto no coincide, no hay `message`/`edited_message` o no hay texto | Añade `x-telegram-bot-api-secret-token` con el mismo valor configurado y usa un payload con `text`. |
| `Canal no configurado` (404) | No hay inbox activo de canal `telegram` | Crea/habilita el inbox desde `/integraciones`. |
| Llega el mensaje entrante pero falla la respuesta | Falta `chat_id` o el bot no puede escribir al usuario | Configura `defaultChatId` o verifica que el usuario inició la conversación con `/start`. |
| Deja de llegar nada tras reiniciar el túnel | La URL del webhook cambió | Ejecuta de nuevo el script de setup con la nueva URL. |
| El bot responde en grupos que no debería | Privacy mode activo | Usa `/setprivacy` con BotFather para desactivarlo. |

### Comandos útiles de verificación

```bash
# Ver token, URL, secret y últimos errores de entrega
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"

# Quitar el webhook (para volver a getUpdates)
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/deleteWebhook"
```

Sustituye siempre el token por la variable de entorno; no pegues el token literal en la terminal ni en la documentación.
