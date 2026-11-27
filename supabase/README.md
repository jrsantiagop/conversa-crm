# Supabase

Esta carpeta contiene todo lo específico de Supabase para Conversa CRM.

| Archivo | Contenido |
| --- | --- |
| `migrations/0001_init.sql` | Esquema inicial: extensiones, 9 tablas, claves foráneas, índices y ejemplos comentados de RLS. Pegarlo en el SQL Editor de Supabase. |
| `README.md` | Este resumen. |

La guía completa está en [`docs/SUPABASE.md`](../docs/SUPABASE.md): creación del
proyecto, Connection String (pooler frente a directa), pgvector, migración,
verificación y diferencias con el modo local JSON.

Comprobación rápida tras aplicar la migración:

```bash
node --env-file=.env.local scripts/supabase-check.mjs
```

`src/lib/db/schema.sql` sigue siendo el esquema de referencia de la aplicación;
mantén ambos archivos sincronizados si añades tablas o columnas.
