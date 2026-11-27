"use client";

import { useState } from "react";
import { MessageCircle, Send } from "lucide-react";

export function WidgetClient({ inboxId }: { inboxId: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!message.trim() || state === "sending") return;
    setState("sending");
    try {
      let visitorId = "";
      try {
        visitorId = window.localStorage.getItem("conversa-visitor-id") ?? "";
        if (!visitorId) {
          visitorId = crypto.randomUUID();
          window.localStorage.setItem("conversa-visitor-id", visitorId);
        }
      } catch {
        visitorId = `visitor-${Date.now()}`;
      }
      const response = await fetch("/api/webhooks/widget", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          externalContactId: visitorId,
          contactName: name.trim() || "Visitante",
          contactEmail: email.trim() || undefined,
          body: message.trim(),
          externalMessageId: crypto.randomUUID(),
          inboxId,
        }),
      });
      if (!response.ok) throw new Error("No se pudo enviar");
      setMessage("");
      setState("sent");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="card" style={{ maxWidth: 440, margin: "40px auto", overflow: "hidden" }}>
      <div style={{ background: "var(--brand)", color: "#fff", padding: "16px 18px" }}>
        <div className="row"><MessageCircle size={18} /> <strong>Conversa</strong></div>
        <div className="small" style={{ opacity: 0.85 }}>Escríbenos y te responderemos enseguida</div>
      </div>
      <form onSubmit={submit} className="pad">
        <div className="field">
          <label className="label" htmlFor="widget-name">Tu nombre</label>
          <input id="widget-name" className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Nombre" />
        </div>
        <div className="field">
          <label className="label" htmlFor="widget-email">Email (opcional)</label>
          <input id="widget-email" className="input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="tu@email.com" />
        </div>
        <div className="field">
          <label className="label" htmlFor="widget-message">Mensaje</label>
          <textarea id="widget-message" className="textarea" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="¿En qué podemos ayudarte?" required />
        </div>
        <button type="submit" className="btn btn-primary" disabled={state === "sending"}>
          <Send size={15} /> {state === "sending" ? "Enviando…" : "Enviar mensaje"}
        </button>
        {state === "sent" ? <p className="small" style={{ color: "var(--green)" }}>¡Mensaje recibido! Aparecerá en la bandeja.</p> : null}
        {state === "error" ? <p className="small" style={{ color: "var(--red)" }}>No se pudo enviar. Inténtalo de nuevo.</p> : null}
      </form>
    </div>
  );
}
