/**
 * Contratos compartidos de Conversa CRM.
 * Todos los módulos (API, canales, motor, UI) importan desde aquí.
 */

export type ChannelType =
  | "widget"
  | "whatsapp"
  | "telegram"
  | "instagram"
  | "messenger"
  | "email"
  | "sms"
  | "voice"
  | "api";

export type ConversationStatus = "open" | "pending" | "resolved" | "snoozed";
export type Priority = "low" | "normal" | "high" | "urgent";
export type Role = "owner" | "admin" | "agent" | "viewer";

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatarUrl?: string;
}

export interface Contact {
  id: string;
  workspaceId: string;
  name: string;
  email?: string;
  phone?: string;
  /** Identificadores externos por canal, p. ej. { telegram: "12345" } */
  externalIds: Record<string, string>;
  /** Atributos personalizados del CRM */
  attributes: Record<string, string | number | boolean | null>;
  createdAt: string;
  updatedAt: string;
}

export interface Attachment {
  name: string;
  url: string;
  mime?: string;
  size?: number;
}

export interface Message {
  id: string;
  conversationId: string;
  direction: "inbound" | "outbound";
  senderType: "contact" | "agent" | "bot" | "system";
  authorName?: string;
  body: string;
  attachments?: Attachment[];
  /** ID del proveedor para idempotencia */
  channelMessageId?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface Conversation {
  id: string;
  workspaceId: string;
  inboxId: string;
  channel: ChannelType;
  contactId: string;
  subject?: string;
  status: ConversationStatus;
  priority: Priority;
  assigneeId?: string;
  labels: string[];
  unread: boolean;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface Inbox {
  id: string;
  workspaceId: string;
  name: string;
  channel: ChannelType;
  enabled: boolean;
  /** Valores cifrados en reposo; nunca se envían al cliente sin desencriptar en servidor */
  credentials: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeArticle {
  id: string;
  workspaceId: string;
  title: string;
  content: string;
  locale: string;
  published: boolean;
  showInSearch: boolean;
  embedding?: number[];
  createdAt: string;
  updatedAt: string;
}

export interface Deal {
  id: string;
  workspaceId: string;
  contactId: string;
  title: string;
  value: number;
  currency: string;
  stage: string;
  ownerId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  workspaceId: string;
  title: string;
  done: boolean;
  dueAt?: string;
  assigneeId?: string;
  contactId?: string;
  dealId?: string;
  conversationId?: string;
  createdAt: string;
}

export interface CredentialField {
  key: string;
  label: string;
  type: "text" | "password" | "url" | "select" | "textarea";
  placeholder?: string;
  help?: string;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
}

export interface ChannelDefinition {
  type: ChannelType;
  name: string;
  description: string;
  docsUrl?: string;
  fields: CredentialField[];
  /** Indica si el canal puede recibir mensajes mediante webhook */
  inbound: boolean;
  /** Indica si el canal puede enviar mensajes mediante API */
  outbound: boolean;
}

/** Evento normalizado que todos los canales producen */
export interface InboundMessage {
  channel: ChannelType;
  inboxId?: string;
  externalMessageId: string;
  externalContactId: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  body: string;
  attachments?: Attachment[];
  timestamp?: string;
  subject?: string;
  raw?: unknown;
}

export interface OutboundResult {
  externalMessageId?: string;
  delivered: boolean;
  error?: string;
}

/** Interfaz de persistencia. Implementaciones: local JSON y Postgres. */
export interface Store {
  listWorkspaces(): Promise<Workspace[]>;
  upsertWorkspace(workspace: Workspace): Promise<Workspace>;
  listUsers(): Promise<User[]>;
  upsertUser(user: User): Promise<User>;

  listConversations(workspaceId: string): Promise<Conversation[]>;
  getConversation(id: string): Promise<Conversation | null>;
  upsertConversation(conversation: Conversation): Promise<Conversation>;

  listMessages(conversationId: string): Promise<Message[]>;
  getMessageByExternalId(channelMessageId: string): Promise<Message | null>;
  addMessage(message: Message): Promise<Message>;

  listContacts(workspaceId: string): Promise<Contact[]>;
  getContact(id: string): Promise<Contact | null>;
  upsertContact(contact: Contact): Promise<Contact>;

  listInboxes(workspaceId: string): Promise<Inbox[]>;
  getInbox(id: string): Promise<Inbox | null>;
  upsertInbox(inbox: Inbox): Promise<Inbox>;
  deleteInbox(id: string): Promise<void>;

  listArticles(workspaceId: string): Promise<KnowledgeArticle[]>;
  upsertArticle(article: KnowledgeArticle): Promise<KnowledgeArticle>;

  listDeals(workspaceId: string): Promise<Deal[]>;
  upsertDeal(deal: Deal): Promise<Deal>;
  listTasks(workspaceId: string): Promise<Task[]>;
  upsertTask(task: Task): Promise<Task>;
}
