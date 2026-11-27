import type { ChannelType, ConversationStatus } from "./types";

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function newId(prefix: string): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return `${prefix}_${c.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function workspaceId(): string {
  return process.env.DEFAULT_WORKSPACE_ID?.trim() || "default";
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

export function timeAgo(iso?: string): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return "—";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `hace ${days} d`;
  return new Date(iso).toLocaleDateString("es-ES");
}

export const CHANNEL_LABELS: Record<ChannelType, string> = {
  widget: "Web",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  instagram: "Instagram",
  messenger: "Messenger",
  email: "Email",
  sms: "SMS",
  voice: "Voz",
  api: "API",
};

export const STATUS_LABELS: Record<ConversationStatus, string> = {
  open: "Abierta",
  pending: "Pendiente",
  resolved: "Resuelta",
  snoozed: "Pospuesta",
};

export function truncate(text: string, max = 90): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}
