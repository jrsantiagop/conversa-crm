# Base de datos y persistencia

Conversa CRM expone una única interfaz de persistencia (`Store`, en `src/lib/types.ts`) con dos implementaciones intercambiables. El punto de entrada es `src/lib/db/index.ts`:

```ts
import { getStore, isPostgres, seedIfEmpty } from "@/lib/db";

const store = getStore();          // Postgres si DATABASE_URL existe; JSON en caso contrario
const usingPg = isPostgres();      // útil para diagnósticos
await seedIfEmpty();               // siembra inicial idempotente (segura al repetirla)
```

La elección se calcula una sola vez por proceso. Todas las implementaciones son asíncronas y funcionan en server components y route handlers; ninguna usa APIs de navegador.

---

## Modo local (JSON)

**Activación:** dejar `DATABASE_URL` vacía (o no definirla).

- Los datos se guardan en `.data/store.json`, relativo al directorio de trabajo del proyecto.
- Escritura atómica: se escribe en un archivo temporal dentro de `.data/` y se hace `rename` sobre `store.json`. Nunca queda un archivo truncado.
- Mutex en memoria: todas las lecturas y escrituras se serializan mediante una cadena de promesas compartida en `globalThis`, de modo que las recargas en caliente de Next.js no crean dos escritores simultáneos.
- Si el archivo no existe o no se puede analizar, se crea con datos semilla:
  - workspace `default`;
  - usuario owner (`user-owner`, `owner@conversa.local`);
  - 9 inboxes desactivados: `widget`, `whatsapp`, `telegram`, `instagram`, `messenger`, `email`, `sms`, `voice`, `api`, con ids `inbox-<canal>`.
- Un archivo existente con colecciones vacías **no** se vuelve a sembrar.

Añade `.data/` a `.gitignore` (ya está preparado en el proyecto) para no versionar datos locales.

### Por qué NO usarlo en producción / serverless

El modo local no es una base de datos:

- Cada instancia de Vercel tiene un sistema de archivos efímero y aislado; cada función vería su propia copia y los cambios desaparecerían al terminar el invocation.
- No hay transacciones, bloqueos entre procesos ni índices: dos réplicas se sobrescribirían entre sí.
- No escala ni permite consultas concurrentes seguras.

Úsalo solo en `next dev` o scripts locales de un único proceso.

---

## Modo PostgreSQL

**Activación:** definir `DATABASE_URL`. El `Pool` de `pg` se crea de forma diferida; si la variable no existe, el módulo ni siquiera instancia el pool.

Características:

- Todas las consultas son parametrizadas (`$1`, `$2`, …). No se concatena texto del usuario en SQL.
- Columnas `snake_case` se mapean a las interfaces `camelCase` de `src/lib/types.ts`; los campos JSONB se serializan con `JSON.stringify` y se reconstruyen al leer.
- `messages.channel_message_id` tiene restricción `UNIQUE`: un webhook repetido devuelve el mensaje ya insertado (idempotencia).
- Índices incluidos: conversaciones por `(workspace_id, status, last_message_at DESC)`, mensajes por `(conversation_id, created_at)`, contactos por email e índices GIN en `attributes` / `external_ids`.
- SSL se habilita automáticamente para hosts remotos; se desactiva para `localhost`/`127.0.0.1` o con `PGSSLMODE=disable`.

### 1. Crear la base de datos en Vercel

1. En Vercel, abre la pestaña **Storage** → **Create Database** → **Neon (Postgres)** o tu proveedor Postgres (Supabase funciona igual).
2. Crea la base de datos y vincúlala al proyecto. Vercel inyecta `DATABASE_URL` automáticamente en el entorno de las funciones (Production/Preview/Development según el almacén vinculado).
3. Para desarrollo local, copia la cadena de conexión desde el panel del proveedor a `.env.local`:

```env
DATABASE_URL=postgresql://usuario:password@host/db?sslmode=require
```

Con Supabase, usa la cadena *Connection string* (pooler, p. ej. puerto 6543) para serverless. Con Neon, usa la cadena pooled que termina en `-pooler`. Si tu proveedor exige SSL y el certificado no se valida en el entorno, añade `PGSSLMODE=require` (la configuración del pool ya usa SSL para hosts remotos).

### 2. Aplicar el esquema

El DDL está en `src/lib/db/schema.sql` y es idempotente (`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`), así que puedes ejecutarlo cada vez que despliegues.

Desde tu máquina:

```bash
psql "$DATABASE_URL" -f src/lib/db/schema.sql
```

También puedes pegar el contenido en el editor SQL del dashboard de Neon/Supabase y ejecutarlo. No se necesita la extensión `pgcrypto`: los ids son `TEXT` y la aplicación los genera.

Tras aplicar el esquema, siembra los datos iniciales una vez:

```bash
# desde un script local con el entorno cargado
node -e "import('./src/lib/db/index.ts').then(m => m.seedIfEmpty())"
```

En Vercel, la forma recomendada es llamar a `seedIfEmpty()` desde el hook de instrumentación de Next.js (`src/instrumentation.ts`), con `process.env.NEXT_RUNTIME === "nodejs"`. Llamarlo en cada arranque es seguro: comprueba si ya existe un workspace y usa upserts con ids deterministas.

Si aparece el error `relation "workspaces" does not exist`, significa que aún no se aplicó `schema.sql`.

---

## Variables de entorno

| Variable | Obligatoria | Uso |
| --- | --- | --- |
| `DATABASE_URL` | Solo modo Postgres | Cadena de conexión. Si está vacía se usa `.data/store.json`. |
| `CREDENTIALS_ENCRYPTION_KEY` | Recomendada en producción | Hex de 32 bytes (64 caracteres hexadecimales) para AES-256-GCM. |
| `PGSSLMODE` | Opcional | `disable` para Postgres local sin SSL; en remoto se usa SSL por defecto. |
| `DEFAULT_WORKSPACE_ID` | Opcional | Valor de referencia para el workspace semilla (`default`). |

Generar la clave de cifrado:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Cifrado de credenciales

`src/lib/crypto.ts` cifra los valores de `Inbox.credentials` con **AES-256-GCM** (nonce aleatorio de 12 bytes y etiqueta de autenticación de 16 bytes). El formato guardado es:

```
v1:<iv en hex>:<authTag en hex>:<ciphertext en hex>
```

- La capa de persistencia cifra al escribir (`upsertInbox`) y descifra al leer (`getInbox`, `listInboxes`), tanto en JSON como en Postgres. Los valores ya cifrados no se cifran dos veces; los valores en texto plano heredados se devuelven tal cual al descifrar.
- Nunca envíes `inbox.credentials` sin descifrar al cliente; los helpers son **solo de servidor** (`node:crypto`).
- Si `CREDENTIALS_ENCRYPTION_KEY` falta o no es un hex válido de 32 bytes, se deriva una clave estable desde una constante de desarrollo y se emite **un único** aviso por consola: la aplicación arranca, pero las credenciales no son seguras. En producción la variable es obligatoria.
- Rotar la clave sin migrar los valores existentes hace que el descifrado falle: esos campos se devuelven vacíos y se registra un aviso. Para rotar, descifra con la clave antigua y vuelve a guardar con la nueva.

---

## Comprobación rápida

```bash
npm run typecheck
psql "$DATABASE_URL" -c '\dt'          # debe listar las 9 tablas
psql "$DATABASE_URL" -c 'SELECT count(*) FROM inboxes;'  # 9 tras sembrar
```

Tablas creadas: `workspaces`, `users`, `contacts`, `inboxes`, `conversations`, `messages`, `knowledge_articles`, `deals`, `tasks`.
