import type {
  Contact,
  Conversation,
  ConversationStatus,
  InboundMessage,
  KnowledgeArticle,
  Message,
  Store,
} from "@/lib/types";
import {
  callLlm,
  readEnv,
  resolveLlmConfig,
  type EnvRecord,
  type LlmConfig,
} from "./llm";
import {
  buildExtractiveReply,
  buildRagPrompt,
  extractCitedArticleIds,
  retrieveRelevantArticles,
} from "./rag";
import { defaultRules, detectLanguage, evaluateRules, getLatestInboundMessage } from "./rules";
import type { BotReply, EngineContext, RankedArticle, Rule, RuleEffect } from "./types";

const DEFAULT_FALLBACK =
  "Gracias por escribirnos. He registrado tu consulta y la revisaremos enseguida. Si es urgente, dímelo y la derivo a una persona del equipo.";

const MIN_RAG_SCORE = 0.12;

/** Patterns that mean "a human, please" in the main languages of the CRM. */
const HUMAN_REQUEST_PATTERNS: readonly RegExp[] = [
  /\b(humano|humana|agente|operador|representante|supervisor|persona|alguien)\b/i,
  /\b(hablar|pasar|derivar|poner) (con|me con|a) (una )?(persona|agente|humano|supervisor)\b/i,
  /\b(quiero|necesito) (hablar|ser atendido)\b/i,
  /\b(human|agent|representative|supervisor|speak to (a )?(person|human)|talk to (a )?person)\b/i,
  /\b(atendente|falar com (uma )?pessoa|falar com atendente)\b/i,
];

export interface GenerateReplyOptions {
  /** Overrides the built-in example rules. */
  rules?: readonly Rule[];
  /** Overrides context.articles. Only published/searchable ones are used. */
  articles?: readonly KnowledgeArticle[];
  maxArticles?: number;
  confidenceThreshold?: number;
  fallbackReply?: string;
  /** Pass null to explicitly disable the LLM, or a config to override env. */
  llmConfig?: LlmConfig | null;
  timeoutMs?: number;
  language?: string;
  /** Overrides BOT_AUTO_REPLY. */
  autoReply?: boolean;
  /** Injectable environment, useful for tests and multi-tenant setups. */
  env?: EnvRecord;
}

export interface ReplyResolution {
  reply: BotReply;
  effects: RuleEffect[];
  matchedRule?: Rule;
  rankedArticles: RankedArticle[];
  /** Whether the caller is allowed to send the reply automatically. */
  autoReplyEnabled: boolean;
}

export interface HandleInboundOptions extends GenerateReplyOptions {
  /** Name used for a newly created conversation inbox when inbound has none. */
  defaultInboxName?: string;
}

export interface HandleInboundResult {
  contact: Contact;
  conversation: Conversation;
  inboundMessage: Message;
  /** Suggested answer, whether or not it was sent automatically. */
  reply: BotReply;
  outboundMessage?: Message;
  handoffApplied: boolean;
  autoReplyEnabled: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

/** BOT_AUTO_REPLY defaults to false: the bot suggests, a human decides. */
export function isAutoReplyEnabled(options?: GenerateReplyOptions): boolean {
  const env = readEnv(options?.env);
  return options?.autoReply ?? readBoolean(env.BOT_AUTO_REPLY, false);
}

export function isHumanHandoffRequest(text: string): boolean {
  return HUMAN_REQUEST_PATTERNS.some((pattern) => pattern.test(text));
}

function conversationNeedsHandoff(context: EngineContext): boolean {
  return (
    context.conversation.labels.some((label) => label.toLowerCase() === "handoff") ||
    context.conversation.status === "pending"
  );
}

function replyFromModel(raw: string, ranked: readonly RankedArticle[]): BotReply {
  const cited = extractCitedArticleIds(raw, ranked);
  let body = raw;
  if (ranked.length > 0 && cited.length === 0) {
    // Enforce the "cite article IDs" rule even if the model forgot to do so.
    const sources = ranked.slice(0, 2).map(({ article }) => `[${article.id}] ${article.title}`);
    body = `${body}\n\nFuentes: ${sources.join(" · ")}`;
  }

  let confidence = 0.7 + (ranked.length > 0 ? 0.08 : 0) + (cited.length > 0 ? 0.08 : 0);
  if (/\b(no (tengo|dispongo|s[eé]|encuentro|cuento)|no est[aá] en|lo siento|sin informaci[oó]n)\b/i.test(body)) {
    confidence -= 0.08;
  }

  const ids = cited.length > 0 ? cited : ranked.slice(0, 2).map(({ article }) => article.id);
  return {
    body,
    confidence: clamp(confidence, 0.3, 0.95),
    source: "llm",
    ...(ids.length > 0 ? { articleIds: ids } : {}),
    shouldHandoff: false,
  };
}

/**
 * Full decision pipeline: rules -> article retrieval -> LLM -> extractive RAG -> fallback.
 * Rules and retrieval are always local; the network is only used if configured.
 */
export async function generateReplyDetailed(
  context: EngineContext,
  options: GenerateReplyOptions = {},
): Promise<ReplyResolution> {
  const env = readEnv(options.env);
  const threshold = options.confidenceThreshold ?? readNumber(env.BOT_CONFIDENCE_THRESHOLD, 0.75);
  const maxArticles = Math.max(0, options.maxArticles ?? readNumber(env.BOT_MAX_ARTICLES, 3));

  const question = getLatestInboundMessage(context.messages)?.body ?? "";
  const language = options.language ?? context.language ?? detectLanguage(question);
  const richContext: EngineContext = {
    ...context,
    language,
    channel: context.channel ?? context.conversation.channel,
  };

  const evaluation = evaluateRules(richContext, options.rules ?? defaultRules, { language });
  if (evaluation.reply) {
    const handoff =
      evaluation.reply.shouldHandoff ||
      evaluation.reply.confidence < threshold ||
      isHumanHandoffRequest(question) ||
      conversationNeedsHandoff(context);
    return {
      reply: { ...evaluation.reply, shouldHandoff: handoff },
      effects: evaluation.effects,
      ...(evaluation.matchedRule ? { matchedRule: evaluation.matchedRule } : {}),
      rankedArticles: [],
      autoReplyEnabled: isAutoReplyEnabled(options),
    };
  }

  const articles = (options.articles ?? context.articles).filter(
    (article) => article.published && article.showInSearch,
  );
  const ranked = retrieveRelevantArticles(question, articles, maxArticles);

  let configured: LlmConfig | null;
  if (options.llmConfig === null) {
    configured = null;
  } else if (options.llmConfig !== undefined) {
    configured = options.llmConfig;
  } else {
    configured = resolveLlmConfig(env);
  }
  const llmConfig =
    configured && options.timeoutMs ? { ...configured, timeoutMs: options.timeoutMs } : configured;

  let reply: BotReply | null = null;
  if (llmConfig) {
    const prompt = buildRagPrompt(richContext, ranked);
    const raw = await callLlm(prompt, llmConfig, env);
    if (raw) reply = replyFromModel(raw, ranked);
  }

  if (!reply && ranked.length > 0 && ranked[0].score >= MIN_RAG_SCORE) {
    reply = buildExtractiveReply(ranked, question);
  }

  if (!reply) {
    reply = {
      body: options.fallbackReply ?? env.BOT_FALLBACK_REPLY ?? DEFAULT_FALLBACK,
      confidence: 0.25,
      source: "fallback",
      shouldHandoff: false,
    };
  }

  const shouldHandoff =
    reply.shouldHandoff ||
    isHumanHandoffRequest(question) ||
    conversationNeedsHandoff(context) ||
    reply.confidence < threshold;

  return {
    reply: { ...reply, shouldHandoff },
    effects: [],
    rankedArticles: ranked,
    autoReplyEnabled: isAutoReplyEnabled(options),
  };
}

/** Main entry point for a suggestion. Never writes to the Store. */
export async function generateReply(
  context: EngineContext,
  options?: GenerateReplyOptions,
): Promise<BotReply> {
  const resolution = await generateReplyDetailed(context, options);
  return resolution.reply;
}

function newId(prefix: string): string {
  const webCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (webCrypto && typeof webCrypto.randomUUID === "function") {
    return `${prefix}_${webCrypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Intake helper: upserts contact/conversation/message from a normalized inbound
 * event, generates a suggestion and applies rule side effects. The suggestion
 * is only sent as an outbound message when auto-reply is enabled.
 */
export async function handleInboundMessage(
  inbound: InboundMessage,
  store: Store,
  workspaceId: string,
  options: HandleInboundOptions = {},
): Promise<HandleInboundResult> {
  const now = inbound.timestamp ?? new Date().toISOString();
  const autoReplyEnabled = isAutoReplyEnabled(options);
  const existingMessage = await store.getMessageByExternalId(inbound.externalMessageId);

  const contacts = await store.listContacts(workspaceId);
  const existingContact = contacts.find(
    (contact) => contact.externalIds?.[inbound.channel] === inbound.externalContactId,
  );
  const contactToSave: Contact = existingContact
    ? {
        ...existingContact,
        ...(inbound.contactName?.trim() ? { name: inbound.contactName.trim() } : {}),
        ...(inbound.contactEmail ? { email: inbound.contactEmail } : {}),
        ...(inbound.contactPhone ? { phone: inbound.contactPhone } : {}),
        externalIds: {
          ...existingContact.externalIds,
          [inbound.channel]: inbound.externalContactId,
        },
        updatedAt: now,
      }
    : {
        id: newId("cont"),
        workspaceId,
        name: inbound.contactName?.trim() || `Contacto ${inbound.channel}`,
        ...(inbound.contactEmail ? { email: inbound.contactEmail } : {}),
        ...(inbound.contactPhone ? { phone: inbound.contactPhone } : {}),
        externalIds: { [inbound.channel]: inbound.externalContactId },
        attributes: {},
        createdAt: now,
        updatedAt: now,
      };
  const contact = await store.upsertContact(contactToSave);

  const conversations = await store.listConversations(workspaceId);
  const candidates = conversations
    .filter(
      (conversation) =>
        conversation.contactId === contact.id &&
        conversation.channel === inbound.channel &&
        conversation.status !== "resolved",
    )
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  const existingConversation =
    candidates.find((conversation) => conversation.inboxId === inbound.inboxId) ?? candidates[0];

  const isNewConversation = existingConversation === undefined;
  const baseConversation: Conversation = existingConversation ?? {
    id: newId("conv"),
    workspaceId,
    inboxId: inbound.inboxId ?? options.defaultInboxName ?? `${workspaceId}:${inbound.channel}`,
    channel: inbound.channel,
    contactId: contact.id,
    status: "open",
    priority: "normal",
    labels: [],
    unread: true,
    lastMessageAt: now,
    createdAt: now,
    updatedAt: now,
  };

  const history = isNewConversation ? [] : await store.listMessages(baseConversation.id);
  const inboundMessageToSave: Message = existingMessage ?? {
    id: newId("msg"),
    conversationId: baseConversation.id,
    direction: "inbound",
    senderType: "contact",
    authorName: contact.name,
    body: inbound.body,
    ...(inbound.attachments ? { attachments: inbound.attachments } : {}),
    channelMessageId: inbound.externalMessageId,
    createdAt: now,
    metadata: { channel: inbound.channel },
  };
  // The current message must be visible to the engine even on a new thread.
  const contextMessages = existingMessage ? history : [...history, inboundMessageToSave];
  const context: EngineContext = {
    workspaceId,
    conversation: baseConversation,
    contact,
    messages: contextMessages,
    articles: await store.listArticles(workspaceId),
    channel: inbound.channel,
  };
  const resolution = await generateReplyDetailed(context, options);

  const labels = [...baseConversation.labels];
  for (const effect of resolution.effects) {
    if (effect.type === "addLabel" && !labels.includes(effect.label)) labels.push(effect.label);
  }
  let priority = baseConversation.priority;
  for (const effect of resolution.effects) {
    if (effect.type === "setPriority") priority = effect.priority;
  }
  const handoffApplied =
    resolution.reply.shouldHandoff ||
    resolution.effects.some((effect) => effect.type === "handoff");
  if (handoffApplied && !labels.includes("handoff")) labels.push("handoff");

  const status: ConversationStatus = handoffApplied
    ? "pending"
    : baseConversation.status === "resolved"
      ? "open"
      : baseConversation.status;

  const conversation = await store.upsertConversation({
    ...baseConversation,
    labels,
    priority,
    status,
    unread: autoReplyEnabled && !handoffApplied ? false : true,
    ...(baseConversation.subject === undefined && inbound.subject ? { subject: inbound.subject } : {}),
    lastMessageAt: now,
    updatedAt: now,
  });

  const inboundMessage = existingMessage ?? await store.addMessage({
    ...inboundMessageToSave,
    conversationId: conversation.id,
  });

  let outboundMessage: Message | undefined;
  if (autoReplyEnabled) {
    outboundMessage = await store.addMessage({
      id: newId("msg"),
      conversationId: conversation.id,
      direction: "outbound",
      senderType: "bot",
      authorName: "Bot",
      body: resolution.reply.body,
      createdAt: now,
      metadata: {
        source: resolution.reply.source,
        confidence: resolution.reply.confidence,
        articleIds: resolution.reply.articleIds ?? [],
        shouldHandoff: resolution.reply.shouldHandoff,
      },
    });
  }

  return {
    contact,
    conversation,
    inboundMessage,
    reply: resolution.reply,
    ...(outboundMessage ? { outboundMessage } : {}),
    handoffApplied,
    autoReplyEnabled,
  };
}
