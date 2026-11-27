"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, Plus, TrendingUp } from "lucide-react";
import type { Contact, Deal, Task } from "@/lib/types";
import type { DashboardSnapshot } from "@/lib/view-types";

export function CrmClient({ snapshot }: { snapshot: DashboardSnapshot }) {
  const router = useRouter();
  const [deals, setDeals] = useState(snapshot.deals);
  const [tasks, setTasks] = useState(snapshot.tasks);
  const [dealTitle, setDealTitle] = useState("");
  const [dealValue, setDealValue] = useState("");
  const [dealStage, setDealStage] = useState("Nuevo");
  const [dealContact, setDealContact] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskContact, setTaskContact] = useState("");
  const [toast, setToast] = useState("");

  async function create(kind: "deal" | "task", body: Record<string, unknown>) {
    const response = await fetch("/api/crm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, ...body }),
    });
    if (!response.ok) throw new Error("No se pudo guardar");
    return response.json();
  }

  async function addDeal(event: React.FormEvent) {
    event.preventDefault();
    if (!dealTitle.trim()) return;
    try {
      const deal = (await create("deal", {
        title: dealTitle,
        value: Number(dealValue) || 0,
        stage: dealStage,
        contactId: dealContact,
      })) as Deal;
      setDeals((current) => [deal, ...current]);
      setDealTitle("");
      setDealValue("");
      setToast("Negocio creado");
      router.refresh();
    } catch {
      setToast("No se pudo crear el negocio");
    }
  }

  async function addTask(event: React.FormEvent) {
    event.preventDefault();
    if (!taskTitle.trim()) return;
    try {
      const task = (await create("task", { title: taskTitle, contactId: taskContact })) as Task;
      setTasks((current) => [task, ...current]);
      setTaskTitle("");
      setToast("Tarea creada");
      router.refresh();
    } catch {
      setToast("No se pudo crear la tarea");
    }
  }

  const contactName = (id?: string): string =>
    snapshot.contacts.find((contact: Contact) => contact.id === id)?.name || "Sin contacto";

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>CRM ligero</h2>
          <p className="muted">Negocios y tareas vinculados a los contactos de la bandeja.</p>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="card pad">
          <div className="row strong" style={{ marginBottom: 12 }}>
            <TrendingUp size={16} /> Negocios ({deals.length})
          </div>
          {deals.length === 0 ? (
            <div className="empty small">Sin negocios todavía.</div>
          ) : (
            <table className="table">
              <thead>
                <tr><th>Negocio</th><th>Contacto</th><th>Etapa</th><th>Valor</th></tr>
              </thead>
              <tbody>
                {deals.map((deal) => (
                  <tr key={deal.id}>
                    <td className="strong">{deal.title}</td>
                    <td>{contactName(deal.contactId)}</td>
                    <td><span className="badge brand">{deal.stage}</span></td>
                    <td>{deal.value.toLocaleString("es-ES")} {deal.currency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <form onSubmit={addDeal} style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
            <div className="field">
              <label className="label">Título del negocio</label>
              <input className="input" value={dealTitle} onChange={(event) => setDealTitle(event.target.value)} placeholder="Renovación anual" />
            </div>
            <div className="row">
              <div className="field" style={{ flex: 1 }}>
                <label className="label">Valor</label>
                <input className="input" type="number" value={dealValue} onChange={(event) => setDealValue(event.target.value)} placeholder="1500" />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label className="label">Etapa</label>
                <select className="select" value={dealStage} onChange={(event) => setDealStage(event.target.value)}>
                  <option>Nuevo</option><option>En negociación</option><option>Ganado</option><option>Perdido</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label className="label">Contacto</label>
              <select className="select" value={dealContact} onChange={(event) => setDealContact(event.target.value)}>
                <option value="">Sin contacto</option>
                {snapshot.contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>{contact.name}</option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn btn-primary"><Plus size={15} /> Añadir negocio</button>
          </form>
        </div>

        <div className="card pad">
          <div className="row strong" style={{ marginBottom: 12 }}>
            <ClipboardList size={16} /> Tareas ({tasks.length})
          </div>
          {tasks.length === 0 ? (
            <div className="empty small">Sin tareas pendientes.</div>
          ) : (
            <table className="table">
              <thead><tr><th>Tarea</th><th>Contacto</th><th>Estado</th></tr></thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id}>
                    <td className="strong">{task.title}</td>
                    <td>{contactName(task.contactId)}</td>
                    <td><span className={task.done ? "badge green" : "badge amber"}>{task.done ? "Hecha" : "Pendiente"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <form onSubmit={addTask} style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
            <div className="field">
              <label className="label">Tarea</label>
              <input className="input" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="Llamar para confirmar pedido" />
            </div>
            <div className="field">
              <label className="label">Contacto</label>
              <select className="select" value={taskContact} onChange={(event) => setTaskContact(event.target.value)}>
                <option value="">Sin contacto</option>
                {snapshot.contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>{contact.name}</option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn btn-primary"><Plus size={15} /> Añadir tarea</button>
          </form>
        </div>
      </div>
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
