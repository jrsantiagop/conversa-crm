import { CHANNEL_DEFINITIONS } from "@/channels/definitions";
import { getStore } from "@/lib/db";
import { workspaceId } from "@/lib/utils";
import type { InboxView, DashboardSnapshot, ConversationView } from "./view-types";

/** Construye el estado que consumen las páginas. Solo se usa en servidor. */
export async function getSnapshot(): Promise<DashboardSnapshot> {
  const store = getStore();
  const wsId = workspaceId();
  const [workspaces, users, conversations, contacts, inboxes, articles, deals, tasks] =
    await Promise.all([
      store.listWorkspaces(),
      store.listUsers(),
      store.listConversations(wsId),
      store.listContacts(wsId),
      store.listInboxes(wsId),
      store.listArticles(wsId),
      store.listDeals(wsId),
      store.listTasks(wsId),
    ]);

  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  const views: ConversationView[] = await Promise.all(
    conversations
      .slice()
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
      .map(async (conversation) => {
        const messages = await store.listMessages(conversation.id);
        const last = messages[messages.length - 1];
        return {
          ...conversation,
          contact:
            contactById.get(conversation.contactId) ?? {
              id: conversation.contactId,
              workspaceId: wsId,
              name: "Contacto desconocido",
              externalIds: {},
              attributes: {},
              createdAt: conversation.createdAt,
              updatedAt: conversation.updatedAt,
            },
          lastMessage: last,
          messageCount: messages.length,
        };
      }),
  );

  const inboxViews: InboxView[] = inboxes.map((inbox) => ({
    id: inbox.id,
    workspaceId: inbox.workspaceId,
    name: inbox.name,
    channel: inbox.channel,
    enabled: inbox.enabled,
    credentialKeys: Object.entries(inbox.credentials ?? {})
      .filter(([, value]) => typeof value === "string" && value.length > 0)
      .map(([key]) => key),
    createdAt: inbox.createdAt,
    updatedAt: inbox.updatedAt,
  }));

  const workspace =
    workspaces.find((item) => item.id === wsId) ??
    workspaces[0] ?? {
      id: wsId,
      name: "Mi espacio",
      slug: wsId,
      createdAt: new Date().toISOString(),
    };

  const requiredByChannel = new Map(
    CHANNEL_DEFINITIONS.map((definition) => [
      definition.type,
      definition.fields.filter((field) => field.required).map((field) => field.key),
    ]),
  );

  return {
    workspace,
    users,
    conversations: views,
    contacts,
    inboxes: inboxViews,
    articles,
    deals,
    tasks,
    counts: {
      open: conversations.filter((c) => c.status === "open").length,
      pending: conversations.filter((c) => c.status === "pending").length,
      resolved: conversations.filter((c) => c.status === "resolved").length,
      unread: conversations.filter((c) => c.unread).length,
      contacts: contacts.length,
    },
  };
}

export function isInboxConfigured(view: InboxView): boolean {
  const required = CHANNEL_DEFINITIONS.find((d) => d.type === view.channel)?.fields.filter(
    (field) => field.required,
  );
  if (!required?.length) return true;
  return required.every((field) => view.credentialKeys.includes(field.key));
}
