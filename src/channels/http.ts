/**
 * Cliente HTTP mínimo basado en el `fetch` global.
 * No hay SDKs externos ni listeners persistentes: cada llamada es una petición
 * independiente, compatible con funciones serverless de Vercel.
 */

import { asRecord, errorMessage, stringValue } from "./types";

export interface HttpResult {
  ok: boolean;
  status?: number;
  data?: unknown;
  text?: string;
  error?: string;
}

function extractApiError(data: unknown): string | undefined {
  const root = asRecord(data);
  if (!root) return undefined;
  const nested = asRecord(root.error) ?? asRecord(root.errors);
  const candidates: unknown[] = [
    nested?.message,
    nested?.error,
    nested?.msg,
    nested?.description,
    root.message,
    root.error,
    root.detail,
  ];
  for (const candidate of candidates) {
    const text = stringValue(candidate);
    if (text) return text.slice(0, 300);
  }
  return undefined;
}

/** Ejecuta una petición JSON y devuelve siempre un resultado, nunca lanza. */
export async function requestJson(url: string, init: RequestInit = {}): Promise<HttpResult> {
  try {
    const signal =
      typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(12_000)
        : undefined;
    const response = await fetch(url, { ...init, signal });
    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        // Respuesta no JSON: se conserva como texto.
      }
    }
    if (!response.ok) {
      const detail = extractApiError(data) ?? (text ? text.slice(0, 200) : "");
      return {
        ok: false,
        status: response.status,
        data,
        text,
        error: detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}`,
      };
    }
    return { ok: true, status: response.status, data, text };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

/** Basic Auth para la API de Twilio. */
export function basicAuthHeader(user: string, password: string): string {
  const credentials = `${user}:${password}`;
  if (typeof btoa === "function") return `Basic ${btoa(credentials)}`;
  if (typeof Buffer !== "undefined") return `Basic ${Buffer.from(credentials).toString("base64")}`;
  return `Basic ${credentials}`;
}

/** Escapa texto para insertarlo dentro de un elemento XML/TwiML. */
export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Codifica parámetros de formulario (Twilio espera application/x-www-form-urlencoded). */
export function formBody(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

/** ID externo de la respuesta, si el proveedor lo devuelve. */
export function responseId(data: unknown): string | undefined {
  const root = asRecord(data);
  if (!root) return undefined;
  return (
    stringValue(root.id) ||
    stringValue(root.message_id) ||
    stringValue(root.sid) ||
    stringValue(root.messageId) ||
    undefined
  );
}
