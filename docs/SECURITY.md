# Seguridad de Conversa CRM

Esta guía describe el modelo de seguridad del proyecto y cómo ampliarlo de forma segura. Está pensada para la clase: cada decisión tiene una explicación y una forma concreta de comprobarla.

El principio rector es **defensa en profundidad**: HTTPS, secretos solo en servidor, verificación de firmas cuando el proveedor las ofrece, límites de tamaño y comparaciones en tiempo constante. Ninguna capa por sí sola basta.

## 1. Modelo de seguridad

### Fronteras de confianza

| Zona | Qué contiene | Regla |
| --- | --- | --- |
| Cliente (navegador) | UI, widget, formularios | Nunca recibe tokens, claves ni credenciales de canales |
| Route handlers / server actions | Webhooks, integraciones, motor | Único lugar que lee secretos y llama a proveedores |
| Store (DB o JSON local) | Conversaciones, inboxes, credenciales cifradas | Credenciales cifradas en reposo; nunca se devuelven al cliente |
| Proveedores externos | Meta, Telegram, Twilio, Resend... | Se autentican con HMAC, token secreto o Bearer según el canal |

Todo código que toque secretos debe ser **server-only**. `src/lib/security/index.ts` está documentado como tal: usa `node:crypto` y no debe importarse desde componentes de cliente. Para la UI existe `src/channels/definitions.ts`, que solo describe campos, no valores.

### Helpers disponibles

`src/lib/security/index.ts` (sin efectos al importar, sin logs de secretos):

| Helper | Uso |
| --- | --- |
| `safeEqual(a, b)` | Comparar tokens, claves o digests en tiempo constante |
| `verifyHmacSha256(secret, rawBody, signature, opts?)` | Validar `sha256=<hex>` (acepta prefijo, hex en cualquier caso y base64 con `opts`) |
| `extractBearer(header)` | Leer `Authorization: Bearer …` |
| `validateApiKey(provided, expected)` | Validar API keys con `safeEqual` |
| `maskSecret(value)` | Mostrar solo los últimos 4 caracteres (`••••••••1234`) |
| `assertBodySize(raw, maxBytes)` | Limitar el cuerpo en **bytes**, no caracteres |
| `readRequiredEnv(name)` | Solo scripts: falla con un error claro si falta la variable |

`src/channels/crypto.ts` contiene los esquemas específicos de proveedor (Twilio HMAC-SHA1 en base64, Svix, etc.). `src/lib/crypto.ts` contiene el cifrado de credenciales. No mezcles responsabilidades.

## 2. Cifrado de credenciales (AES-256-GCM)

Las credenciales introducidas desde la UI se guardan cifradas con `src/lib/crypto.ts`:

- **Algoritmo:** AES-256-GCM (autenticado). Un IV aleatorio de 12 bytes por valor y una etiqueta de autenticación de 16 bytes.
- **Formato:** `v1:<iv hex>:<authTag hex>:<ciphertext hex>`. El prefijo `v1` permite migrar a versiones futuras.
- **Clave:** `CREDENTIALS_ENCRYPTION_KEY`, 32 bytes en hexadecimal (64 caracteres). Generar con:

  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

- **Desarrollo:** si la variable falta, se usa una clave fija de desarrollo y se imprime **una** advertencia. Es cómodo para arrancar, pero **no es seguro**. En producción la variable es obligatoria.
- **Descifrado:** `decryptSecret` devuelve `""` y avisa si el dato está corrupto o la clave cambió. Nunca lanza una excepción hacia el webhook.
- **Lectura:** `decryptCredentials` / `decryptInboxCredentials` desencriptan solo en servidor, justo antes de usar el token. El objeto devuelto por la API al navegador no incluye credenciales.

**Rotar la clave de cifrado no es gratis:** si cambias `CREDENTIALS_ENCRYPTION_KEY`, los valores antiguos dejan de descifrarse. Planea una ventana de doble clave (descifrar con la antigua, cifrar con la nueva) o reprocesa los inboxes. Hazlo en un momento de bajo tráfico y verifica cuántos valores siguen con `v1:` ilegible.

## 3. Verificación de webhooks por canal

Regla de oro: **firma sobre el cuerpo crudo**. En el route handler usa `await request.text()` y pasa ese `rawBody` al adaptador; `await request.json()` destruye la representación exacta y la firma dejará de coincidir. Consulta `docs/CHANNELS.md` para el detalle de cada adaptador.

| Canal | Mecanismo | Helper recomendado |
| --- | --- | --- |
| WhatsApp / Instagram / Messenger | `X-Hub-Signature-256: sha256=<hex>` con `appSecret` sobre el cuerpo crudo | `verifyHmacSha256(appSecret, rawBody, header)` |
| Telegram | `X-Telegram-Bot-Api-Secret-Token` (o token en la URL); Telegram no firma el cuerpo | `validateApiKey(provided, secretToken)` |
| Email (Resend/Svix) | Firma `v1,<base64>` sobre `${id}.${timestamp}.${rawBody}` | Construir el payload y usar `verifyHmacSha256` con `{ encoding: "base64" }`, o `verifySvixSignature` |
| Email (HMAC simple) | `X-Webhook-Signature` / `X-Signature` hexadecimal | `verifyHmacSha256(secret, rawBody, header, { prefix: "" })` |
| SMS / Voz (Twilio) | `X-Twilio-Signature`: base64 de HMAC-SHA1 sobre URL + parámetros ordenados | `verifyTwilioSignature` de `src/channels/crypto.ts` (requiere la URL absoluta) |
| Widget | `X-Widget-Signature` opcional con HMAC-SHA256 sobre el payload propio | `verifyHmacSha256(identitySecret, rawBody, header)` |
| API interna | `Authorization: Bearer <key>` o `?apiKey=` | `extractBearer(header)` + `validateApiKey(key, expected)` |

### Degradación segura

Los adaptadores actuales **no bloquean** un webhook cuando el proveedor no ofrece firma o el secreto no está configurado: devuelven `null`/`ignored`. Es una decisión deliberada para que el aula funcione sin credenciales. En producción, configura siempre el secreto y considera responder `401`/`403` cuando falte. Nunca hagas `if (signature && !valid) allow`: un atacante puede simplemente omitir la cabecera.

El handshake inicial (GET) de Meta compara `hub.verify_token` con `verifyToken`; usa `safeEqual` en lugar de `===` también ahí.

### Límites y repetición

- Aplica `assertBodySize(rawBody, MAX_BYTES)` antes de parsear JSON (por ejemplo 1 MiB, ajustable por canal).
- Los proveedores reenvían eventos: usa `externalMessageId` para idempotencia (`Store.getMessageByExternalId`).
- Responde rápido con 2xx y procesa el trabajo largo fuera de la respuesta; en Vercel las funciones son stateless.
- No aceptes URLs de firma calculadas con la URL que envía el cliente sin validarla: para Twilio usa la URL pública configurada.

## 4. Guardar tokens en Vercel y Supabase

**Vercel**

- Project Settings → Environment Variables. Separa `Production`, `Preview` y `Development`. Los valores de preview nunca deben ser los de producción.
- Marca los secretos como sensibles y restringe quién puede verlos en el equipo.
- Después de cambiar una variable, redeploy: las funciones cachean `process.env` al arrancar.
- `NEXT_PUBLIC_*` se incrusta en el bundle del navegador. Solo `NEXT_PUBLIC_APP_URL` y similares (no secretos) pueden llevar ese prefijo.

**Supabase**

- Guarda secretos en Vault (`vault.secrets`) o en una tabla con cifrado a nivel de columna; no en texto plano en una columna legible por cualquier rol.
- Activa RLS en todas las tablas y da a la app el rol con menos privilegios que pueda funcionar (no `service_role` desde el navegador; `service_role` solo en servidor y solo si es imprescindible).
- La cadena de conexión `DATABASE_URL` va en variables de entorno, nunca en el repositorio ni en un cliente generado y commiteado con credenciales reales.
- Para OAuth de proveedores, guarda `refresh_token` cifrado con la misma clave del proyecto y rota el `access_token` en servidor.

**Local**

- Copia `.env.example` a `.env.local`; `.env.local` está ignorado por Git. No renombres el archivo a `.env` y lo commitees.
- Usa valores falsos en el aula. Un token real que aparece en un commit debe considerarse comprometido aunque se borre después.

## 5. Rotación de keys

1. Genera la nueva clave en el proveedor **sin borrar la antigua** (periodo de solapamiento).
2. Actualiza la variable de entorno en todos los entornos y redeploy.
3. Comprueba que los webhooks siguen verificándose y que los envíos salientes funcionan.
4. Invalida sesiones/tokens derivados si el proveedor lo permite.
5. Retira la clave antigua solo después de confirmar que no queda tráfico usándola.
6. Para `CREDENTIALS_ENCRYPTION_KEY`, sigue además el plan de recifrado del apartado 2.

Frecuencia recomendada: rotación programada cada 90 días para tokens de larga duración e inmediata ante cualquier fuga o cambio de personal. Registra **qué** se rotó y **cuándo**, nunca el valor.

## 6. Añadir un canal nuevo

1. Crea el adaptador y regístralo según `docs/CHANNELS.md`.
2. En el route handler, lee el cuerpo crudo y limítalo antes de verificar:

   ```ts
   import { assertBodySize, safeEqual, verifyHmacSha256 } from "@/lib/security";

   const rawBody = await request.text();
   if (!assertBodySize(rawBody, 1024 * 1024)) {
     return new Response("Payload too large", { status: 413 });
   }

   const signature = request.headers.get("x-nuevo-signature") ?? "";
   if (!verifyHmacSha256(appSecret, rawBody, signature)) {
     return new Response("Unauthorized", { status: 401 });
   }
   ```

3. Compara tokens secretos con `safeEqual` / `validateApiKey`, nunca con `===`.
4. Para depurar, muestra `maskSecret(token)`; el valor completo jamás aparece en logs ni en respuestas.
5. Si el proveedor usa otro algoritmo, añade el helper específico en `src/channels/crypto.ts` y documenta la cabecera, el payload firmado y la URL de verificación en `docs/CHANNELS.md`.
6. Usa `readRequiredEnv` solo en scripts de arranque; en peticiones, un secreto ausente debe traducirse a una respuesta controlada, no a un `throw` sin manejar.

## 7. Qué NO hacer

- ❌ Poner tokens, API keys ni secretos en componentes de cliente, props, estado de React ni variables `NEXT_PUBLIC_*`.
- ❌ Hacer `console.log(token)`, `console.log(req.headers)` completo, ni imprimir el cuerpo con credenciales. Si necesitas identificar una credencial, usa `maskSecret`.
- ❌ Commitear `.env.local`, tokens de ejemplo reales ni capturas con secretos visibles. Si ya pasó, rota la clave: borrar el commit no la invalida.
- ❌ Confiar en el cuerpo ya parseado para calcular HMAC; usa siempre el `rawBody`.
- ❌ Comparar secretos con `===` o aceptar firmas "opcionales" sin configurar el secreto en producción.
- ❌ Devolver credenciales cifradas o descifradas en respuestas de la API, ni guardarlas en `localStorage`.
- ❌ Cambiar `CREDENTIALS_ENCRYPTION_KEY` en producción sin antes planificar el recifrado de los inboxes existentes.
- ❌ Usar el mismo token en varios entornos o compartir credenciales entre alumnos.

## 8. Comprobación rápida

Los helpers tienen pruebas autocontenidas, sin dependencias nuevas:

```bash
node --experimental-strip-types tests/security.test.ts
```

Debe imprimir `14/14 tests passed`. Cuando añadas un canal, agrega un caso de prueba para su firma con un secreto falso y comprueba que una modificación de una sola coma en el cuerpo rompe la validación.
