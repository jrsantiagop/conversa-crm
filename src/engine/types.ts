import type {
  ChannelType,
  Contact,
  Conversation,
  KnowledgeArticle,
  Message,
  Priority,
} from "@/lib/types";

/** Where a generated answer came from. Useful for UI badges and auditing. */
export type BotReplySource = "rule" | "rag" | "llm" | "fallback";

/** The single result shape returned by the conversational engine. */
export interface BotReply {
  body: string;
  /** 0..1. See docs/CONVERSATIONAL_ENGINE.md for the scoring model. */
  confidence: number;
  source: BotReplySource;
  /** IDs of the knowledge articles used, when any. */
  articleIds?: string[];
  /** True when a human should take over the conversation. */
  shouldHandoff: boolean;
}

/** Text-matching conditions. Values are plain JSON so rules can be stored in DB. */
export interface TextRuleCondition {
  type: "contains" | "equals" | "startsWith";
  /** Defaults to "message" (the latest inbound message body). */
  field?: "message" | "subject" | "contactName";
  value: string;
  caseSensitive?: boolean;
  /** Inverts the condition result. */
  negate?: boolean;
}

export interface RegexRuleCondition {
  type: "regex";
  field?: "message" | "subject" | "contactName";
  pattern: string;
  flags?: string;
  negate?: boolean;
}

export interface ChannelRuleCondition {
  type: "channel";
  value: ChannelType | ChannelType[];
  negate?: boolean;
}

export interface LanguageRuleCondition {
  type: "language";
  /** ISO-ish codes returned by detectLanguage: es, en, pt, fr, it, de. */
  value: string | string[];
  negate?: boolean;
}

export type RuleCondition =
  | TextRuleCondition
  | RegexRuleCondition
  | ChannelRuleCondition
  | LanguageRuleCondition;

/** Side effects a rule can request. The engine never mutates the Store itself. */
export type RuleEffect =
  | { type: "addLabel"; label: string }
  | { type: "setPriority"; priority: Priority }
  | { type: "handoff" };

export type RuleAction = RuleEffect | { type: "reply"; body: string };

/**
 * A deterministic rule. Lower `priority` values are evaluated first.
 * All fields are JSON-serializable; no functions, no RegExp instances.
 */
export interface Rule {
  id: string;
  name?: string;
  priority: number;
  enabled?: boolean;
  /** How conditions are combined. Defaults to "all". */
  match?: "all" | "any";
  conditions: RuleCondition[];
  actions: RuleAction[];
  /** Confidence assigned to a reply produced by this rule. Defaults to 0.95. */
  confidence?: number;
}

export interface RulesConfig {
  rules: Rule[];
}

/** Everything the engine needs to decide what to answer. Read-only by contract. */
export interface EngineContext {
  workspaceId: string;
  conversation: Conversation;
  contact: Contact;
  messages: Message[];
  articles: KnowledgeArticle[];
  /** Defaults to conversation.channel. */
  channel?: ChannelType;
  /** Defaults to detectLanguage(latest inbound message). */
  language?: string;
}

/** Result of one rule evaluation pass. */
export interface RuleEvaluation {
  reply: BotReply | null;
  effects: RuleEffect[];
  matchedRule?: Rule;
}

/** An article with its lexical relevance score (0..1, higher is better). */
export interface RankedArticle {
  article: KnowledgeArticle;
  score: number;
}
