"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Mail,
  MessageCircle,
  Phone,
  Search,
  Send,
  Sparkles,
  Tag,
  UserRound,
  Webhook,
} from "lucide-react";
import type { ConversationView, DashboardSnapshot } from "@/lib/view-types";
import type { ChannelType, Conversation, Message } from "@/lib/types";
import { CHANNEL_LABELS, STATUS_LABELS, cn, initials, timeAgo, truncate } from "@/lib/utils";

type Filter = "all" | "open" | "pending" | "unread" | "resolved";

interface Suggestion {
  body: string;
  confidence: number;
  source: string;
  shouldHandoff: boolean;
}

const CHANNEL_ICON: Record<ChannelType, typeof MessageCircle> = {
  widget: MessageCircle,
  whatsapp: MessageCircle,
  telegram: Send,
  instagram: MessageCircle,
  messenger: MessageCircle,
  email: Mail,
  sms: MessageCircle,
  voice: Phone,
  api: Webhook,
};

export function InboxClient({ snapshot }: { snapshot: DashboardSnapshot }) {
  const router = useRouter();
  const [conversations, setConversations] = useState(snapshot.conversations);
  const [selectedId, setSelectedId] = useState<string | null>(
    snapshot.conversations[0]?.id ?? null,
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [reply, setReply] = useState("");
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => setConversations(snapshot.conversations), [snapshot.conversations]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    let alive = true;
    fetch(`/api/conversations/${selectedId}/messages`)
      .then((response) => (response.ok ? response.json() : []))
      .then((data: Message[]) => {
        if (alive) setMessages(Array.isArray(data) ? data : []);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [selectedId]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return conversations.filter((conversation) => {
      if (filter === "unread" && !conversation.unread) return false;
      if (filter !== "all" && filter !== "unread" && conversation.status !== filter) return false;
      if (!query) return true;
      return (
        conversation.contact.name.toLowerCase().includes(query) ||
        (conversation.lastMessage?.body ?? "").toLowerCase().includes(query)
      );
    });
  }, [conversations, filter, search]);

  const selected = conversations.find((item) => item.id === selectedId) ?? null;

  async function patchConversation(partial: Partial<Conversation>, idOverride?: string) {
    const target = conversations.find((item) => item.id === (idOverride ?? selected?.id));
    if (!target) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/conversations/${target.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(partial),
      });
      if (!response.ok) throw new Error("No se pudo actualizar");
      const updated = (await response.json()) as Conversation;
      setConversations((current) =>
        current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)),
      );
      router.refresh();
    } catch {
      setToast("No se pudo actualizar la conversación");
    } finally {
      setBusy(false);
    }
  }

  async function sendReply(override?: string) {
    const text = (override ?? reply).trim();
    if (!text || !selected || busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/conversations/${selected.id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      const data = (await response.json()) as { message?: Message; delivery?: { delivered: boolean; error?: string }; error?: string };
      if (!response.ok || !data.message) throw new Error(data.error ?? "Error al enviar");
      setMessages((current) => [...current, data.message as Message]);
      setReply("");
      setSuggestion(null);
      setToast(
        data.delivery?.delivered
          ? "Respuesta enviada por el canal"
          : `Guardada localmente · ${data.delivery?.error ?? "canal no conectado"}`,
      );
      router.refresh();
    } catch (error) {
      setToast(error instanceof Error ? error.message : "No se pudo enviar");
    } finally {
      setBusy(false);
    }
  }

  async function suggestReply() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/conversations/${selected.id}/suggest`, {
        method: "POST",
      });
      const data = (await response.json()) as { reply?: Suggestion; error?: string };
      if (!response.ok || !data.reply) throw new Error(data.error ?? "No se pudo sugerir");
      setSuggestion(data.reply);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "No se pudo sugerir");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page" style={{ paddingTop: 18 }}>
      <div className="page-head">
        <div>
          <h2>Un solo inbox</h2>
          <p className="muted small">
            {snapshot.counts.open} abiertas · {snapshot.counts.pending} pendientes ·{" "}
            {snapshot.counts.unread} sin leer · {snapshot.counts.contacts} contactos
          </p>
        </div>
        <div className="row">
          <div style={{ position: "relative" }}>
            <Search size={15} style={{ position: "absolute", left: 10, top: 10, color: "#9aa0aa" }} />
            <input
              className="input"
              placeholder="Buscar conversación…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              style={{ paddingLeft: 32, width: 230 }}
            />
          </div>
        </div>
      </div>

      <div className="card inbox-layout">
        <section className="inbox-col list">
          <div className="col-head">
            <div className="strong">Conversaciones</div>
            <div className="filters">
              {(["all", "open", "pending", "unread", "resolved"] as Filter[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={cn("filter", filter === item && "active")}
                  onClick={() => setFilter(item)}
                >
                  {item === "all"
                    ? "Todas"
                    : item === "unread"
                      ? "Sin leer"
                      : STATUS_LABELS[item]}
                </button>
              ))}
            </div>
          </div>
          <div className="conv-list">
            {filtered.length === 0 ? (
              <div className="empty small">No hay conversaciones con este filtro.</div>
            ) : (
              filtered.map((conversation) => {
                const Icon = CHANNEL_ICON[conversation.channel] ?? MessageCircle;
                return (
                  <button
                    key={conversation.id}
                    type="button"
                    className={cn("conv-item", selectedId === conversation.id && "selected")}
                    onClick={() => {
                      setSelectedId(conversation.id);
                      setSuggestion(null);
                      if (conversation.unread) void patchConversation({ unread: false }, conversation.id);
                    }}
                  >
                    <div className="conv-top">
                      <div className="avatar">{initials(conversation.contact.name)}</div>
                      <div className="conv-name ellipsis">{conversation.contact.name}</div>
                      <Icon size={14} className="muted" />
                      {conversation.unread ? <span className="dot" style={{ color: "var(--brand)" }} /> : null}
                    </div>
                    <div className="conv-preview ellipsis">
                      {conversation.lastMessage?.body || "Sin mensajes todavía"}
                    </div>
                    <div className="conv-meta">
                      <span className="badge">{CHANNEL_LABELS[conversation.channel]}</span>
                      <span className={cn(conversation.status === "resolved" && "badge green")}>
                        {STATUS_LABELS[conversation.status]}
                      </span>
                      <span style={{ marginLeft: "auto" }}>{timeAgo(conversation.lastMessageAt)}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section className="inbox-col">
          {!selected ? (
            <div className="empty">
              <div>
                <InboxIcon />
                <p className="strong" style={{ marginTop: 10 }}>Selecciona una conversación</p>
                <p className="small">O conecta un canal en Integraciones para recibir mensajes.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="chat-head">
                <div className="avatar">{initials(selected.contact.name)}</div>
                <div>
                  <div className="strong">{selected.contact.name}</div>
                  <div className="muted small">
                    {CHANNEL_LABELS[selected.channel]} · {STATUS_LABELS[selected.status]}
                    {selected.labels.length ? ` · ${selected.labels.join(", ")}` : ""}
                  </div>
                </div>
                <div className="spacer" />
                <select
                  className="select"
                  style={{ width: 130 }}
                  value={selected.priority}
                  disabled={busy}
                  onChange={(event) => patchConversation({ priority: event.target.value as Conversation["priority"] })}
                >
                  <option value="low">Baja</option>
                  <option value="normal">Normal</option>
                  <option value="high">Alta</option>
                  <option value="urgent">Urgente</option>
                </select>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={busy}
                  onClick={() =>
                    patchConversation({
                      status: selected.status === "resolved" ? "open" : "resolved",
                    })
                  }
                >
                  <CheckCircle2 size={14} />
                  {selected.status === "resolved" ? "Reabrir" : "Resolver"}
                </button>
              </div>

              <div className="messages">
                {messages.length === 0 ? (
                  <div className="empty small">Aún no hay mensajes en esta conversación.</div>
                ) : (
                  messages.map((message) => (
                    <div
                      key={message.id}
                      className={cn(
                        "msg",
                        message.direction === "outbound" && "outbound",
                        message.senderType === "bot" && "bot",
                      )}
                    >
                      <div className="msg-meta">
                        {message.senderType === "bot"
                          ? "Bot · sugerencia automática"
                          : message.authorName || (message.direction === "inbound" ? selected.contact.name : "Tú")}
                      </div>
                      <div style={{ whiteSpace: "pre-wrap" }}>{message.body}</div>
                    </div>
                  ))
                )}
              </div>

              {suggestion ? (
                <div className="suggestion">
                  <div className="row small strong" style={{ marginBottom: 6 }}>
                    <Sparkles size={14} /> Sugerencia del motor
                    <span className="badge brand">{suggestion.source}</span>
                    <span className="badge">{Math.round(suggestion.confidence * 100)}% confianza</span>
                    {suggestion.shouldHandoff ? <span className="badge amber">Derivar a humano</span> : null}
                  </div>
                  <div className="small" style={{ whiteSpace: "pre-wrap" }}>{suggestion.body}</div>
                  <div className="row" style={{ marginTop: 9 }}>
                    <button type="button" className="btn btn-sm" onClick={() => setReply(suggestion.body)}>
                      Usar en el editor
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={busy}
                      onClick={() => {
                        setReply("");
                        void sendReply(suggestion.body);
                      }}
                    >
                      <Send size={13} /> Enviar
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => setSuggestion(null)}>
                      Descartar
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="composer">
                <textarea
                  className="textarea"
                  placeholder="Escribe tu respuesta…"
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                />
                <div className="composer-actions">
                  <button type="button" className="btn btn-sm" disabled={busy} onClick={suggestReply}>
                    <Sparkles size={14} /> Sugerir con IA
                  </button>
                  <div className="spacer" />
                  <span className="muted small">Enter + clic para enviar</span>
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy || !reply.trim()} onClick={() => void sendReply()}>
                    <Send size={14} /> Enviar
                  </button>
                </div>
              </div>
            </>
          )}
        </section>

        <section className="inbox-col right">
          <div className="col-head strong">Contacto</div>
          {selected ? (
            <div className="pad small">
              <div className="row" style={{ marginBottom: 14 }}>
                <div className="avatar" style={{ width: 42, height: 42, flexBasis: 42, fontSize: 14 }}>
                  {initials(selected.contact.name)}
                </div>
                <div>
                  <div className="strong">{selected.contact.name}</div>
                  <div className="muted">{CHANNEL_LABELS[selected.channel]}</div>
                </div>
              </div>
              <ContactLine icon={<Mail size={14} />} label="Email" value={selected.contact.email} />
              <ContactLine icon={<Phone size={14} />} label="Teléfono" value={selected.contact.phone} />
              <ContactLine icon={<Tag size={14} />} label="Etiquetas" value={selected.labels.join(", ")} />
              <ContactLine icon={<Clock3 size={14} />} label="Último mensaje" value={timeAgo(selected.lastMessageAt)} />
              <div className="strong" style={{ margin: "16px 0 8px" }}>Atributos</div>
              {Object.entries(selected.contact.attributes).length === 0 ? (
                <div className="muted">Sin atributos personalizados todavía.</div>
              ) : (
                Object.entries(selected.contact.attributes).map(([key, value]) => (
                  <div key={key} className="row" style={{ justifyContent: "space-between", padding: "3px 0" }}>
                    <span className="muted">{key}</span>
                    <span>{String(value)}</span>
                  </div>
                ))
              )}
              <div className="strong" style={{ margin: "16px 0 8px" }}>Detalles</div>
              <div className="muted">ID: {selected.id}</div>
              <div className="muted">Mensajes: {selected.messageCount}</div>
            </div>
          ) : (
            <div className="empty small">Sin selección</div>
          )}
        </section>
      </div>
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}

function ContactLine({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="row muted" style={{ gap: 6 }}>
        {icon} {label}
      </div>
      <div style={{ paddingLeft: 20, marginTop: 2 }}>{value || "—"}</div>
    </div>
  );
}

function InboxIcon() {
  return <MessageCircle size={30} style={{ color: "var(--brand)" }} />;
}
