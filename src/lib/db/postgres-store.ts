/**
 * PostgreSQL implementation of the Store interface.
 *
 * A Pool is created lazily and only when DATABASE_URL is present, so importing
 * this module never opens a connection in local mode. Every statement is
 * parameterized; JSONB columns are serialized with JSON.stringify and mapped
 * back to the camelCase contracts from src/lib/types.ts.
 */

import { Pool } from "pg";
import { encryptInboxCredentials, decryptCredentials } from "../crypto";
import type {
  Attachment,
  Contact,
  Conversation,
  Deal,
  Inbox,
  KnowledgeArticle,
  Message,
  Store,
  Task,
  User,
  Workspace,
} from "../types";
import { createSeedData } from "./seed";

type Row = Record<string, unknown>;

function isConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function isPostgresConfigured(): boolean {
  return isConfigured();
}

function poolOptions(connectionString: string) {
  const isLocal = /(^|@)(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(connectionString);
  return {
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    ssl: isLocal || process.env.PGSSLMODE === "disable" ? undefined : { rejectUnauthorized: false },
  };
}

let pool: Pool | null = null;

function getPool(): Pool {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("[conversa-crm] DATABASE_URL is not configured; use the local store instead.");
  if (!pool) pool = new Pool(poolOptions(url));
  return pool;
}

async function rows(sql: string, params: unknown[] = []): Promise<Row[]> {
  const result = await getPool().query(sql, params);
  return result.rows as Row[];
}

async function one(sql: string, params: unknown[] = []): Promise<Row | null> {
  const list = await rows(sql, params);
  return list[0] ?? null;
}

function requireRow(row: Row | null): Row {
  if (!row) throw new Error("[conversa-crm] Database upsert returned no row.");
  return row;
}

// ---------------------------------------------------------------------------
// snake_case -> camelCase mapping helpers
// ---------------------------------------------------------------------------

function asString(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function asOptionalString(value: unknown): string | undefined {
  return value == null ? undefined : asString(value);
}

function asBool(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "t" || value === "true";
}

function asNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function json(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function nullable<T>(value: T | undefined): T | null {
  return value ?? null;
}

function mapWorkspace(row: Row): Workspace {
  return {
    id: asString(row.id),
    name: asString(row.name),
    slug: asString(row.slug),
    createdAt: asString(row.created_at),
  };
}

function mapUser(row: Row): User {
  return {
    id: asString(row.id),
    name: asString(row.name),
    email: asString(row.email),
    role: asString(row.role) as User["role"],
    avatarUrl: asOptionalString(row.avatar_url),
  };
}

function mapContact(row: Row): Contact {
  return {
    id: asString(row.id),
    workspaceId: asString(row.workspace_id),
    name: asString(row.name),
    email: asOptionalString(row.email),
    phone: asOptionalString(row.phone),
    externalIds: asJson<Record<string, string>>(row.external_ids, {}),
    attributes: asJson<Contact["attributes"]>(row.attributes, {}),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  };
}

function mapInbox(row: Row): Inbox {
  return {
    id: asString(row.id),
    workspaceId: asString(row.workspace_id),
    name: asString(row.name),
    channel: asString(row.channel) as Inbox["channel"],
    enabled: asBool(row.enabled),
    credentials: decryptCredentials(asJson<Record<string, string>>(row.credentials, {})),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  };
}

function mapConversation(row: Row): Conversation {
  return {
    id: asString(row.id),
    workspaceId: asString(row.workspace_id),
    inboxId: asString(row.inbox_id),
    channel: asString(row.channel) as Conversation["channel"],
    contactId: asString(row.contact_id),
    subject: asOptionalString(row.subject),
    status: asString(row.status) as Conversation["status"],
    priority: asString(row.priority) as Conversation["priority"],
    assigneeId: asOptionalString(row.assignee_id),
    labels: asJson<string[]>(row.labels, []),
    unread: asBool(row.unread),
    lastMessageAt: asString(row.last_message_at),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    metadata: row.metadata == null ? undefined : asJson<Record<string, unknown>>(row.metadata, {}),
  };
}

function mapMessage(row: Row): Message {
  return {
    id: asString(row.id),
    conversationId: asString(row.conversation_id),
    direction: asString(row.direction) as Message["direction"],
    senderType: asString(row.sender_type) as Message["senderType"],
    authorName: asOptionalString(row.author_name),
    body: asString(row.body),
    attachments: row.attachments == null ? undefined : asJson<Attachment[]>(row.attachments, []),
    channelMessageId: asOptionalString(row.channel_message_id),
    createdAt: asString(row.created_at),
    metadata: row.metadata == null ? undefined : asJson<Record<string, unknown>>(row.metadata, {}),
  };
}

function mapArticle(row: Row): KnowledgeArticle {
  return {
    id: asString(row.id),
    workspaceId: asString(row.workspace_id),
    title: asString(row.title),
    content: asString(row.content),
    locale: asString(row.locale),
    published: asBool(row.published),
    showInSearch: asBool(row.show_in_search),
    embedding: row.embedding == null ? undefined : asJson<number[]>(row.embedding, []),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  };
}

function mapDeal(row: Row): Deal {
  return {
    id: asString(row.id),
    workspaceId: asString(row.workspace_id),
    contactId: asString(row.contact_id),
    title: asString(row.title),
    value: asNumber(row.value),
    currency: asString(row.currency),
    stage: asString(row.stage),
    ownerId: asOptionalString(row.owner_id),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  };
}

function mapTask(row: Row): Task {
  return {
    id: asString(row.id),
    workspaceId: asString(row.workspace_id),
    title: asString(row.title),
    done: asBool(row.done),
    dueAt: asOptionalString(row.due_at),
    assigneeId: asOptionalString(row.assignee_id),
    contactId: asOptionalString(row.contact_id),
    dealId: asOptionalString(row.deal_id),
    conversationId: asOptionalString(row.conversation_id),
    createdAt: asString(row.created_at),
  };
}

export class PostgresStore implements Store {
  // -- Workspaces -----------------------------------------------------------

  async listWorkspaces(): Promise<Workspace[]> {
    const result = await rows("SELECT * FROM workspaces ORDER BY name ASC");
    return result.map(mapWorkspace);
  }

  async upsertWorkspace(workspace: Workspace): Promise<Workspace> {
    const row = await one(
      `INSERT INTO workspaces (id, name, slug, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         slug = EXCLUDED.slug,
         created_at = EXCLUDED.created_at
       RETURNING *`,
      [workspace.id, workspace.name, workspace.slug, workspace.createdAt],
    );
    return mapWorkspace(requireRow(row));
  }

  // -- Users ----------------------------------------------------------------

  async listUsers(): Promise<User[]> {
    const result = await rows("SELECT * FROM users ORDER BY name ASC");
    return result.map(mapUser);
  }

  async upsertUser(user: User): Promise<User> {
    const row = await one(
      `INSERT INTO users (id, name, email, role, avatar_url)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         email = EXCLUDED.email,
         role = EXCLUDED.role,
         avatar_url = EXCLUDED.avatar_url
       RETURNING *`,
      [user.id, user.name, user.email, user.role, nullable(user.avatarUrl)],
    );
    return mapUser(requireRow(row));
  }

  // -- Conversations --------------------------------------------------------

  async listConversations(workspaceId: string): Promise<Conversation[]> {
    const result = await rows(
      "SELECT * FROM conversations WHERE workspace_id = $1 ORDER BY last_message_at DESC",
      [workspaceId],
    );
    return result.map(mapConversation);
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const row = await one("SELECT * FROM conversations WHERE id = $1 LIMIT 1", [id]);
    return row ? mapConversation(row) : null;
  }

  async upsertConversation(conversation: Conversation): Promise<Conversation> {
    const row = await one(
      `INSERT INTO conversations (
         id, workspace_id, inbox_id, channel, contact_id, subject, status, priority,
         assignee_id, labels, unread, last_message_at, created_at, updated_at, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (id) DO UPDATE SET
         workspace_id = EXCLUDED.workspace_id,
         inbox_id = EXCLUDED.inbox_id,
         channel = EXCLUDED.channel,
         contact_id = EXCLUDED.contact_id,
         subject = EXCLUDED.subject,
         status = EXCLUDED.status,
         priority = EXCLUDED.priority,
         assignee_id = EXCLUDED.assignee_id,
         labels = EXCLUDED.labels,
         unread = EXCLUDED.unread,
         last_message_at = EXCLUDED.last_message_at,
         created_at = EXCLUDED.created_at,
         updated_at = EXCLUDED.updated_at,
         metadata = EXCLUDED.metadata
       RETURNING *`,
      [
        conversation.id,
        conversation.workspaceId,
        conversation.inboxId,
        conversation.channel,
        conversation.contactId,
        nullable(conversation.subject),
        conversation.status,
        conversation.priority,
        nullable(conversation.assigneeId),
        json(conversation.labels),
        conversation.unread,
        conversation.lastMessageAt,
        conversation.createdAt,
        conversation.updatedAt,
        conversation.metadata ? json(conversation.metadata) : null,
      ],
    );
    return mapConversation(requireRow(row));
  }

  // -- Messages -------------------------------------------------------------

  async listMessages(conversationId: string): Promise<Message[]> {
    const result = await rows(
      "SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC",
      [conversationId],
    );
    return result.map(mapMessage);
  }

  async getMessageByExternalId(channelMessageId: string): Promise<Message | null> {
    if (!channelMessageId) return null;
    const row = await one("SELECT * FROM messages WHERE channel_message_id = $1 LIMIT 1", [
      channelMessageId,
    ]);
    return row ? mapMessage(row) : null;
  }

  async addMessage(message: Message): Promise<Message> {
    const row = await one(
      `INSERT INTO messages (
         id, conversation_id, direction, sender_type, author_name, body,
         attachments, channel_message_id, created_at, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (channel_message_id) DO NOTHING
       RETURNING *`,
      [
        message.id,
        message.conversationId,
        message.direction,
        message.senderType,
        nullable(message.authorName),
        message.body,
        message.attachments ? json(message.attachments) : null,
        nullable(message.channelMessageId),
        message.createdAt,
        message.metadata ? json(message.metadata) : null,
      ],
    );

    if (row) return mapMessage(row);

    // Idempotency: a repeated webhook returns the row inserted by the first call.
    if (message.channelMessageId) {
      const existing = await this.getMessageByExternalId(message.channelMessageId);
      if (existing) return existing;
    }
    throw new Error("[conversa-crm] Message insert returned no row.");
  }

  // -- Contacts -------------------------------------------------------------

  async listContacts(workspaceId: string): Promise<Contact[]> {
    const result = await rows("SELECT * FROM contacts WHERE workspace_id = $1 ORDER BY name ASC", [
      workspaceId,
    ]);
    return result.map(mapContact);
  }

  async getContact(id: string): Promise<Contact | null> {
    const row = await one("SELECT * FROM contacts WHERE id = $1 LIMIT 1", [id]);
    return row ? mapContact(row) : null;
  }

  async upsertContact(contact: Contact): Promise<Contact> {
    const row = await one(
      `INSERT INTO contacts (
         id, workspace_id, name, email, phone, external_ids, attributes, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         workspace_id = EXCLUDED.workspace_id,
         name = EXCLUDED.name,
         email = EXCLUDED.email,
         phone = EXCLUDED.phone,
         external_ids = EXCLUDED.external_ids,
         attributes = EXCLUDED.attributes,
         created_at = EXCLUDED.created_at,
         updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [
        contact.id,
        contact.workspaceId,
        contact.name,
        nullable(contact.email),
        nullable(contact.phone),
        json(contact.externalIds ?? {}),
        json(contact.attributes ?? {}),
        contact.createdAt,
        contact.updatedAt,
      ],
    );
    return mapContact(requireRow(row));
  }

  // -- Inboxes --------------------------------------------------------------

  async listInboxes(workspaceId: string): Promise<Inbox[]> {
    const result = await rows("SELECT * FROM inboxes WHERE workspace_id = $1 ORDER BY name ASC", [
      workspaceId,
    ]);
    return result.map(mapInbox);
  }

  async getInbox(id: string): Promise<Inbox | null> {
    const row = await one("SELECT * FROM inboxes WHERE id = $1 LIMIT 1", [id]);
    return row ? mapInbox(row) : null;
  }

  async upsertInbox(inbox: Inbox): Promise<Inbox> {
    const stored = encryptInboxCredentials(inbox);
    const row = await one(
      `INSERT INTO inboxes (
         id, workspace_id, name, channel, enabled, credentials, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         workspace_id = EXCLUDED.workspace_id,
         name = EXCLUDED.name,
         channel = EXCLUDED.channel,
         enabled = EXCLUDED.enabled,
         credentials = EXCLUDED.credentials,
         created_at = EXCLUDED.created_at,
         updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [
        stored.id,
        stored.workspaceId,
        stored.name,
        stored.channel,
        stored.enabled,
        json(stored.credentials),
        stored.createdAt,
        stored.updatedAt,
      ],
    );
    return mapInbox(requireRow(row));
  }

  async deleteInbox(id: string): Promise<void> {
    await rows("DELETE FROM inboxes WHERE id = $1", [id]);
  }

  // -- Knowledge articles ---------------------------------------------------

  async listArticles(workspaceId: string): Promise<KnowledgeArticle[]> {
    const result = await rows(
      "SELECT * FROM knowledge_articles WHERE workspace_id = $1 ORDER BY updated_at DESC",
      [workspaceId],
    );
    return result.map(mapArticle);
  }

  async upsertArticle(article: KnowledgeArticle): Promise<KnowledgeArticle> {
    const row = await one(
      `INSERT INTO knowledge_articles (
         id, workspace_id, title, content, locale, published, show_in_search,
         embedding, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
         workspace_id = EXCLUDED.workspace_id,
         title = EXCLUDED.title,
         content = EXCLUDED.content,
         locale = EXCLUDED.locale,
         published = EXCLUDED.published,
         show_in_search = EXCLUDED.show_in_search,
         embedding = EXCLUDED.embedding,
         created_at = EXCLUDED.created_at,
         updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [
        article.id,
        article.workspaceId,
        article.title,
        article.content,
        article.locale,
        article.published,
        article.showInSearch,
        article.embedding ? json(article.embedding) : null,
        article.createdAt,
        article.updatedAt,
      ],
    );
    return mapArticle(requireRow(row));
  }

  // -- Deals ----------------------------------------------------------------

  async listDeals(workspaceId: string): Promise<Deal[]> {
    const result = await rows("SELECT * FROM deals WHERE workspace_id = $1 ORDER BY updated_at DESC", [
      workspaceId,
    ]);
    return result.map(mapDeal);
  }

  async upsertDeal(deal: Deal): Promise<Deal> {
    const row = await one(
      `INSERT INTO deals (
         id, workspace_id, contact_id, title, value, currency, stage,
         owner_id, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
         workspace_id = EXCLUDED.workspace_id,
         contact_id = EXCLUDED.contact_id,
         title = EXCLUDED.title,
         value = EXCLUDED.value,
         currency = EXCLUDED.currency,
         stage = EXCLUDED.stage,
         owner_id = EXCLUDED.owner_id,
         created_at = EXCLUDED.created_at,
         updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [
        deal.id,
        deal.workspaceId,
        deal.contactId,
        deal.title,
        deal.value,
        deal.currency,
        deal.stage,
        nullable(deal.ownerId),
        deal.createdAt,
        deal.updatedAt,
      ],
    );
    return mapDeal(requireRow(row));
  }

  // -- Tasks ----------------------------------------------------------------

  async listTasks(workspaceId: string): Promise<Task[]> {
    const result = await rows(
      `SELECT * FROM tasks WHERE workspace_id = $1
       ORDER BY due_at ASC NULLS LAST, created_at DESC`,
      [workspaceId],
    );
    return result.map(mapTask);
  }

  async upsertTask(task: Task): Promise<Task> {
    const row = await one(
      `INSERT INTO tasks (
         id, workspace_id, title, done, due_at, assignee_id,
         contact_id, deal_id, conversation_id, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
         workspace_id = EXCLUDED.workspace_id,
         title = EXCLUDED.title,
         done = EXCLUDED.done,
         due_at = EXCLUDED.due_at,
         assignee_id = EXCLUDED.assignee_id,
         contact_id = EXCLUDED.contact_id,
         deal_id = EXCLUDED.deal_id,
         conversation_id = EXCLUDED.conversation_id,
         created_at = EXCLUDED.created_at
       RETURNING *`,
      [
        task.id,
        task.workspaceId,
        task.title,
        task.done,
        nullable(task.dueAt),
        nullable(task.assigneeId),
        nullable(task.contactId),
        nullable(task.dealId),
        nullable(task.conversationId),
        task.createdAt,
      ],
    );
    return mapTask(requireRow(row));
  }
}

let cachedStore: PostgresStore | null = null;

/** Only call this after checking isPostgresConfigured(); no pool is created otherwise. */
export function getPostgresStore(): PostgresStore {
  if (!isConfigured()) throw new Error("[conversa-crm] DATABASE_URL is not configured.");
  if (!cachedStore) cachedStore = new PostgresStore();
  return cachedStore;
}

let seedPromise: Promise<void> | null = null;

/**
 * Seeds the default workspace, owner and 9 disabled inboxes when the database
 * is empty. Needs schema.sql to be applied first.
 */
export function seedPostgresIfEmpty(): Promise<void> {
  if (!isConfigured()) return Promise.resolve();
  if (!seedPromise) {
    seedPromise = runSeed().catch((error) => {
      seedPromise = null;
      throw error;
    });
  }
  return seedPromise;
}

async function runSeed(): Promise<void> {
  try {
    const result = await getPool().query("SELECT 1 FROM workspaces LIMIT 1");
    if ((result.rowCount ?? 0) > 0) return;
  } catch (error) {
    console.error(
      "[conversa-crm] Could not inspect the database. Apply src/lib/db/schema.sql before seeding.",
      error,
    );
    throw error;
  }

  const seed = createSeedData();
  const store = getPostgresStore();
  for (const workspace of seed.workspaces) await store.upsertWorkspace(workspace);
  for (const user of seed.users) await store.upsertUser(user);
  for (const inbox of seed.inboxes) await store.upsertInbox(inbox);
  console.info("[conversa-crm] Seeded default workspace, owner user and 9 disabled inboxes.");
}
