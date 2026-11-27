# Conversa CRM

CRM conversacional propio, construido desde cero. **Un solo inbox** para web, email, WhatsApp, Telegram, Instagram, Messenger, SMS, voz y API, con un apartado específico para introducir los **IDs y tokens de cada canal**, motor conversacional opcional y preparado para desplegar en **Vercel**.

> Proyecto independiente. No reutiliza código, esquemas ni infraestructura de otros productos.

---

## Qué incluye

- **Bandeja única** con filtros, búsqueda, asignación, prioridad, etiquetas, estado (abierta/pendiente/resuelta) y panel de contacto.
- **Respuesta desde la bandeja** enviada por el canal correspondiente (si está configurado) o guardada localmente.
- **Sugerencias del motor conversacional** (reglas + RAG sobre la base de conocimiento + LLM opcional) con nivel de confianza y derivación a humano.
- **Integraciones** con tarjetas por canal: ID de widget, Phone Number ID de WhatsApp, Bot Token de Telegram, tokens de Meta, Resend, Twilio, etc. Las credenciales se cifran con AES-256-GCM antes de guardarse.
- **Webhooks universales** en `/api/webhooks/{canal}` con verificación de firma/token y normalización de mensajes.
- **Base de conocimiento** con artículos que alimentan las sugerencias.
- **CRM ligero**: negocios (deals) y tareas vinculadas a contactos.
- **Widget web** propio con snippet embebible.
- **Persistencia dual**: JSON local para desarrollo (` .data/ `) y PostgreSQL para producción/Vercel.
- **Exportación**: los datos son tuyos; en Postgres usa `pg_dump`, y todas las entidades son legibles vía la API `/api/state`.

---

## Puesta en marcha local

Requisitos: Node.js 20.9+ (probado con Node 24), npm 11+.

```bash
cd conversa-crm
npm install
cp .env.example .env.local
npm run dev
```

Abre http://localhost:3000. No necesitas configurar nada para empezar: se crea automáticamente un workspace `default`, un usuario propietario y 9 inboxes desactivados.

Genera la clave de cifrado de credenciales y ponla en `.env.local`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```env
CREDENTIALS_ENCRYPTION_KEY=<la clave hexadecimal de 64 caracteres>
```

Comandos útiles:

```bash
npm run typecheck   # comprobación estricta de TypeScript
npm run build       # build de producción
npm start           # servir el build
```

---

## Conectar un canal

1. Entra en **Integraciones** y elige la tarjeta del canal.
2. Rellena los campos (IDs y tokens) y pulsa **Activo** → **Guardar canal**.
3. Copia la URL del webhook (`https://tu-dominio/api/webhooks/{canal}`) y regístrala en el proveedor.
4. Para Meta (WhatsApp/Instagram/Messenger) usa el Verify Token que pusiste en la tarjeta. Para Telegram, configura el webhook con `setWebhook`. Para email, apunta el webhook entrante de Resend/Postmark.

Notas importantes:

- Los secretos **nunca se devuelven al navegador**: la UI solo recibe las claves que están configuradas, no los valores.
- Si el canal no está completo, los mensajes se guardan igualmente en la bandeja; el envío devuelve un error descriptivo.
- En Vercel no hay listeners persistentes: el correo entra por webhook, no por IMAP.

### Widget en tu web

Obtén el snippet desde:

```
GET /api/widget/snippet?inboxId=inbox-widget
```

Pégalo antes de `</body>`. El botón abre `/widget/inbox-widget` en una ventana de chat.

---

## Motor conversacional

Archivos en `src/engine/`:

1. **Reglas deterministas** (`rules.ts`): condiciones sobre texto, canal o idioma; acciones de respuesta, etiqueta, prioridad y derivación a humano.
2. **RAG** (`rag.ts`): similitud TF-IDF sobre los artículos publicados + prompt con citas.
3. **LLM opcional** (`llm.ts`): compatible con OpenAI y con cualquier API tipo OpenAI (Ollama, LM Studio, etc.) mediante `OPENAI_BASE_URL`.
4. **Decisión** (`handler.ts`): reglas → artículos → LLM → respuesta extractiva → fallback. Si la confianza es baja o el cliente pide humano, marca `shouldHandoff` y la conversación pasa a pendiente con etiqueta `handoff`.

Por defecto `BOT_AUTO_REPLY=false`: el bot **sugiere**, y una persona decide. Actívalo solo cuando confíes en las respuestas.

Variables:

```env
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
BOT_AUTO_REPLY=false
BOT_CONFIDENCE_THRESHOLD=0.75
```

---

## API principal

| Método | Ruta | Uso |
|---|---|---|
| GET | `/api/state` | Snapshot completo de la aplicación |
| GET/POST | `/api/conversations/{id}/messages` | Leer / enviar mensajes |
| POST | `/api/conversations/{id}/suggest` | Sugerencia del motor conversacional |
| PATCH | `/api/conversations/{id}` | Estado, prioridad, etiquetas, asignación |
| POST | `/api/integrations` | Guardar IDs/tokens de un canal |
| GET/POST | `/api/webhooks/{canal}` | Verificación y entrada de mensajes |
| POST/DELETE | `/api/articles` | Crear / ocultar artículos |
| POST | `/api/crm` | Crear negocio o tarea |
| GET | `/api/widget/snippet?inboxId=…` | Script embebible del widget |

---

## Despliegue en Vercel

1. Sube el repositorio a GitHub e importa el proyecto en Vercel (framework: Next.js).
2. Configura las variables de `.env.example` en **Project Settings → Environment Variables**.
3. Crea una base de datos PostgreSQL (Neon, Supabase o similar) y copia la cadena de conexión a `DATABASE_URL`. Usa el pooler para serverless.
4. Aplica `src/lib/db/schema.sql` en la base de datos (psql o el SQL editor del proveedor).
5. Define `CREDENTIALS_ENCRYPTION_KEY` con una clave estable de 32 bytes en hex. **Cámbiala respecto a desarrollo.**
6. Despliega. El modo JSON local (` .data/ `) no debe usarse en Vercel: el filesystem es efímero.

Detalles y checklist en `docs/DEPLOYMENT.md`.

Estructura y decisiones de diseño en `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/ROADMAP.md`, `docs/CHANNELS.md`, `docs/CONVERSATIONAL_ENGINE.md` y `docs/DATABASE.md`.

### Guías para la próxima clase

| Tema | Documento | Comando útil |
|---|---|---|
| Base de datos en Supabase | `docs/SUPABASE.md` | `npm run check:supabase` |
| Despliegue en Vercel y `/api/health` | `docs/VERCEL.md` | `npm run check:env` |
| Repositorio, CI y GitHub CLI | `docs/GITHUB.md` | — |
| Conexión segura de APIs | `docs/SECURITY.md` | `npm run test:security` |
| Prueba real con Telegram | `docs/TELEGRAM_TEST.md` | `npm run telegram:setup` |

La migración para Supabase está en `supabase/migrations/0001_init.sql` y el workflow de CI en `.github/workflows/ci.yml`.

---

## Estado del proyecto

Esta es una primera entrega funcional: bandeja, canales, integraciones, motor conversacional, conocimiento y CRM ya están cableados. Queda pendiente para fases posteriores (ver `docs/ROADMAP.md`): colaboración avanzada (equipos y presencia), campañas, CSAT, SLA con horarios de negocio, informes completos y apps nativas móviles.
