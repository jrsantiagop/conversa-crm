# Despliegue en Vercel — guía de clase

Esta guía acompaña el despliegue de **Conversa CRM** en Vercel. El proyecto es
independiente y no depende de infraestructura de terceros más allá de los
servicios estándar (Postgres y las APIs de los canales que decidas conectar).

---

## 0. Comprobación previa en local

Antes de tocar Vercel, verifica que el proyecto compila en tu máquina:

```bash
cd conversa-crm
npm run typecheck   # opcional pero recomendado
npm run build       # comprobación obligatoria
```

`npm run build` debe terminar sin errores. Si falla, corrígelo en local: Vercel
ejecuta exactamente el mismo comando (declarado en `vercel.json`) y un build
local que falla también fallará en la plataforma.

Comprueba también las variables antes de subir nada, sin exponer valores:

```bash
node scripts/vercel-env-check.mjs
```

El script imprime solo el nombre de cada variable y `SI` / `NO`; nunca muestra
su contenido. Puedes ejecutarlo con `.env.local` presente o con las variables
inyectadas en el entorno (en Vercel, `process.env` manda sobre el archivo).

---

## 1. Importar el repositorio

1. Entra en Vercel → **Add New… → Project**.
2. En **Import Git Repository**, pega la URL:
   <https://github.com/jrsantiagop/conversa-crm>
   (si tu cuenta no ve el repo, añade primero la integración de GitHub o usa
   **Import Third-Party Repository** con esa misma URL).
3. Vercel detecta el framework **Next.js** automáticamente. Confirma:
   - **Framework Preset:** Next.js
   - **Build Command:** `npm run build`
   - **Output Directory:** `.next`
   - **Root Directory:** `.` (raíz del repositorio)
   - **Node.js:** 20.x o superior (`engines` pide `>=20.9.0`)
4. `vercel.json` fija la región `iad1` (Este de EE. UU.) y
   `maxDuration: 15` para `src/app/api/**/route.ts`. No hace falta cambiar nada
   más en la configuración del proyecto.
5. Pulsa **Deploy**. La primera compilación puede fallar si aún no existen las
   variables de entorno; es normal: añádelas (sección 2) y haz **Redeploy**.

> `cleanUrls` está activado, así que las rutas funcionan con o sin barra final.

---

## 2. Variables de entorno

Ve a **Project Settings → Environment Variables**. Añade cada variable para
**Production** y, si quieres entornos de prueba separados, también para
**Preview**. Marca como secretos todo lo que no deba verse en la UI.

### Obligatorias en Vercel

| Variable | Qué poner | Por qué |
| --- | --- | --- |
| `DATABASE_URL` | Cadena de conexión **pooled** de Neon/Supabase | En Vercel el filesystem es efímero; el modo JSON local no es válido. Sin esta variable verás `storage: "local"` en `/api/health`. |
| `CREDENTIALS_ENCRYPTION_KEY` | 32 bytes en hexadecimal, distinta en cada entorno | Cifra las credenciales de los canales guardadas desde la UI. Nunca la compartas ni la prefijes con `NEXT_PUBLIC_`. |

Genera la clave de cifrado con:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Para la base de datos, usa el host/puerto del *pooler* (en Neon, el host
*pooled*; en Supabase, el *transaction pooler*). Las funciones serverless abren
y cierran conexiones constantemente y una cadena directa agota el pool. Aplica
después el esquema `src/lib/db/schema.sql` con `psql` o el editor SQL del
proveedor. Si vas a usar RAG, habilita `CREATE EXTENSION IF NOT EXISTS vector;`.

### Recomendadas

| Variable | Valor |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | `https://<tu-dominio>` o `https://<proyecto>.vercel.app`, sin barra final. Se expone al navegador. |
| `APP_NAME` | `Conversa CRM` |
| `DEFAULT_WORKSPACE_ID` | `default` o el ID real |

### Opcionales (según lo que actives)

| Grupo | Variables |
| --- | --- |
| Motor conversacional | `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `BOT_AUTO_REPLY`, `BOT_CONFIDENCE_THRESHOLD` |
| WhatsApp | `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_VERIFY_TOKEN` |
| Telegram | `TELEGRAM_BOT_TOKEN` |
| Instagram / Messenger | `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_APP_SECRET`, `FACEBOOK_PAGE_ACCESS_TOKEN` |
| Email entrante | `EMAIL_INBOUND_WEBHOOK_SECRET`, `EMAIL_FROM_ADDRESS` |
| SMS / Voz | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` |
| Widget | `WIDGET_IDENTITY_SECRET` |

Empieza con `BOT_AUTO_REPLY=false`: el bot **sugiere** y una persona decide.
Las credenciales también se pueden introducir desde **Integraciones** en la UI
y se guardan cifradas; en ese caso no hace falta repetirlas como variables de
entorno.

Después de cambiar cualquier variable, haz **Redeploy**: las variables no se
aplican retroactivamente a builds anteriores.

> No pegues tokens ni claves en comentarios, tickets ni logs. `npm run build` y
> los logs de Vercel pueden mostrar el nombre de la variable, nunca su valor.

---

## 3. Verificar `/api/health`

Con el despliegue listo:

```bash
curl -s https://<tu-dominio>/api/health
```

Respuesta esperada (`timestamp` varía):

```json
{
  "status": "ok",
  "timestamp": "2026-01-01T12:00:00.000Z",
  "storage": "postgres",
  "version": "0.1.0"
}
```

Interpretación:

- `status: "ok"` → la función responde y el despliegue está vivo.
- `storage: "postgres"` → `DATABASE_URL` está configurada. Si dice `"local"`,
  revisa la variable en Vercel y haz Redeploy: en producción ese modo no es
  válido.
- `version` → versión declarada en el proyecto (`0.1.0`), útil para confirmar
  que estás mirando el deploy correcto.

El endpoint es `force-dynamic`, así que no se sirve desde caché y funciona
aunque no haya base de datos ni credenciales de canales configuradas: es el
primer chequeo que conviene hacer tras cada deploy.

---

## 4. Dominios

1. En **Project Settings → Domains**, añade el dominio propio y apunta los
   registros DNS que indique Vercel (`A` / `CNAME`).
2. Actualiza `NEXT_PUBLIC_APP_URL` con la URL definitiva y haz Redeploy: los
   links generados y las URLs de los webhooks deben usar el dominio real.
3. Registra los webhooks de los canales apuntando a
   `https://<tu-dominio>/api/webhooks/{canal}`:
   - Meta (WhatsApp / Instagram / Messenger): usa el mismo Verify Token de la
     tarjeta de integración.
   - Telegram: configura `setWebhook` con la URL del bot.
   - Email: apunta el webhook entrante de tu proveedor.
4. Para el widget, obtén el snippet con
   `GET /api/widget/snippet?inboxId=inbox-widget` y pégalo antes de `</body>` en
   tu sitio. Las cabeceras de seguridad de `vercel.json` se han elegido para no
   bloquear el widget ni la recepción de webhooks.

Usa una base de datos y una clave de cifrado distintas en **Preview** que en
**Production** para no mezclar datos de pruebas con los reales.

---

## 5. Límites serverless: qué NO se puede hacer en Vercel

- **Sin listeners persistentes.** Cada Route Handler es una función que se
  ejecuta y se apaga. No hay proceso siempre vivo: imposible usar IMAP en bucle,
  sockets abiertos ni *polling* continuo. El correo y todos los canales entran
  por **webhooks HTTPS**; los envíos salen por la API de cada proveedor.
- **Sin estado en memoria.** Una invocación no comparte variables con la
  siguiente; dos webhooks concurrentes pueden caer en instancias distintas. La
  idempotencia se apoya en la restricción única `(channel, channelMessageId)` y
  en `ON CONFLICT DO NOTHING` en Postgres.
- **Sistema de archivos efímero y de solo lectura en producción.** `.data/` solo
  sirve para `npm run dev`. Nada de escribir archivos que deban sobrevivir al
  deploy; los adjuntos van a almacenamiento de objetos y solo se guarda su URL.
- **15 segundos por handler** (`maxDuration` en `vercel.json`). Verifica la
  firma, normaliza, persiste y responde antes de ese límite. La IA, la
  indexación y los envíos largos se diferirán a Cron/colas en fases posteriores.
- **Cold starts.** Minimiza dependencias en el arranque e inicializa el cliente
  `pg` de forma diferida.
- **Cuerpo de peticiones limitado** por `next.config.ts` (5 MB para Server
  Actions). Los archivos grandes suben directamente al almacenamiento de objetos.

---

## 6. Logs

- En el dashboard: **Project → Logs / Runtime Logs** y la pestaña de cada
  función para ver errores, códigos de estado y duración. CLI: `vercel logs`.
- Correlaciona eventos por `channelMessageId` o por ID de conversación: es la
  forma fiable de seguir un mensaje entre el webhook, la persistencia y la
  respuesta.
- **Nunca imprimas credenciales, tokens ni la clave de cifrado.** Si necesitas
  saber si una variable existe, usa `node scripts/vercel-env-check.mjs` (solo
  muestra `SI`/`NO`).
- Vigila las respuestas 401/403 de los webhooks (firma/token incorrectos) y los
  timeouts cerca de los 15 s.

---

## 7. Solución de problemas

| Síntoma | Causa probable | Acción |
| --- | --- | --- |
| `npm run build` falla en Vercel pero no en local | Versiones de Node o variables de build diferentes | Fija Node 20.x, reproduce con `npm run build` local y vuelve a desplegar |
| `/api/health` devuelve `storage: "local"` | Falta `DATABASE_URL` en Vercel | Configúrala con la cadena pooled y haz Redeploy |
| La app no guarda datos en producción | Se está usando el modo JSON local | Configura `DATABASE_URL`; `.data/` no es válido en Vercel |
| Demasiadas conexiones a Postgres | Cadena directa en lugar de pooler | Usa el host/puerto pooled de Neon/Supabase |
| Variables nuevas sin efecto | Build anterior en caché | Guarda las variables y ejecuta **Redeploy** |
| Webhook devuelve 404 | URL mal escrita o dominio cambiado | Comprueba `https://<dominio>/api/webhooks/{canal}` y `NEXT_PUBLIC_APP_URL` |
| Webhook devuelve 401/403 | Verify Token o secreto de firma distinto | Iguala el valor en el proveedor y en la integración / variable |
| Webhook expira | Trabajo largo dentro de la petición | Responde antes de 15 s y diferencia el trabajo pesado |
| Mensajes duplicados en la bandeja | Concurrencia sin idempotencia | Verifica la restricción `(channel, channelMessageId)` y `ON CONFLICT DO NOTHING` |
| Errores al descifrar credenciales | Clave rotada sin reprocesar credenciales guardadas | Usa una clave estable por entorno y reprocesa los registros cifrados |
| El widget no carga en el sitio | Dominio o snippet incorrectos | Regenera el snippet con `/api/widget/snippet?inboxId=…` y usa el dominio definitivo |

---

## 8. Checklist rápido

```text
[ ] npm run build pasa en local
[ ] node scripts/vercel-env-check.mjs revisado (sin secretos en pantalla)
[ ] Repo https://github.com/jrsantiagop/conversa-crm importado (Next.js, iad1)
[ ] DATABASE_URL (pooled) y CREDENTIALS_ENCRYPTION_KEY configuradas en Production
[ ] Esquema aplicado en Postgres
[ ] NEXT_PUBLIC_APP_URL apunta al dominio definitivo
[ ] curl /api/health devuelve status ok y storage postgres
[ ] Webhooks de los canales apuntando al dominio desplegado
[ ] Logs revisados tras el primer mensaje real
```
