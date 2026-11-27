"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Code2,
  Copy,
  Facebook,
  Globe,
  Instagram,
  Mail,
  MessageCircle,
  Phone,
  Send,
  Smartphone,
  ExternalLink,
} from "lucide-react";
import type { ChannelDefinition } from "@/lib/types";
import type { InboxView } from "@/lib/view-types";
import { cn } from "@/lib/utils";

const ICONS: Record<string, typeof Globe> = {
  widget: Globe,
  whatsapp: MessageCircle,
  telegram: Send,
  instagram: Instagram,
  messenger: Facebook,
  email: Mail,
  sms: Smartphone,
  voice: Phone,
  api: Code2,
};

export function IntegracionesClient({
  definitions,
  initialInboxes,
}: {
  definitions: ChannelDefinition[];
  initialInboxes: InboxView[];
}) {
  const router = useRouter();
  const [inboxes, setInboxes] = useState(initialInboxes);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [clearing, setClearing] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  function inboxFor(channel: string): InboxView | undefined {
    return inboxes.find((inbox) => inbox.channel === channel);
  }

  function setDraft(key: string, value: string) {
    setDrafts((current) => ({ ...current, [key]: value }));
  }

  function toggleClear(key: string, fieldKey: string) {
    setClearing((current) => {
      const list = current[key] ?? [];
      return { ...current, [key]: list.includes(fieldKey) ? list.filter((item) => item !== fieldKey) : [...list, fieldKey] };
    });
  }

  async function save(definition: ChannelDefinition) {
    const inbox = inboxFor(definition.type);
    if (!inbox) return;
    setSaving(inbox.id);
    try {
      const credentials: Record<string, string> = {};
      for (const field of definition.fields) {
        const value = drafts[`${inbox.id}:${field.key}`];
        if (value && value.trim()) credentials[field.key] = value.trim();
      }
      const response = await fetch("/api/integrations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          inboxId: inbox.id,
          enabled: inbox.enabled,
          credentials,
          clear: clearing[inbox.id] ?? [],
        }),
      });
      const data = (await response.json()) as { inbox?: InboxView; error?: string };
      if (!response.ok || !data.inbox) throw new Error(data.error ?? "No se pudo guardar");
      setInboxes((current) => current.map((item) => (item.id === inbox.id ? { ...item, ...data.inbox } : item)));
      setDrafts({});
      setClearing({});
      setToast(`${definition.name} guardado`);
      router.refresh();
    } catch (error) {
      setToast(error instanceof Error ? error.message : "No se pudo guardar");
    } finally {
      setSaving(null);
      setTimeout(() => setToast(""), 3000);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast("Copiado al portapapeles");
      setTimeout(() => setToast(""), 2000);
    } catch {
      setToast("No se pudo copiar");
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Integraciones de canales</h2>
          <p className="muted">
            Un mismo inbox para todos tus canales. Pega aquí los IDs y tokens de cada proveedor.
          </p>
        </div>
        <span className="badge green"><Check size={13} /> Credenciales cifradas en reposo</span>
      </div>

      <div className="card pad" style={{ marginBottom: 16 }}>
        <div className="strong" style={{ marginBottom: 6 }}>Cómo conectar un canal</div>
        <ol className="muted small" style={{ margin: 0, paddingLeft: 20 }}>
          <li>Rellena los IDs/tokens del proveedor y activa el canal.</li>
          <li>Copia la URL del webhook y regístrala en el panel del proveedor.</li>
          <li>Envía un mensaje de prueba: aparecerá en la bandeja y el bot podrá sugerir respuesta.</li>
        </ol>
      </div>

      <div className="channel-grid">
        {definitions.map((definition) => {
          const inbox = inboxFor(definition.type);
          if (!inbox) return null;
          const Icon = ICONS[definition.type] ?? MessageCircle;
          const webhook = origin ? `${origin}/api/webhooks/${definition.type}` : `/api/webhooks/${definition.type}`;
          const clearList = clearing[inbox.id] ?? [];
          return (
            <div className="card channel-card pad" key={definition.type}>
              <div className="row">
                <div style={{ width: 34, height: 34, borderRadius: 9, background: "#efefff", display: "grid", placeItems: "center", color: "var(--brand-dark)" }}>
                  <Icon size={18} />
                </div>
                <div style={{ flex: 1 }}>
                  <h3>{definition.name}</h3>
                  <div className="small muted">{definition.type}</div>
                </div>
                <button
                  type="button"
                  className={cn("filter", inbox.enabled && "active")}
                  onClick={() =>
                    setInboxes((current) =>
                      current.map((item) =>
                        item.id === inbox.id ? { ...item, enabled: !item.enabled } : item,
                      ),
                    )
                  }
                >
                  {inbox.enabled ? "Activo" : "Inactivo"}
                </button>
              </div>
              <p className="desc">{definition.description}</p>

              <div className="field">
                <span className="label">URL del webhook</span>
                <div className="row">
                  <div className="webhook-box" style={{ flex: 1 }}>{webhook}</div>
                  <button type="button" className="btn btn-sm" title="Copiar" onClick={() => void copy(webhook)}>
                    <Copy size={14} />
                  </button>
                </div>
                {definition.docsUrl?.startsWith("http") ? (
                  <a className="small row" style={{ marginTop: 6, color: "var(--brand)" }} href={definition.docsUrl} target="_blank" rel="noreferrer">
                    Documentación oficial <ExternalLink size={12} />
                  </a>
                ) : null}
              </div>

              <div className="channel-fields">
                {definition.fields.map((field) => {
                  const configured = inbox.credentialKeys.includes(field.key) && !clearList.includes(field.key);
                  const draftKey = `${inbox.id}:${field.key}`;
                  return (
                    <div className="field" key={field.key}>
                      <div className="row" style={{ justifyContent: "space-between" }}>
                        <label className="label" htmlFor={draftKey} style={{ marginBottom: 3 }}>
                          {field.label}
                          {field.required ? " *" : ""}
                        </label>
                        {configured ? (
                          <button type="button" className="btn btn-sm btn-danger" onClick={() => toggleClear(inbox.id, field.key)}>
                            {clearList.includes(field.key) ? "Restaurar" : "Limpiar"}
                          </button>
                        ) : null}
                      </div>
                      <input
                        id={draftKey}
                        className="input"
                        type={field.type === "password" ? "password" : "text"}
                        placeholder={configured ? "Configurado · dejar vacío para conservar" : field.placeholder}
                        value={drafts[draftKey] ?? ""}
                        onChange={(event) => setDraft(draftKey, event.target.value)}
                      />
                      {field.help ? <div className="muted small" style={{ marginTop: 3 }}>{field.help}</div> : null}
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                className="btn btn-primary"
                style={{ width: "100%", marginTop: 6 }}
                disabled={saving === inbox.id}
                onClick={() => void save(definition)}
              >
                <Check size={15} /> {saving === inbox.id ? "Guardando…" : "Guardar canal"}
              </button>
            </div>
          );
        })}
      </div>
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
