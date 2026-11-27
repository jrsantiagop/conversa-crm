/**
 * Local JSON persistence for development.
 *
 * All data lives in .data/store.json. Writes are serialized by an in-process
 * mutex and performed atomically (write to a temp file, then rename), so a
 * crashed process never leaves a half-written store behind.
 *
 * This backend is single-process only. Do NOT use it in production/serverless:
 * every instance would have its own private copy of the data.
 */

import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decryptInboxCredentials, encryptInboxCredentials } from "../crypto";
import type {
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

export interface StoreData {
  workspaces: Workspace[];
  users: User[];
  contacts: Contact[];
  inboxes: Inbox[];
  conversations: Conversation[];
  messages: Message[];
  articles: KnowledgeArticle[];
  deals: Deal[];
  tasks: Task[];
}

const DATA_DIR = join(process.cwd(), ".data");
const STORE_FILE = join(DATA_DIR, "store.json");

/**
 * Keeping the cache, the mutex and the instance on globalThis makes them
 * survive Next.js dev-module reloads, which otherwise re-read the file and
 * could interleave two writers.
 */
interface LocalStoreGlobals {
  __conversaCrmData?: StoreData;
  __conversaCrmQueue?: Promise<unknown>;
  __conversaCrmStore?: LocalStore;
}

const globals = globalThis as unknown as LocalStoreGlobals;

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Serializes every operation; the chain resolves even when a task rejects. */
async function withLock<T>(task: () => Promise<T>): Promise<T> {
  const previous = globals.__conversaCrmQueue ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  globals.__conversaCrmQueue = previous.then(() => next);

  await previous;
  try {
    return await task();
  } finally {
    release();
  }
}

function normalizeData(raw: Partial<StoreData> | null | undefined): StoreData {
  const seed = createSeedData();
  return {
    workspaces: Array.isArray(raw?.workspaces) ? raw.workspaces : seed.workspaces,
    users: Array.isArray(raw?.users) ? raw.users : seed.users,
    contacts: Array.isArray(raw?.contacts) ? raw.contacts : seed.contacts,
    inboxes: Array.isArray(raw?.inboxes) ? raw.inboxes : seed.inboxes,
    conversations: Array.isArray(raw?.conversations) ? raw.conversations : seed.conversations,
    messages: Array.isArray(raw?.messages) ? raw.messages : seed.messages,
    articles: Array.isArray(raw?.articles) ? raw.articles : seed.articles,
    deals: Array.isArray(raw?.deals) ? raw.deals : seed.deals,
    tasks: Array.isArray(raw?.tasks) ? raw.tasks : seed.tasks,
  };
}

async function writeAtomic(data: StoreData): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const tempFile = join(DATA_DIR, `.store-${process.pid}-${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(tempFile, JSON.stringify(data, null, 2), "utf8");
    await rename(tempFile, STORE_FILE);
  } catch (error) {
    await unlink(tempFile).catch(() => undefined);
    throw error;
  }
}

async function ensureData(): Promise<StoreData> {
  if (globals.__conversaCrmData) return globals.__conversaCrmData;

  let data: StoreData;
  try {
    const raw = await readFile(STORE_FILE, "utf8");
    data = normalizeData(JSON.parse(raw) as Partial<StoreData>);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.warn("[conversa-crm] Could not read .data/store.json; starting from seed data.", error);
    }
    data = createSeedData();
    await writeAtomic(data);
  }

  globals.__conversaCrmData = data;
  return data;
}

async function runRead<T>(fn: (data: StoreData) => T): Promise<T> {
  return withLock(async () => clone(fn(await ensureData())));
}

async function runWrite<T>(fn: (data: StoreData) => T | Promise<T>): Promise<T> {
  return withLock(async () => {
    const data = await ensureData();
    const result = await fn(data);
    await writeAtomic(data);
    return clone(result);
  });
}

function upsertById<T extends { id: string }>(items: T[], record: T): T {
  const index = items.findIndex((item) => item.id === record.id);
  if (index >= 0) items[index] = record;
  else items.push(record);
  return record;
}

export class LocalStore implements Store {
  /** Forces file/directory creation; normally called automatically on first access. */
  async seed(): Promise<void> {
    await withLock(async () => {
      await ensureData();
    });
  }

  async listWorkspaces(): Promise<Workspace[]> {
    return runRead((data) => data.workspaces);
  }

  async upsertWorkspace(workspace: Workspace): Promise<Workspace> {
    return runWrite((data) => upsertById(data.workspaces, clone(workspace)));
  }

  async listUsers(): Promise<User[]> {
    return runRead((data) => data.users);
  }

  async upsertUser(user: User): Promise<User> {
    return runWrite((data) => upsertById(data.users, clone(user)));
  }

  async listConversations(workspaceId: string): Promise<Conversation[]> {
    return runRead((data) =>
      data.conversations
        .filter((conversation) => conversation.workspaceId === workspaceId)
        .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)),
    );
  }

  async getConversation(id: string): Promise<Conversation | null> {
    return runRead((data) => data.conversations.find((conversation) => conversation.id === id) ?? null);
  }

  async upsertConversation(conversation: Conversation): Promise<Conversation> {
    return runWrite((data) => upsertById(data.conversations, clone(conversation)));
  }

  async listMessages(conversationId: string): Promise<Message[]> {
    return runRead((data) =>
      data.messages
        .filter((message) => message.conversationId === conversationId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    );
  }

  async getMessageByExternalId(channelMessageId: string): Promise<Message | null> {
    if (!channelMessageId) return null;
    return runRead(
      (data) => data.messages.find((message) => message.channelMessageId === channelMessageId) ?? null,
    );
  }

  async addMessage(message: Message): Promise<Message> {
    return runWrite((data) => {
      const record = clone(message);
      if (record.channelMessageId) {
        const existing = data.messages.find((item) => item.channelMessageId === record.channelMessageId);
        if (existing) return existing;
      }
      data.messages.push(record);
      return record;
    });
  }

  async listContacts(workspaceId: string): Promise<Contact[]> {
    return runRead((data) =>
      data.contacts
        .filter((contact) => contact.workspaceId === workspaceId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  async getContact(id: string): Promise<Contact | null> {
    return runRead((data) => data.contacts.find((contact) => contact.id === id) ?? null);
  }

  async upsertContact(contact: Contact): Promise<Contact> {
    return runWrite((data) => upsertById(data.contacts, clone(contact)));
  }

  async listInboxes(workspaceId: string): Promise<Inbox[]> {
    return runRead((data) =>
      data.inboxes
        .filter((inbox) => inbox.workspaceId === workspaceId)
        .map(decryptInboxCredentials)
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  async getInbox(id: string): Promise<Inbox | null> {
    return runRead((data) => {
      const inbox = data.inboxes.find((item) => item.id === id);
      return inbox ? decryptInboxCredentials(inbox) : null;
    });
  }

  async upsertInbox(inbox: Inbox): Promise<Inbox> {
    const encrypted = encryptInboxCredentials(clone(inbox));
    return runWrite((data) => {
      upsertById(data.inboxes, encrypted);
      return decryptInboxCredentials(clone(inbox));
    });
  }

  async deleteInbox(id: string): Promise<void> {
    await runWrite((data) => {
      data.inboxes = data.inboxes.filter((inbox) => inbox.id !== id);
    });
  }

  async listArticles(workspaceId: string): Promise<KnowledgeArticle[]> {
    return runRead((data) =>
      data.articles
        .filter((article) => article.workspaceId === workspaceId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    );
  }

  async upsertArticle(article: KnowledgeArticle): Promise<KnowledgeArticle> {
    return runWrite((data) => upsertById(data.articles, clone(article)));
  }

  async listDeals(workspaceId: string): Promise<Deal[]> {
    return runRead((data) =>
      data.deals
        .filter((deal) => deal.workspaceId === workspaceId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    );
  }

  async upsertDeal(deal: Deal): Promise<Deal> {
    return runWrite((data) => upsertById(data.deals, clone(deal)));
  }

  async listTasks(workspaceId: string): Promise<Task[]> {
    return runRead((data) =>
      data.tasks
        .filter((task) => task.workspaceId === workspaceId)
        .sort((a, b) => {
          if (!a.dueAt && !b.dueAt) return b.createdAt.localeCompare(a.createdAt);
          if (!a.dueAt) return 1;
          if (!b.dueAt) return -1;
          return a.dueAt.localeCompare(b.dueAt);
        }),
    );
  }

  async upsertTask(task: Task): Promise<Task> {
    return runWrite((data) => upsertById(data.tasks, clone(task)));
  }
}

export function getLocalStore(): LocalStore {
  if (!globals.__conversaCrmStore) globals.__conversaCrmStore = new LocalStore();
  return globals.__conversaCrmStore;
}
