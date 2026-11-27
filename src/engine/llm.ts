/** Minimal OpenAI-compatible chat client. No SDK, no import-time side effects. */

export type EnvRecord = Record<string, string | undefined>;

export interface LlmConfig {
  apiKey: string;
  /** Base URL without a trailing slash, e.g. https://api.openai.com/v1 */
  baseUrl: string;
  model: string;
  timeoutMs: number;
  temperature: number;
  maxTokens: number;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: unknown };
    text?: unknown;
  }>;
}

function readPositiveNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readEnv(explicit?: EnvRecord): EnvRecord {
  if (explicit) return explicit;
  if (typeof process !== "undefined" && process.env) return process.env as EnvRecord;
  return {};
}

/**
 * Resolves LLM settings from the environment. Returns null when no API key is
 * configured, which is the signal for the engine to stay fully offline.
 */
export function resolveLlmConfig(env?: EnvRecord): LlmConfig | null {
  const values = readEnv(env);
  const apiKey = values.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  return {
    apiKey,
    baseUrl: (values.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, ""),
    model: values.OPENAI_MODEL?.trim() || "gpt-4o-mini",
    timeoutMs: readPositiveNumber(values.LLM_TIMEOUT_MS, 8_000),
    temperature: readPositiveNumber(values.LLM_TEMPERATURE, 0.2),
    maxTokens: readPositiveNumber(values.LLM_MAX_TOKENS, 500),
  };
}

function contentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part === "object" && part !== null && "text" in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .join("");
  }
  return "";
}

/**
 * Sends a chat completion request and returns the assistant text.
 * Returns null (never throws) on missing config, timeout, HTTP errors, empty
 * responses or malformed payloads.
 */
export async function callLlm(
  prompt: string,
  config?: LlmConfig | null,
  env?: EnvRecord,
): Promise<string | null> {
  const resolved = config === null ? null : config === undefined ? resolveLlmConfig(env) : config;
  if (!resolved || !resolved.apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), resolved.timeoutMs);

  try {
    const response = await fetch(`${resolved.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resolved.apiKey}`,
      },
      body: JSON.stringify({
        model: resolved.model,
        messages: [{ role: "user", content: prompt }],
        temperature: resolved.temperature,
        max_tokens: resolved.maxTokens,
      }),
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as ChatCompletionResponse;
    const choice = payload.choices?.[0];
    const text = contentToString(choice?.message?.content) || contentToString(choice?.text);
    const trimmed = text.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
