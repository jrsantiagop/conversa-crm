# Supabase en Conversa CRM (guía de clase)

Esta guía explica cómo pasar del modo local JSON a una base de datos PostgreSQL
administrada en Supabase. Es un recorrido práctico: crear el proyecto, obtener
la cadena de conexión correcta, aplicar la migración, comprobar el resultado y
explorar los datos desde el panel.

Supabase no sustituye a la lógica de la aplicación: `src/lib/db/index.ts` sigue
eligiendo el almacén según exista o no `DATABASE_URL`. Lo que cambia es **dónde**
se guardan los datos.

---

## 0. Requisitos

- Node.js >= 20.9 (necesario para `node --env-file`).
- Un proyecto de Conversa CRM con las dependencias ya instaladas (`pg` está en
  `package.json`).
- Una cuenta en [supabase.com](https://supabase.com).

> No escribas nunca la contraseña de la base de datos en un archivo versionado.
> `.env.local` es local y no debe subirse al repositorio.

---

## 1. Crear el proyecto

1. En el dashboard de Supabase pulsa **New project**.
2. Elige un nombre, una contraseña para la base de datos y una región cercana a
   donde desplegarás (en este proyecto, `iad1` en Vercel).
3. Espera a que el proyecto muestre el estado **Healthy**. La primera
   inicialización tarda un par de minutos.

La contraseña elegida aparece solo en ese momento; guárdala en tu gestor de
secretos. Más adelante la usarás para construir la cadena de conexión.

---

## 2. Obtener la Connection String correcta

En **Project Settings -> Database -> Connection strings** verás varias URLs.
No son intercambiables:

| Cadena | Puerto | Cuándo usarla |
| --- | --- | --- |
| **Direct connection** | 5432 | Migraciones, `psql`, DDL y sesiones largas. |
| **Pooler (Transaction mode)** | 6543 | La aplicación en serverless (Vercel): cada función dura poco y el pooler evita agotar conexiones. |
| **Pooler (Session mode)** | 5432 | Alternativa cuando necesitas sesión persistente y no puedes usar la directa. |

Regla para la clase:

- **Migrar** con la conexión directa.
- **Conectar la app** con la del pooler (transaction mode). El modo transaction
  no mantiene prepared statements ni estado de sesión, por eso no se usa para
  crear tablas.

Copia la URL del pooler y añádela a `.env.local`:

```env
DATABASE_URL=postgresql://postgres:TU_PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require
```

`TU_PASSWORD` es un marcador de posición: sustitúyelo por tu contraseña real
solo en tu archivo local. El parámetro `sslmode=require` ya viene en la cadena
que muestra Supabase y la librería `pg` lo respeta automáticamente.

---

## 3. Activar pgvector (opcional)

En **Database -> Extensions**, busca `vector` y pulsa **Enable**. También puedes
hacerlo desde el SQL Editor:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Dos precisiones importantes:

- La migración ya intenta activar `vector` y, si no está disponible en tu plan o
  región, lo omite con un aviso en lugar de fallar.
- `knowledge_articles.embedding` **sigue siendo `JSONB`**. La aplicación guarda
  un array JSON y calcula la similitud coseno en JavaScript (`src/engine/rag.ts`).
  Cambiar la columna a `vector(1536)` rompería esas lecturas y escrituras.
  pgvector queda disponible solo para experimentar en una columna nueva.

---

## 4. Ejecutar la migración

1. Abre **SQL Editor -> New query** en Supabase.
2. Pega el contenido completo de `supabase/migrations/0001_init.sql`.
3. Pulsa **Run**. Verás avisos (`NOTICE`) sobre las extensiones y las 9 tablas.

La migración es idempotente: usa `CREATE TABLE IF NOT EXISTS` y
`CREATE INDEX IF NOT EXISTS`, así que puedes volver a ejecutarla sin duplicar
nada. Crea extensiones, las 9 tablas con sus claves foráneas, los índices del
esquema de la aplicación y dos índices trigram adicionales para buscar texto en
la base de conocimientos.

Alternativa desde la terminal, usando la **conexión directa**:

```bash
psql 'postgresql://postgres:TU_PASSWORD@db.TU_PROYECTO.supabase.co:5432/postgres?sslmode=require' -f supabase/migrations/0001_init.sql
```

Tras aplicar el esquema, inicia la app con `npm run dev`: el arranque llama a
`seedIfEmpty()`, que siembra el workspace `default`, el usuario owner y los 9
inboxes desactivados. `docs/DATABASE.md` explica ese mecanismo con detalle.

---

## 5. Comprobar con el script de verificación

```bash
node --env-file=.env.local scripts/supabase-check.mjs
```

El script:

- lee `DATABASE_URL` de `process.env` y conecta con `pg`;
- comprueba que estén las 9 tablas esperadas;
- imprime el esquema, el número de tablas y las filas de cada una;
- nunca imprime la cadena de conexión ni secretos (los mensajes de error se
  redactan antes de mostrarse);
- termina con código de salida `1` si falta `DATABASE_URL`, hay un error de
  conexión/credenciales o alguna tabla no existe.

Salida esperada cuando todo está bien:

```text
Connected to PostgreSQL. Schema: public.
Tables found: 9 (9 expected).

Table                     Rows
------------------------- ----------
workspaces                         1
users                              1
contacts                           0
...
OK: all 9 expected tables are present.
```

Si faltan tablas, el mensaje indica cuáles y recuerda aplicar la migración.

---

## 6. Variables de entorno

| Variable | Obligatoria | Uso |
| --- | --- | --- |
| `DATABASE_URL` | Solo modo Postgres | Cadena del pooler para la app; si está vacía se usa `.data/store.json`. |
| `PGSSLMODE` | Opcional | `disable` solo para Postgres local; en Supabase se usa SSL por defecto. |
| `CREDENTIALS_ENCRYPTION_KEY` | Recomendada en producción | Hex de 32 bytes para cifrar credenciales de canales. |
| `DEFAULT_WORKSPACE_ID` | Opcional | Workspace semilla (`default`). |

En Vercel, añade `DATABASE_URL` en **Project Settings -> Environment
Variables** (Production, Preview y Development según necesites). Consulta
`.env.example` para el resto de variables.

---

## 7. Ver las tablas en el Table Editor

En el dashboard: **Table Editor**. Deberías ver las 9 tablas:

`workspaces`, `users`, `contacts`, `inboxes`, `conversations`, `messages`,
`knowledge_articles`, `deals`, `tasks`.

Actividades sugeridas para la clase:

1. Abre `inboxes`: los 9 canales con `enabled = false` y `credentials` cifrado
   (formato `v1:...`). Nunca pegues credenciales en texto plano en esa columna.
2. Abre `conversations` y observa las claves foráneas hacia `contacts`, `inboxes`
   y `users`, y el índice por `last_message_at`.
3. Prueba consultas desde el propio panel:

```sql
SELECT status, count(*) AS total FROM conversations GROUP BY status;
SELECT id, name, channel, enabled FROM inboxes ORDER BY channel;
SELECT workspace_id, title, published FROM knowledge_articles;
```

4. Fíjate en el estado **RLS disabled** de las tablas. Es deliberado: la app
   accede desde el servidor con service_role (o el rol `postgres` de la cadena
   de conexión), que **bypasea RLS**; la autorización por workspace se hace en
   el código servidor. Si algún día se añade un cliente de navegador con la clave
   anónima, habrá que activar RLS y crear políticas. La migración incluye
   ejemplos comentados al final.

---

## 8. Modo local JSON frente a Supabase

| | Modo local JSON | Supabase |
| --- | --- | --- |
| Activación | `DATABASE_URL` vacía | `DATABASE_URL` con la cadena del pooler |
| Datos | `.data/store.json`, relativo al proyecto | PostgreSQL remoto, compartido |
| Concurrencia | Un solo proceso, mutex en memoria | Consultas parametrizadas y transacciones reales |
| Serverless | No sirve: sistema de archivos efímero | Pensado para funciones cortas vía pooler |
| Índices y consultas | Ninguno; se recorre el archivo | Índices B-tree, GIN y trigram |
| Semilla | `seed()` al arrancar si no hay datos | `seedIfEmpty()` al arrancar, con upserts idempotentes |
| Copias y restauración | Copiar el archivo | Backups y Point-in-Time Recovery del panel |
| Cuándo usarlo | `next dev`, demos de un solo proceso | Producción, equipos y despliegues |

Cambiar de modo es tan simple como definir o vaciar `DATABASE_URL`, pero los
datos **no se migran automáticamente** entre los dos almacenes: son sistemas
independientes.

---

## 9. Solución de problemas rápida

| Síntoma | Causa probable | Acción |
| --- | --- | --- |
| `relation "workspaces" does not exist` | Falta aplicar la migración | Ejecuta `0001_init.sql` en el SQL Editor. |
| `password authentication failed` | Contraseña o usuario incorrectos | Copia de nuevo la Connection String desde Settings -> Database. |
| `too many clients already` | Se está usando la conexión directa desde serverless | Usa la URL del pooler (puerto 6543). |
| Error de SSL | Falta `sslmode=require` | Añade el parámetro a `DATABASE_URL`. |
| El script muestra 0 filas | La app todavía no ha sembrado | Arranca `npm run dev` con `DATABASE_URL` o ejecuta `seedIfEmpty()`. |

---

## 10. Checklist para la clase

- [ ] Proyecto Supabase creado y en estado Healthy.
- [ ] `pgvector` activado (o aviso de no disponibilidad aceptado).
- [ ] Migración `0001_init.sql` ejecutada sin errores.
- [ ] `DATABASE_URL` del pooler en `.env.local` y en Vercel.
- [ ] `node --env-file=.env.local scripts/supabase-check.mjs` muestra 9 tablas.
- [ ] Tablas y datos visibles en el Table Editor.
