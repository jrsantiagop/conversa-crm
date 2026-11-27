"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Plus, Trash2 } from "lucide-react";
import type { KnowledgeArticle } from "@/lib/types";

export function ConocimientoClient({ initialArticles }: { initialArticles: KnowledgeArticle[] }) {
  const router = useRouter();
  const [articles, setArticles] = useState(initialArticles);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [locale, setLocale] = useState("es");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || !content.trim() || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/articles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, content, locale }),
      });
      if (!response.ok) throw new Error("No se pudo guardar");
      const article = (await response.json()) as KnowledgeArticle;
      setArticles((current) => [article, ...current]);
      setTitle("");
      setContent("");
      setToast("Artículo publicado");
      router.refresh();
    } catch {
      setToast("No se pudo guardar el artículo");
    } finally {
      setBusy(false);
      setTimeout(() => setToast(""), 2800);
    }
  }

  async function unpublish(id: string) {
    const response = await fetch(`/api/articles?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (response.ok) {
      setArticles((current) => current.filter((article) => article.id !== id));
      router.refresh();
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Base de conocimiento</h2>
          <p className="muted">El motor conversacional usa estos artículos para sugerir respuestas (RAG).</p>
        </div>
        <span className="badge brand"><BookOpen size={13} /> {articles.length} artículos</span>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1fr) 360px" }}>
        <div className="card pad">
          <div className="strong" style={{ marginBottom: 12 }}>Artículos publicados</div>
          {articles.length === 0 ? (
            <div className="empty small">Todavía no hay artículos. Crea el primero a la derecha.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Título</th>
                  <th>Idioma</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {articles.map((article) => (
                  <tr key={article.id}>
                    <td>
                      <div className="strong">{article.title}</div>
                      <div className="muted small ellipsis" style={{ maxWidth: 420 }}>{article.content}</div>
                    </td>
                    <td>{article.locale}</td>
                    <td>
                      <span className={article.published ? "badge green" : "badge"}>
                        {article.published ? "Publicado" : "Oculto"}
                      </span>
                    </td>
                    <td>
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => void unpublish(article.id)}>
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <form className="card pad" onSubmit={create}>
          <div className="strong" style={{ marginBottom: 12 }}>Nuevo artículo</div>
          <div className="field">
            <label className="label" htmlFor="article-title">Título</label>
            <input id="article-title" className="input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="¿Cómo solicito una devolución?" />
          </div>
          <div className="field">
            <label className="label" htmlFor="article-locale">Idioma</label>
            <input id="article-locale" className="input" value={locale} onChange={(event) => setLocale(event.target.value)} placeholder="es" />
          </div>
          <div className="field">
            <label className="label" htmlFor="article-content">Contenido</label>
            <textarea id="article-content" className="textarea" style={{ minHeight: 160 }} value={content} onChange={(event) => setContent(event.target.value)} placeholder="Escribe la respuesta canónica. Cuanto más concreta, mejores serán las sugerencias." />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            <Plus size={15} /> {busy ? "Guardando…" : "Publicar artículo"}
          </button>
        </form>
      </div>
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
