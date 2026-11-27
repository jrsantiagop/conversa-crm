/**
 * Shared seed data for both persistence backends.
 * The identifiers are deterministic so seeding is idempotent.
 */

import type {
  ChannelType,
  Contact,
  Conversation,
  Deal,
  Inbox,
  KnowledgeArticle,
  Message,
  Task,
  User,
  Workspace,
} from "../types";

export interface SeedData {
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

export const DEFAULT_WORKSPACE_ID = "default";
export const DEFAULT_OWNER_ID = "user-owner";

const CHANNELS: Array<{ type: ChannelType; name: string }> = [
  { type: "widget", name: "Web Widget" },
  { type: "whatsapp", name: "WhatsApp" },
  { type: "telegram", name: "Telegram" },
  { type: "instagram", name: "Instagram" },
  { type: "messenger", name: "Messenger" },
  { type: "email", name: "Email" },
  { type: "sms", name: "SMS" },
  { type: "voice", name: "Voice" },
  { type: "api", name: "API" },
];

/** Builds the initial dataset: one workspace, one owner and 9 disabled inboxes. */
export function createSeedData(now: string = new Date().toISOString()): SeedData {
  const workspaces: Workspace[] = [
    { id: DEFAULT_WORKSPACE_ID, name: "Default Workspace", slug: "default", createdAt: now },
  ];

  const users: User[] = [
    {
      id: DEFAULT_OWNER_ID,
      name: "Owner",
      email: "owner@conversa.local",
      role: "owner",
    },
  ];

  const inboxes: Inbox[] = CHANNELS.map(({ type, name }) => ({
    id: `inbox-${type}`,
    workspaceId: DEFAULT_WORKSPACE_ID,
    name,
    channel: type,
    enabled: false,
    credentials: {},
    createdAt: now,
    updatedAt: now,
  }));

  return {
    workspaces,
    users,
    inboxes,
    contacts: [] as Contact[],
    conversations: [] as Conversation[],
    messages: [] as Message[],
    articles: [] as KnowledgeArticle[],
    deals: [] as Deal[],
    tasks: [] as Task[],
  };
}
