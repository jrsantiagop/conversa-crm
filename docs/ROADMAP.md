# Hoja de ruta de Conversa CRM

> Plan por fases pensado para un desarrollador o equipo pequeño. Las estimaciones
> son **personas-semana** e incluyen diseño, implementación, pruebas básicas y
> documentación. La entrega actual es el **esqueleto (fase 0 parcial)**.

## 1. Leyenda de estado

| Símbolo | Significado |
| --- | --- |
| ✅ | Implementado en esta primera entrega |
| 🟡 | Parcialmente presente (configuración o contratos, sin implementación) |
| ⬜ | Previsto, no implementado |

## 2. Resumen ejecutivo

| Fase | Nombre | Estado | Estimación (p-s) |
| --- | --- | --- | --- |
| 0 | Fundación | 🟡 | 3 |
| 1 | Inbox web | ⬜ | 5 |
| 2 | Canales | ⬜ | 7 |
| 3 | Equipo y colaboración | ⬜ | 4 |
| 4 | Automatizaciones | ⬜ | 5 |
| 5 | IA y RAG | ⬜ | 6 |
| 6 | CRM: deals y tareas | ⬜ | 4 |
| 7 | Reportes | ⬜ | 3 |
| 8 | Endurecimiento | ⬜ | 4 |
| | **Total previsto** | | **≈ 41 p-s** |

Secuencia sugerida: 0 → 1 → 2 → 3 → (4 y 6 en paralelo) → 5 → 7 → 8.
La fase 5 depende de la 4 y de `pgvector`; la fase 7 depende de tener datos de las
fases 1-3.

## 3. Detalle por fases

### Fase 0 — Fundación (≈ 3 p-s, 🟡 parcial)

**Ya presente (✅ / 🟡):**

- ✅ `package.json`: Next.js 15.5, React 19, TypeScript 5.7, `pg`, `zod`, `clsx`,
  `lucide-react`, Node ≥ 20.9.
- ✅ `tsconfig.json` con `strict: true`, `moduleResolution: bundler` y alias `@/*`.
- ✅ `next.config.ts` con `reactStrictMode`, `poweredByHeader: false` y límite de
  Server Actions de 5 MB.
- ✅ `vercel.json`: framework `nextjs`, región `iad1`, `cleanUrls`, `maxDuration: 15`
  para `src/app/api/**/route.ts`.
- ✅ `.env.example` con base de datos, cifrado, LLM y credenciales de todos los
  canales previstos.
- ✅ `src/lib/types.ts`: 9 entidades, enumerados, eventos de canal, `Store`,
  `ChannelDefinition` y `CredentialField`.

**Pendiente (⬜):**

- Implementar `src/lib/db`: `Store` JSON local (`.data/`) y `Store` Postgres.
- Esquema SQL, migraciones y seed mínimo (`Workspace`, `User`, `Inbox` widget).
- Instalación de dependencias y verificación de `npm run typecheck` / `npm run build`.
- Estructura base de `src/app`: layout, fuentes, estilos y manejador de errores.
- Utilidades compartidas: IDs UUID, fechas, cifrado AES-256-GCM de credenciales.

**Entregable:** `npm run dev` levanta una app vacía; `npm run typecheck` y
`npm run build` pasan; `Store` funciona contra JSON local y contra Postgres.

### Fase 1 — Inbox web (≈ 5 p-s, ⬜)

- Página de bandeja única con lista de `Conversation` ordenada por `lastMessageAt`.
- Vista de conversación con historial de `Message` (burbujas inbound/outbound).
- Composer de respuesta (Server Action) y envío simulado vía `senderType = "agent"`.
- Filtros por `status`, `priority`, `labels`, `assigneeId`; búsqueda por texto.
- Acciones rápidas: resolver, reabrir, snooze, marcar no leído.
- Widget web de chat: `ChannelType = "widget"`, validación HMAC con
  `WIDGET_IDENTITY_SECRET`, evento `InboundMessage`.
- Diseño responsive y estados vacíos/carga/error.

**Entregable:** un agente puede atender una conversación completa desde cero
usando el widget, sin canal externo todavía.

### Fase 2 — Canales (≈ 7 p-s, ⬜)

- `src/channels`: registro de `ChannelDefinition` y adaptadores con
  `normalize(payload) → InboundMessage` y `send(message) → OutboundResult`.
- Webhooks entrantes en `src/app/api/**/route.ts` con verificación de firma y
  validación `zod`: WhatsApp Cloud API, Telegram, Instagram/Messenger, email
  (**webhook, nunca IMAP**), SMS y voz (Twilio), y canal `api` genérico.
- Resolución/creación de `Contact` por `externalIds` y de `Conversation` por
  `inboxId + contactId`.
- Idempotencia por `channelMessageId` (ver `DATA_MODEL.md`).
- Envío saliente con persistencia de `OutboundResult.externalMessageId`.
- UI de integraciones: formularios generados desde `CredentialField`, cifrado en
  reposo con `CREDENTIALS_ENCRYPTION_KEY`.
- Manejo de reintentos del proveedor y errores de entrega.

**Entregable:** mensajes de al menos widget + WhatsApp + Telegram + email llegan
a la misma bandeja y las respuestas salen por el mismo canal de origen.

### Fase 3 — Equipo y colaboración (≈ 4 p-s, ⬜)

- Autenticación y sesiones (previsto: proveedor de identidad o credenciales
  propias) con los roles `owner`, `admin`, `agent`, `viewer`.
- Tabla de pertenencia `workspace_users` (el tipo `User` no tiene `workspaceId`).
- Asignación de conversaciones (`assigneeId`), prioridad y etiquetas.
- Notas internas (`senderType = "system"` o metadata) y menciones (previsto).
- Registro de auditoría de cambios en conversaciones (previsto).
- Aislamiento estricto por `workspaceId` en todas las consultas.

**Entregable:** dos agentes pueden trabajar simultáneamente sin pisarse, con
permisos distintos.

### Fase 4 — Automatizaciones (≈ 5 p-s, ⬜)

- `src/engine`: pipeline de mensaje entrante (normalizar → enrutar → decidir).
- Reglas configurables: asignación por canal/palabra clave/horario,
  establecimiento de `priority` y `labels`, respuestas automáticas simples.
- Horario de atención y `status = "snoozed"` / `"pending"` automáticos.
- Macros/respuestas rápidas reutilizables en el composer.
- Ejecución diferida respetando `maxDuration: 15`: Vercel Cron o cola (previsto)
  para tareas largas; los webhooks solo persisten y responden.
- Panel mínimo para crear/editar reglas.

**Entregable:** reglas activas demostrables sin intervención del agente.

### Fase 5 — IA y RAG (≈ 6 p-s, ⬜)

- Carga y edición de `KnowledgeArticle` (`title`, `content`, `locale`,
  `published`, `showInSearch`).
- Generación de `embedding` y búsqueda vectorial con pgvector (índice HNSW).
- Respuesta sugerida con LLM compatible OpenAI usando `OPENAI_API_KEY`,
  `OPENAI_BASE_URL`, `OPENAI_MODEL`, `BOT_AUTO_REPLY` y
  `BOT_CONFIDENCE_THRESHOLD`.
- Modo **sugerencia** (por defecto) antes de modo **auto-respuesta**: el agente
  revisa y envía.
- Citas de las fuentes consultadas y registro de confianza en `metadata`.
- Evaluación qualitative con un conjunto pequeño de preguntas de prueba.
- Salvaguardas: no inventar datos, no responder si confianza < umbral, escalar a
  agente humano.

**Entregable:** el agente recibe una respuesta sugerida con fuentes en < 15 s o
se programa de forma asíncrona.

### Fase 6 — CRM: deals y tareas (≈ 4 p-s, ⬜)

- Listado y detalle de `Deal`: `title`, `value`, `currency`, `stage`, `ownerId`,
  vinculado a `Contact`.
- Embudo por `stage` con cambio de etapa por arrastrar o selector (previsto).
- `Task` con `dueAt`, `done`, `assigneeId` y enlaces opcionales a `Contact`,
  `Deal` y `Conversation`.
- Creación de tareas desde una conversación y viceversa (deep-link).
- Panel lateral del contacto con historial, atributos (`attributes`) y Negocios.

**Entregable:** trazabilidad conversación → contacto → deal → tarea.

### Fase 7 — Reportes (≈ 3 p-s, ⬜)

- Métricas de bandeja: tiempo de primera respuesta, tiempo de resolución,
  volumen por `ChannelType` y por `status`.
- Carga de `Conversation`/`Message` agregada con SQL (no en memoria) para no
  exceder límites serverless.
- Embudo de `Deal` por etapa y valor total por moneda.
- Exportación CSV de conversaciones y negocios (previsto).
- Gráficos ligeros (previsto: librería de charts a elegir; no incluida en
  `package.json` actual).

**Entregable:** panel con 4-6 métricas y rango de fechas.

### Fase 8 — Endurecimiento (≈ 4 p-s, ⬜)

- Pruebas unitarias de normalización de canales e idempotencia; pruebas de
  integración de webhooks y de `Store`.
- Seguridad: verificación de firmas, limitación de tasa, sanitización de HTML,
  validación de adjuntos y tamaño (5 MB de límite de Server Actions).
- Observabilidad: logs estructurados sin secretos, trazas de mensaje por
  `channelMessageId`, alertas de fallos de entrega.
- Rendimiento: paginación por cursor en `messages` y `conversations`, índices de
  `DATA_MODEL.md`, pools de conexiones `pg` adecuados a serverless.
- Backup/restore de Postgres y plan de rotación de `CREDENTIALS_ENCRYPTION_KEY`.
- Runbook de incidentes y comprobación de variables de entorno en Vercel.
- Accesibilidad y revisión de UI responsive.

**Entregable:** despliegue de producción estable con runbook y pruebas en verde

## 4. Qué NO está en esta entrega

Para evitar malentendidos: **no existen todavía** las páginas, los Route Handlers,
los adaptadores de canal, el motor, la capa `src/lib/db`, el esquema SQL, la
autenticación, los tests ni los reportes. Lo único que hay es la configuración
del proyecto, la plantilla de entorno y los contratos de `src/lib/types.ts`.
Todo lo demás de este documento es planificación.

## 5. Supuestos y riesgos

- Un único desarrollador con experiencia en Next.js/TypeScript; las estimaciones
  bajan ~30 % con dos personas dedicadas y suben si se requiere diseño visual
  propio.
- No se cuenta con infraestructura de colas: las tareas largas se modelan con
  Vercel Cron y almacenamiento en base de datos (previsto) para respetar los
  15 s por función.
- El proveedor de Postgres debe soportar `pgvector` para la fase 5; si no, se
  sustituye por búsqueda de texto completo (previsto, con menor calidad).
- La fase 2 crece si un proveedor cambia su API o exige verificaciones de
  webhook adicionales; conviene empezar por widget + Telegram + email.
- La fase 3 puede retrasarse si se integra un proveedor de identidad externo.
