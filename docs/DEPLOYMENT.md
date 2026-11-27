# Despliegue de Conversa CRM

> Guía concreta para desarrollo local y despliegue en Vercel. Refleja la
> configuración **real** de `package.json`, `next.config.ts`, `vercel.json` y
> `.env.example`. Las implementaciones de persistencia y de canales están
> **previstas**, no presentes aún en esta entrega.

## 1. Requisitos previos

- **Node.js ≥ 20.9.0** (declarado en `engines` de `package.json`).
- **npm** incluido con Node.
- Git y acceso al repositorio.
- Opcional, para producción: una base de datos Postgres (Neon o Supabase) y una
  cuenta de Vercel.
- Opcional, para probar webhooks en local: un túnel HTTPS que exponga
  `localhost:3000` (por ejemplo ngrok o Cloudflare Tunnel).

Comprueba la versión:

```bash
node --version
npm --version
```

## 2. Desarrollo local

### 2.1 Instalar dependencias

```bash
cd conversa-crm
npm install
```

> No es necesario ejecutar nada más para la entrega actual: todavía no hay
> scripts de migración ni de seed.

### 2.2 Crear `.env.local`

Desde PowerShell (entorno Windows):

```powershell
Copy-Item .env.example .env.local
```

Desde bash:

```bash
cp .env.example .env.local
```

Valores mínimos recomendados para empezar:

```dotenv
NEXT_PUBLIC_APP_URL=http://localhost:3000
APP_NAME=Conversa CRM
DEFAULT_WORKSPACE_ID=default
DATABASE_URL=
CREDENTIALS_ENCRYPTION_KEY=
```

- `DATABASE_URL` **vacía**: se usará almacenamiento JSON local en `.data/`
  (comportamiento documentado en `.env.example`; implementación prevista).
- `CREDENTIALS_ENCRYPTION_KEY`: generar una clave de 32 bytes en hexadecimal:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Pega el resultado en `.env.local`. En desarrollo puede ser una clave propia; en
producción debe ser distinta y gestionarse como secreto.

**Precaución:** comprueba que `.env.local` y `.data/` estén ignorados por Git
antes de commitear. Nunca subas claves ni tokens.

### 2.3 Arrancar la aplicación

```bash
npm run dev
```

Abrir <http://localhost:3000>. El servidor recarga al editar archivos.

### 2.4 Comprobaciones

```bash
npm run typecheck   # tsc --noEmit, configuración strict
npm run build       # compilación de producción con Next.js 15
npm run start       # sirve el build local (tras npm run build)
```

Ejecuta `npm run typecheck` después de cualquier cambio en `src/lib/types.ts`,
porque todos los módulos importan de ahí.

### 2.5 Variables opcionales por funcionalidad

| Grupo | Variables (de `.env.example`) | Cuándo rellenarlas |
| --- | --- | --- |
| Motor / IA | `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `BOT_AUTO_REPLY`, `BOT_CONFIDENCE_THRESHOLD` | Fases 4-5 (previstas). `BOT_AUTO_REPLY=false` deja el bot en modo sugerencia. |
| WhatsApp | `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_VERIFY_TOKEN` | Fase 2 (prevista) |
| Telegram | `TELEGRAM_BOT_TOKEN` | Fase 2 (prevista) |
| Meta (Instagram/Messenger) | `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_APP_SECRET`, `FACEBOOK_PAGE_ACCESS_TOKEN` | Fase 2 (prevista) |
| Email entrante | `EMAIL_INBOUND_WEBHOOK_SECRET`, `EMAIL_FROM_ADDRESS` | Fase 2 (prevista). El correo entra por **webhook**, no por IMAP. |
| SMS / Voz | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | Fase 2 (prevista) |
| Widget | `WIDGET_IDENTITY_SECRET` | Fase 1 (prevista), validación HMAC de identidad |

Alternativamente, las credenciales se introducen desde la UI de integraciones
(prevista) y se guardan cifradas en `Inbox.credentials`.

### 2.6 Probar webhooks en local

1. Exponer `localhost:3000` con un túnel HTTPS.
2. Configurar la URL pública del proveedor apuntando a la ruta prevista
   `https://<tunel>/api/...` (las rutas concretas se definen en la fase 2).
3. Usar el mismo `*_VERIFY_TOKEN` / `*_WEBHOOK_SECRET` en el proveedor y en
   `.env.local`.
4. Verificar en los logs que la firma es válida y que un mensaje duplicado no
   crea dos filas (idempotencia por `channelMessageId`).

## 3. Despliegue en Vercel

### 3.1 Importar el repositorio

1. En Vercel: **Add New → Project** e importar el repositorio.
2. Framework: **Next.js** (detectado automáticamente por `vercel.json`).
3. Build command: `npm run build`. Output directory: `.next`.
4. Región: `iad1` (según `vercel.json`). `cleanUrls` está activado.
5. No hace falta cambiar el directorio raíz: el proyecto está en la raíz del
   repositorio.
6. **Deploy**. La primera compilación puede fallar si faltan variables de entorno;
   añádelas (sección 3.2) y vuelve a desplegar.

> `vercel.json` aplica `"maxDuration": 15` a `src/app/api/**/route.ts`. Tenlo
> presente al diseñar webhooks: responder en menos de 15 segundos.

### 3.2 Variables de entorno en Vercel

Project → **Settings → Environment Variables**. Añadir para **Production** (y, si
se desea, Preview/Development):

| Variable | Valor en producción | Notas |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | `https://<dominio>.vercel.app` o dominio propio | Se expone al navegador; sin barra final |
| `APP_NAME` | `Conversa CRM` | — |
| `DEFAULT_WORKSPACE_ID` | `default` o el ID real | — |
| `CREDENTIALS_ENCRYPTION_KEY` | clave hex de 32 bytes distinta en cada entorno | Secreto; no prefijo `NEXT_PUBLIC_` |
| `DATABASE_URL` | cadena de conexión **pooled** de Neon/Supabase | Obligatoria en producción |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` | según proveedor | Opcional |
| `BOT_AUTO_REPLY`, `BOT_CONFIDENCE_THRESHOLD` | `false` / `0.75` | Recomendado empezar en modo sugerencia |
| `WHATSAPP_*`, `TELEGRAM_BOT_TOKEN`, `INSTAGRAM_*`, `FACEBOOK_PAGE_ACCESS_TOKEN`, `EMAIL_*`, `TWILIO_*`, `WIDGET_IDENTITY_SECRET` | según canales activos | Marcar como secretos |

Tras cambiar variables, **Redeploy** (las variables no se aplican a builds
anteriores).

### 3.3 Base de datos

1. Crear un proyecto Postgres en Neon o Supabase.
2. Obtener la cadena de conexión **con pooling** (en Supabase, el puerto de
   *transaction pooler*; en Neon, el host *pooled*). Las funciones serverless
   abren y cierran conexiones constantemente; una cadena directa agota el pool.
3. Configurar `DATABASE_URL` con esa cadena.
4. Habilitar la extensión `pgvector` si se va a usar la fase de RAG:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

5. Aplicar el esquema y las migraciones cuando estén implementadas (previsto;
   hoy no hay archivos de migración en el repositorio).
6. Con `pg`, evitar sentencias preparadas persistentes si el pooler está en modo
   transacción; configurar el cliente en consecuencia en la capa `src/lib/db`
   (previsto).

### 3.4 Por qué el almacenamiento JSON local es solo para desarrollo

`.env.example` indica que, si `DATABASE_URL` está vacía, se usa `.data/` (JSON
local; implementación prevista). En Vercel ese enfoque **no es válido**:

- El sistema de archivos de las funciones es efímero y, en producción, de solo
  lectura: los cambios se pierden en cada despliegue y no se comparten entre
  invocaciones.
- Cada invocación puede ejecutarse en una instancia distinta: dos webhooks
  concurrentes podrían sobrescribirse.
- No hay transacciones ni bloqueos fiables, necesarios para la idempotencia por
  `channelMessageId`.
- No escala a volumen de bandeja, búsqueda ni agregados de reportes.

**Regla:** en Vercel, `DATABASE_URL` siempre debe estar configurada. El modo JSON
sirve únicamente para `npm run dev` y pruebas locales sin servicios externos.

### 3.5 Límites y precauciones de serverless

- **15 s por Route Handler** (`vercel.json`). Verificar firma, normalizar,
  persistir y responder; mover IA, indexación y envíos a Vercel Cron o a una cola
  (previsto) para no exceder el tiempo.
- **Cuerpo de petición**: `next.config.ts` limita Server Actions a 5 MB. Los
  adjuntos grandes deben subirse a almacenamiento de objetos (previsto) y
  guardar solo la URL en `Message.attachments`.
- **Concurrencia**: varias invocaciones pueden procesar el mismo webhook. La
  restricción única `(channel, channelMessageId)` y `ON CONFLICT DO NOTHING` son
  obligatorias (ver `DATA_MODEL.md`).
- **Sin estado en memoria ni listeners persistentes**: nada de IMAP, sockets
  abiertos ni *polling* continuo. Email, WhatsApp, Telegram, Meta y Twilio entra
  por webhook HTTPS.
- **Cold starts**: minimizar dependencias en el arranque; inicializar el cliente
  `pg` de forma diferida (previsto).
- **Logs**: usar los logs de Vercel, pero nunca imprimir credenciales ni tokens;
  correlacionar eventos por `channelMessageId`.
- **Dominios**: configurar el dominio real en `NEXT_PUBLIC_APP_URL` para que los
  links y los webhooks generen las URLs correctas.
- **Preview deployments**: usar una base de datos y una clave de cifrado
  separadas de producción para no mezclar datos.

## 4. Checklist de despliegue

```text
[ ] node --version >= 20.9.0
[ ] npm install completado sin errores
[ ] npm run typecheck y npm run build pasan en local
[ ] Repo importado en Vercel con framework Next.js y región iad1
[ ] Variables de entorno configuradas para Production (y Preview)
[ ] DATABASE_URL apunta a un pooler de Neon/Supabase
[ ] CREDENTIALS_ENCRYPTION_KEY generada y distinta por entorno
[ ] pgvector habilitado si se activa RAG (fase 5, prevista)
[ ] Webhooks de los canales apuntando a las rutas desplegadas (fase 2, prevista)
[ ] Verificación de firma activada en cada proveedor
[ ] Prueba: mensaje duplicado no genera dos mensajes en la bandeja
[ ] Monitorización de logs y de errores de entrega activada
```

## 5. Solución de problemas

| Síntoma | Causa probable | Acción |
| --- | --- | --- |
| `npm run build` falla por tipos | Cambios en `src/lib/types.ts` sin actualizar usos | `npm run typecheck` y corregir |
| La app local no guarda datos | `DATABASE_URL` vacía y `Store` JSON aún no implementado | Implementación prevista; revisar `.data/` y permisos |
| Vercel no aplica variables nuevas | Build anterior en caché | Redeploy tras guardar las variables |
| Webhook devuelve 404 | Rutas `src/app/api/**/route.ts` aún no creadas | Fase 2 (prevista) |
| Webhook expira | Trabajo largo dentro de la petición | Diferir a Cron/cola; responde antes de 15 s |
| Demasiadas conexiones a Postgres | Cadena directa en lugar de pooler | Usar el host/puerto pooled |
| Errores de descifrado de credenciales | Clave rotada sin reprocesar `Inbox.credentials` | Ver plan de rotación en `DATA_MODEL.md` |
| Archivos escritos en producción desaparecen | Sistema de archivos efímero | Usar `DATABASE_URL` y almacenamiento de objetos (previsto) |

## 6. Referencias

- `ARCHITECTURE.md`: componentes, flujo de mensaje y compatibilidad con Vercel.
- `DATA_MODEL.md`: entidades, índices, idempotencia y cifrado de credenciales.
- `ROADMAP.md`: fases, entregables y estimaciones.
