-- =============================================================================
-- Conversa CRM — Supabase initial schema
-- =============================================================================
-- HOW TO APPLY
--   Supabase Dashboard -> SQL Editor -> New query -> paste this whole file -> Run.
--   Every object is idempotent, so running it again is safe.
--
-- This migration mirrors src/lib/db/schema.sql (the schema the application
-- actually uses). Keep both files in sync when adding tables or columns.
--
-- SECURITY MODEL (read the RLS section at the end before changing anything):
--   The Next.js server connects with a PostgreSQL connection string using the
--   service_role / postgres credentials. The browser never talks to Supabase
--   directly, so Row Level Security is intentionally left disabled here.
--
-- IDs are TEXT (UUID strings or the stable seed id "default"); the app creates
-- them. Timestamps are TIMESTAMPTZ; the app writes ISO strings and Postgres
-- normalizes them.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Extensions
-- -----------------------------------------------------------------------------

-- Each CREATE EXTENSION has its own exception handler. Supabase projects differ
-- by plan/region: pg_trgm is normally available, pgvector may not be. Wrapping
-- them keeps the migration runnable as-is in any Supabase SQL Editor.
DO $extensions$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    RAISE NOTICE 'pg_trgm enabled: trigram indexes are available.';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_trgm unavailable: trigram indexes will be skipped.';
  END;

  BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
    RAISE NOTICE 'pgvector enabled: the vector type is available for experiments.';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pgvector unavailable: JSONB embeddings keep working as before.';
  END;
END
$extensions$;

-- NOTE ON EMBEDDINGS
-- knowledge_articles.embedding stays JSONB on purpose: the app writes a JSON
-- array and computes cosine similarity in JavaScript (src/engine/rag.ts).
-- Changing it to vector(1536) would break those reads/writes. pgvector is
-- enabled only so you can experiment separately, e.g. with an extra column:
--   ALTER TABLE knowledge_articles ADD COLUMN embedding_v vector(1536);
--   CREATE INDEX ... ON knowledge_articles USING hnsw (embedding_v vector_cosine_ops);
-- Do that only in a scratch project or after updating the application code.

-- -----------------------------------------------------------------------------
-- 2. Workspaces and users
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS workspaces (
  id         TEXT PRIMARY KEY,
  name       TEXT        NOT NULL,
  slug       TEXT        NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE workspaces IS 'Tenant root. The local JSON mode seeds a workspace with id "default".';
COMMENT ON COLUMN workspaces.slug IS 'URL-safe unique workspace identifier.';

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE,
  role       TEXT NOT NULL DEFAULT 'agent'
             CHECK (role IN ('owner', 'admin', 'agent', 'viewer')),
  avatar_url TEXT
);

COMMENT ON TABLE users IS 'CRM users. Roles mirror src/lib/types.ts.';

-- -----------------------------------------------------------------------------
-- 3. Contacts
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS contacts (
  id           TEXT        PRIMARY KEY,
  workspace_id TEXT        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  email        TEXT,
  phone        TEXT,
  external_ids JSONB       NOT NULL DEFAULT '{}'::jsonb,
  attributes   JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN contacts.external_ids IS 'Per-channel external identifiers, e.g. {"telegram": "12345"}.';
COMMENT ON COLUMN contacts.attributes IS 'Custom CRM attributes; indexed with GIN for @> / ? lookups.';

CREATE INDEX IF NOT EXISTS contacts_workspace_email_idx
  ON contacts (workspace_id, lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS contacts_email_idx
  ON contacts (email);
CREATE INDEX IF NOT EXISTS contacts_workspace_created_idx
  ON contacts (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS contacts_external_ids_gin_idx
  ON contacts USING GIN (external_ids);
CREATE INDEX IF NOT EXISTS contacts_attributes_gin_idx
  ON contacts USING GIN (attributes);

-- -----------------------------------------------------------------------------
-- 4. Inboxes
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS inboxes (
  id           TEXT        PRIMARY KEY,
  workspace_id TEXT        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  channel      TEXT        NOT NULL
               CHECK (channel IN ('widget', 'whatsapp', 'telegram', 'instagram',
                                  'messenger', 'email', 'sms', 'voice', 'api')),
  enabled      BOOLEAN     NOT NULL DEFAULT false,
  credentials  JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN inboxes.credentials IS 'AES-256-GCM encrypted values; never send this column to the browser.';

CREATE INDEX IF NOT EXISTS inboxes_workspace_channel_idx
  ON inboxes (workspace_id, channel);

-- -----------------------------------------------------------------------------
-- 5. Conversations
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS conversations (
  id              TEXT        PRIMARY KEY,
  workspace_id    TEXT        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  inbox_id        TEXT        NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
  channel         TEXT        NOT NULL
                  CHECK (channel IN ('widget', 'whatsapp', 'telegram', 'instagram',
                                     'messenger', 'email', 'sms', 'voice', 'api')),
  contact_id      TEXT        NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  subject         TEXT,
  status          TEXT        NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'pending', 'resolved', 'snoozed')),
  priority        TEXT        NOT NULL DEFAULT 'normal'
                  CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  assignee_id     TEXT        REFERENCES users(id) ON DELETE SET NULL,
  labels          JSONB       NOT NULL DEFAULT '[]'::jsonb,
  unread          BOOLEAN     NOT NULL DEFAULT true,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata        JSONB
);

COMMENT ON TABLE conversations IS 'One thread per contact/channel; last_message_at drives inbox ordering.';
COMMENT ON COLUMN conversations.labels IS 'Array of label strings stored as JSONB.';

CREATE INDEX IF NOT EXISTS conversations_workspace_status_last_message_idx
  ON conversations (workspace_id, status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS conversations_workspace_inbox_idx
  ON conversations (workspace_id, inbox_id);
CREATE INDEX IF NOT EXISTS conversations_contact_idx
  ON conversations (contact_id);
CREATE INDEX IF NOT EXISTS conversations_assignee_idx
  ON conversations (assignee_id) WHERE assignee_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 6. Messages
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS messages (
  id                 TEXT        PRIMARY KEY,
  conversation_id    TEXT        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction          TEXT        NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  sender_type        TEXT        NOT NULL
                     CHECK (sender_type IN ('contact', 'agent', 'bot', 'system')),
  author_name        TEXT,
  body               TEXT        NOT NULL,
  attachments        JSONB,
  channel_message_id TEXT        UNIQUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata           JSONB
);

COMMENT ON COLUMN messages.channel_message_id IS 'Provider message id; UNIQUE gives webhook idempotency.';
COMMENT ON COLUMN messages.attachments IS 'Array of {name, url, mime?, size?}.';

CREATE INDEX IF NOT EXISTS messages_conversation_created_idx
  ON messages (conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS messages_created_idx
  ON messages (created_at DESC);

-- -----------------------------------------------------------------------------
-- 7. Knowledge base
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS knowledge_articles (
  id             TEXT        PRIMARY KEY,
  workspace_id   TEXT        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title          TEXT        NOT NULL,
  content        TEXT        NOT NULL,
  locale         TEXT        NOT NULL DEFAULT 'es',
  published      BOOLEAN     NOT NULL DEFAULT false,
  show_in_search BOOLEAN     NOT NULL DEFAULT true,
  embedding      JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN knowledge_articles.embedding IS 'Vector stored as a JSON array; pgvector is optional and kept separate.';

CREATE INDEX IF NOT EXISTS knowledge_articles_workspace_published_idx
  ON knowledge_articles (workspace_id, published, locale);

-- Trigram indexes speed up substring searches (LIKE '%text%') in the knowledge
-- base. They are created dynamically because Supabase can install pg_trgm in
-- either "public" or "extensions", and the operator class must be qualified
-- when that schema is not in the current search_path.
DO $trgm$
DECLARE
  trgm_schema text;
  column_name text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_trgm') THEN
    SELECT n.nspname INTO trgm_schema
    FROM pg_catalog.pg_extension e
    JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pg_trgm';

    FOREACH column_name IN ARRAY ARRAY['title', 'content'] LOOP
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS knowledge_articles_%s_trgm_idx
           ON knowledge_articles USING gin (%I %I.gin_trgm_ops)',
        column_name, column_name, trgm_schema
      );
    END LOOP;
    RAISE NOTICE 'Trigram indexes created for knowledge_articles.title and .content.';
  END IF;
END
$trgm$;

-- -----------------------------------------------------------------------------
-- 8. Deals and tasks
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS deals (
  id           TEXT        PRIMARY KEY,
  workspace_id TEXT        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id   TEXT        NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  title        TEXT        NOT NULL,
  value        NUMERIC(14, 2) NOT NULL DEFAULT 0,
  currency     TEXT        NOT NULL DEFAULT 'EUR',
  stage        TEXT        NOT NULL DEFAULT 'new',
  owner_id     TEXT        REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deals_workspace_stage_idx
  ON deals (workspace_id, stage);
CREATE INDEX IF NOT EXISTS deals_contact_idx
  ON deals (contact_id);

CREATE TABLE IF NOT EXISTS tasks (
  id              TEXT        PRIMARY KEY,
  workspace_id    TEXT        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title           TEXT        NOT NULL,
  done            BOOLEAN     NOT NULL DEFAULT false,
  due_at          TIMESTAMPTZ,
  assignee_id     TEXT        REFERENCES users(id) ON DELETE SET NULL,
  contact_id      TEXT        REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id         TEXT        REFERENCES deals(id) ON DELETE SET NULL,
  conversation_id TEXT        REFERENCES conversations(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_workspace_due_idx
  ON tasks (workspace_id, due_at ASC NULLS LAST, created_at DESC);
CREATE INDEX IF NOT EXISTS tasks_assignee_idx
  ON tasks (assignee_id) WHERE assignee_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 9. Row Level Security (RLS) — intentionally NOT enabled
-- -----------------------------------------------------------------------------
-- This application only reaches Postgres from server-side Next.js code using
-- the connection string (service_role / postgres credentials). There is no
-- supabase-js browser client and no anon key in this project.
--
-- Why RLS can stay disabled here:
--   * The service_role has the BYPASSRLS attribute: even if RLS were enabled,
--     it would bypass every policy. Enabling RLS would add no protection to the
--     only access path the app uses.
--   * Authorization is enforced in the app itself: every server-side query is
--     scoped to the workspace_id of the authenticated session.
--   * Leaving RLS off avoids surprising "permission denied" errors while
--     browsing data in the Supabase Table Editor with the SQL Editor role.
--
-- If you later add a browser client with the anon key, enable RLS on all nine
-- tables and define policies. Everything below is a COMMENTED example; do not
-- run it until you have a real tenant/JWT model:
--
-- ALTER TABLE workspaces        ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE users             ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE contacts          ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE inboxes           ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE conversations     ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE messages          ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE knowledge_articles ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE deals             ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE tasks             ENABLE ROW LEVEL SECURITY;
--
-- -- Full access for the server role (which would still bypass RLS anyway):
-- CREATE POLICY "service_role_all" ON contacts
--   FOR ALL TO service_role USING (true) WITH CHECK (true);
--
-- -- Example tenant policy for a future authenticated browser client:
-- CREATE POLICY "read_own_workspace" ON contacts
--   FOR SELECT TO authenticated
--   USING (workspace_id = current_setting('app.workspace_id', true));
--
-- Remember: with RLS enabled and no matching policy, a role sees zero rows
-- (fail closed). Never expose the service_role key or the connection string
-- to the browser.

-- -----------------------------------------------------------------------------
-- Done
-- -----------------------------------------------------------------------------
DO $done$
BEGIN
  RAISE NOTICE 'Conversa CRM schema ready: 9 tables expected (workspaces, users, contacts, inboxes, conversations, messages, knowledge_articles, deals, tasks).';
  RAISE NOTICE 'Next step: node --env-file=.env.local scripts/supabase-check.mjs';
END
$done$;
