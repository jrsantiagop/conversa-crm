import type {
  Contact,
  Conversation,
  Deal,
  KnowledgeArticle,
  Message,
  Task,
  User,
  Workspace,
} from "./types";

export interface ConversationView extends Conversation {
  contact: Contact;
  lastMessage?: Message;
  messageCount: number;
}

/** Nunca contiene secretos: solo las claves que tienen valor configurado. */
export interface InboxView {
  id: string;
  workspaceId: string;
  name: string;
  channel: Conversation["channel"];
  enabled: boolean;
  credentialKeys: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DashboardSnapshot {
  workspace: Workspace;
  users: User[];
  conversations: ConversationView[];
  contacts: Contact[];
  inboxes: InboxView[];
  articles: KnowledgeArticle[];
  deals: Deal[];
  tasks: Task[];
  counts: {
    open: number;
    pending: number;
    resolved: number;
    unread: number;
    contacts: number;
  };
}
