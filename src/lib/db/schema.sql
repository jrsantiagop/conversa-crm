-- Conversa CRM — PostgreSQL schema
-- Idempotent: safe to run more than once.
-- Apply with: psql "$DATABASE_URL" -f src/lib/db/schema.sql
-- Timestamps are stored as ISO strings by the application; TIMESTAMPTZ is used
-- so PostgreSQL can normalize and index them. IDs are TEXT (UUID strings or
-- the stable seed id "default").

-- ---------------------------------------------------------------------------
-- Workspaces and users
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Contacts
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Inboxes
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Knowledge base
-- ---------------------------------------------------------------------------

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

COMMENT ON COLUMN knowledge_articles.embedding IS 'Vector stored as JSON array; swap for pgvector vector type when available.';

CREATE INDEX IF NOT EXISTS knowledge_articles_workspace_published_idx
  ON knowledge_articles (workspace_id, published, locale);

-- ---------------------------------------------------------------------------
-- Deals and tasks
-- ---------------------------------------------------------------------------

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
