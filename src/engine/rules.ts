import type { ChannelType, Priority } from "@/lib/types";
import type {
  BotReply,
  EngineContext,
  Rule,
  RuleAction,
  RuleCondition,
  RuleEffect,
  RuleEvaluation,
} from "./types";

const HANDOFF_REPLY =
  "Claro, te paso con una persona del equipo. Enseguida revisan tu caso y te responden por aquí.";

const CHANNELS: ReadonlySet<string> = new Set<ChannelType>([
  "widget",
  "whatsapp",
  "telegram",
  "instagram",
  "messenger",
  "email",
  "sms",
  "voice",
  "api",
]);

const PRIORITIES: ReadonlySet<string> = new Set(["low", "normal", "high", "urgent"]);

/** Small, deterministic language hints. No external detector, no network. */
const LANGUAGE_WORDS: Record<string, readonly string[]> = {
  es: [
    "el", "la", "los", "las", "de", "que", "por", "para", "con", "un", "una",
    "hola", "buenos", "dias", "tardes", "gracias", "favor", "quiero", "necesito",
    "como", "donde", "cuando", "precio", "horario", "ayuda", "tengo",
  ],
  en: [
    "the", "and", "for", "with", "you", "are", "hi", "hello", "thanks", "please",
    "need", "want", "how", "where", "when", "price", "hours", "help", "can",
  ],
  pt: [
    "os", "as", "de", "que", "para", "com", "um", "uma", "obrigado", "obrigada",
    "favor", "quero", "preciso", "como", "onde", "quando", "preco", "horario",
    "ajuda", "tenho",
  ],
  fr: [
    "le", "la", "les", "des", "pour", "avec", "bonjour", "merci", "vous",
    "prix", "horaires", "aide", "comment", "quand",
  ],
  it: [
    "il", "per", "con", "buongiorno", "grazie", "prezzo", "orari", "aiuto",
    "come", "quando", "vuole",
  ],
  de: [
    "der", "die", "das", "und", "fur", "mit", "hallo", "danke", "bitte",
    "preis", "zeiten", "hilfe", "wie", "wann",
  ],
};

/** Fold accents so "horário" and "horario" are treated the same. */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Heuristic language detection. Counts language-specific words, returns the
 * language with most hits and "es" as a safe default when there is no signal.
 */
export function detectLanguage(text: string): string {
  const tokens = new Set(normalizeText(text).split(/[^a-z0-9]+/).filter(Boolean));
  let best = "es";
  let bestCount = 0;

  for (const [language, words] of Object.entries(LANGUAGE_WORDS)) {
    let count = 0;
    for (const word of words) {
      if (tokens.has(word)) count += 1;
    }
    if (count > bestCount) {
      best = language;
      bestCount = count;
    }
  }
  return best;
}

/** The message the bot should react to: newest inbound text in the thread. */
export function getLatestInboundMessage(messages: readonly MessageLike[]): MessageLike | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.direction === "inbound" && message.body.trim().length > 0) return message;
  }
  return undefined;
}

interface MessageLike {
  direction: string;
  body: string;
  subject?: string;
}

type RuleField = NonNullable<Extract<RuleCondition, { field?: string }>["field"]>;

function conditionText(
  condition: { field?: RuleField },
  context: EngineContext,
  fallback: string,
): string {
  switch (condition.field) {
    case "subject":
      return context.conversation.subject ?? "";
    case "contactName":
      return context.contact.name ?? "";
    default:
      return fallback;
  }
}

function matchesTextCondition(
  condition: Extract<RuleCondition, { type: "contains" | "equals" | "startsWith" }>,
  context: EngineContext,
  fallback: string,
): boolean {
  const value = condition.value;
  const text = conditionText(condition, context, fallback);
  let matched: boolean;
  if (condition.caseSensitive) {
    matched =
      condition.type === "contains"
        ? text.includes(value)
        : condition.type === "equals"
          ? text === value
          : text.startsWith(value);
  } else {
    const left = normalizeText(text);
    const right = normalizeText(value);
    matched =
      condition.type === "contains"
        ? left.includes(right)
        : condition.type === "equals"
          ? left === right
          : left.startsWith(right);
  }
  if (condition.negate) matched = !matched;
  return matched;
}

function matchesCondition(
  condition: RuleCondition,
  context: EngineContext,
  fallback: string,
  language: string,
): boolean {
  if (condition.type === "channel") {
    const current = context.channel ?? context.conversation.channel;
    const allowed = Array.isArray(condition.value) ? condition.value : [condition.value];
    let matched = allowed.includes(current);
    if (condition.negate) matched = !matched;
    return matched;
  }

  if (condition.type === "language") {
    const allowed = Array.isArray(condition.value) ? condition.value : [condition.value];
    let matched = allowed.some((item) => normalizeText(item) === normalizeText(language));
    if (condition.negate) matched = !matched;
    return matched;
  }

  if (condition.type === "regex") {
    let regex: RegExp;
    try {
      regex = new RegExp(condition.pattern, condition.flags ?? "i");
    } catch {
      return false;
    }
    const text = conditionText(condition, context, fallback);
    let matched = regex.test(text);
    if (condition.negate) matched = !matched;
    return matched;
  }

  return matchesTextCondition(condition, context, fallback);
}

function renderTemplate(body: string, context: EngineContext): string {
  const values: Record<string, string> = {
    contactName: context.contact.name || "",
    name: context.contact.name || "",
    channel: context.channel ?? context.conversation.channel,
    language: context.language ?? detectLanguage(""),
    workspaceId: context.workspaceId,
  };
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => values[key] ?? "");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Evaluates rules in priority order (stable for equal priorities).
 * Only the first matching enabled rule produces a reply; its side effects are
 * returned separately so the caller can persist them.
 */
export function evaluateRules(
  context: EngineContext,
  rules: readonly Rule[] = defaultRules,
  options?: { language?: string },
): RuleEvaluation {
  const latest = getLatestInboundMessage(context.messages);
  const fallback = latest?.body ?? "";
  const language = options?.language ?? context.language ?? detectLanguage(fallback);

  const ordered = rules
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => rule.enabled !== false)
    .sort((a, b) => a.rule.priority - b.rule.priority || a.index - b.index);

  for (const { rule } of ordered) {
    if (rule.conditions.length === 0) continue;

    const results = rule.conditions.map((condition) =>
      matchesCondition(condition, context, fallback, language),
    );
    const matched =
      rule.match === "any" ? results.some(Boolean) : results.every(Boolean);
    if (!matched) continue;

    const effects: RuleEffect[] = [];
    let body: string | null = null;
    for (const action of rule.actions) {
      switch (action.type) {
        case "reply":
          body = renderTemplate(action.body, context);
          break;
        case "addLabel":
          effects.push({ type: "addLabel", label: action.label });
          break;
        case "setPriority":
          effects.push({ type: "setPriority", priority: action.priority });
          break;
        case "handoff":
          effects.push({ type: "handoff" });
          break;
      }
    }

    const handoff = effects.some((effect) => effect.type === "handoff");
    if (body === null && handoff) body = HANDOFF_REPLY;
    const reply: BotReply | null = body === null
      ? null
      : {
          body,
          confidence: clamp(rule.confidence ?? 0.95, 0, 1),
          source: "rule",
          shouldHandoff: handoff,
        };

    return { reply, effects, matchedRule: rule };
  }

  return { reply: null, effects: [] };
}

/** Three safe starter rules: greeting, generic info, and explicit human request. */
export const defaultRules: readonly Rule[] = [
  {
    id: "handoff-human",
    name: "Explicit human request",
    priority: 10,
    enabled: true,
    match: "any",
    conditions: [
      {
        type: "regex",
        pattern:
          "(humano|agente|operador|representante|persona|alguien|supervisor|hablar con|speak to (a )?(human|person|agent)|human|atendente|falar com (uma )?pessoa|parler a)",
        flags: "i",
      },
    ],
    actions: [{ type: "reply", body: HANDOFF_REPLY }, { type: "handoff" }],
    confidence: 0.99,
  },
  {
    id: "greeting",
    name: "Greeting",
    priority: 30,
    enabled: true,
    match: "any",
    conditions: [
      { type: "contains", value: "hola" },
      { type: "contains", value: "buenos dias" },
      { type: "contains", value: "buenas tardes" },
      { type: "regex", pattern: "^(hi|hello|hey|good morning|good afternoon|oi|ol[aá]|bonjour)\\b", flags: "i" },
    ],
    actions: [
      {
        type: "reply",
        body: "¡Hola {{contactName}}! Soy el asistente de {{workspaceId}}. ¿En qué puedo ayudarte hoy?",
      },
    ],
    confidence: 0.96,
  },
  {
    id: "hours-and-pricing",
    name: "Hours and pricing",
    priority: 20,
    enabled: true,
    match: "any",
    conditions: [
      { type: "contains", value: "horario" },
      { type: "contains", value: "precio" },
      { type: "contains", value: "tarifa" },
      { type: "contains", value: "cuanto cuesta" },
      { type: "regex", pattern: "\\b(hours?|price|pricing|cost|horario|preco|horaires?|prezzo)\\b", flags: "i" },
    ],
    actions: [
      {
        type: "reply",
        body: "Puedo ayudarte con horarios y precios. ¿Qué plan o servicio te interesa? Buscaré la información exacta en nuestra base de conocimiento.",
      },
      { type: "addLabel", label: "ventas" },
    ],
    confidence: 0.9,
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseField(value: unknown): RuleField | undefined {
  return value === "message" || value === "subject" || value === "contactName" ? value : undefined;
}

function parseCondition(raw: unknown): RuleCondition | null {
  if (!isRecord(raw)) return null;
  const negate = raw.negate === true ? true : undefined;
  const field = parseField(raw.field);

  if (raw.type === "contains" || raw.type === "equals" || raw.type === "startsWith") {
    const value = optionalString(raw.value);
    if (value === undefined) return null;
    const caseSensitive = raw.caseSensitive === true ? true : undefined;
    return {
      type: raw.type,
      value,
      ...(field ? { field } : {}),
      ...(caseSensitive ? { caseSensitive } : {}),
      ...(negate ? { negate } : {}),
    };
  }

  if (raw.type === "regex") {
    const pattern = optionalString(raw.pattern);
    if (pattern === undefined) return null;
    const flags = optionalString(raw.flags);
    return {
      type: "regex",
      pattern,
      ...(flags ? { flags } : {}),
      ...(field ? { field } : {}),
      ...(negate ? { negate } : {}),
    };
  }

  if (raw.type === "channel") {
    const rawValue = raw.value;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    if (!values.every((item) => typeof item === "string" && CHANNELS.has(item))) return null;
    return {
      type: "channel",
      value: (Array.isArray(rawValue) ? values : values[0]) as ChannelType | ChannelType[],
      ...(negate ? { negate } : {}),
    };
  }

  if (raw.type === "language") {
    const rawValue = raw.value;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    if (!values.every((item) => typeof item === "string")) return null;
    return {
      type: "language",
      value: (Array.isArray(rawValue) ? values : values[0]) as string | string[],
      ...(negate ? { negate } : {}),
    };
  }

  return null;
}

function parseAction(raw: unknown): RuleAction | null {
  if (!isRecord(raw)) return null;
  if (raw.type === "reply") {
    const body = optionalString(raw.body);
    return body === undefined ? null : { type: "reply", body };
  }
  if (raw.type === "addLabel") {
    const label = optionalString(raw.label);
    return label === undefined ? null : { type: "addLabel", label };
  }
  if (raw.type === "setPriority") {
    const priority = raw.priority;
    if (typeof priority !== "string" || !PRIORITIES.has(priority)) return null;
    return { type: "setPriority", priority: priority as Priority };
  }
  if (raw.type === "handoff") return { type: "handoff" };
  return null;
}

/**
 * Parses rules coming from JSON (API body, DB column, config file).
 * Invalid entries are ignored so a bad rule cannot break message intake.
 * Accepts either `{ rules: [...] }` or a bare array.
 */
export function parseRulesConfig(input: unknown): Rule[] {
  const source = isRecord(input) && Array.isArray(input.rules) ? input.rules : input;
  if (!Array.isArray(source)) return [];

  const rules: Rule[] = [];
  for (const raw of source) {
    if (!isRecord(raw)) continue;
    const id = optionalString(raw.id);
    if (id === undefined || !Array.isArray(raw.conditions) || !Array.isArray(raw.actions)) continue;

    const conditions = raw.conditions
      .map(parseCondition)
      .filter((condition): condition is RuleCondition => condition !== null);
    const actions = raw.actions
      .map(parseAction)
      .filter((action): action is RuleAction => action !== null);
    if (conditions.length === 0 || actions.length === 0) continue;

    const priority = typeof raw.priority === "number" && Number.isFinite(raw.priority) ? raw.priority : 100;
    const confidence = typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
      ? clamp(raw.confidence, 0, 1)
      : undefined;

    rules.push({
      id,
      ...(optionalString(raw.name) ? { name: optionalString(raw.name) } : {}),
      priority,
      ...(raw.enabled === false ? { enabled: false as const } : {}),
      ...(raw.match === "any" ? { match: "any" as const } : {}),
      conditions,
      actions,
      ...(confidence !== undefined ? { confidence } : {}),
    });
  }
  return rules;
}
