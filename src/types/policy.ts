/**
 * Context policy configuration for token budgeting and overflow handling.
 */

import type { BlockKind, SensitivityLevel } from './block.js';

/**
 * LLM provider type.
 */
export type Provider = 'anthropic' | 'openai' | 'gemini';

/**
 * Model reference for LLM configuration.
 */
export interface ModelRef {
  /** LLM provider */
  provider: Provider;

  /** Model identifier (provider-specific) */
  model: string;
}

/**
 * Token budget overflow strategy.
 */
export type OverflowStrategy =
  | 'error'         // Throw error on overflow
  | 'truncate'      // Remove blocks from end until fits
  | 'compact';      // Run compaction (remove old tool outputs, etc.)

/**
 * Block kind priority configuration.
 */
export interface KindPriority {
  /** Block kind */
  kind: BlockKind;

  /** Minimum token reservation (guaranteed) */
  minTokens: number;

  /** Maximum token allocation (soft limit) */
  maxTokens: number;

  /** Can be truncated on overflow */
  truncatable: boolean;
}

/**
 * Compaction configuration.
 */
export interface CompactionConfig {
  /** Enable tool output pruning */
  pruneToolOutputs: boolean;

  /** Maximum tool output age (seconds) to keep */
  maxToolOutputAge?: number;

  /** Maximum tool outputs per kind */
  maxToolOutputsPerKind?: number;

  /** Enable conversation history summarization */
  summarizeHistory: boolean;

  /** Maximum history messages to keep before summarization */
  maxHistoryMessages?: number;
}

/**
 * Content sensitivity filtering configuration.
 */
export interface SensitivityConfig {
  /** Maximum allowed sensitivity level */
  maxSensitivity: SensitivityLevel;

  /** Redact restricted content (vs. remove) */
  redactRestricted: boolean;
}

/**
 * Context policy configuration.
 */
export interface ContextPolicy {
  /** Target LLM provider */
  provider: Provider;

  /** Model identifier (provider-specific) */
  modelId: string;

  /** Total context window size (tokens) */
  contextWindow: number;

  /** Reserved tokens for completion (subtracted from budget) */
  completionReserve: number;

  /** Overflow handling strategy */
  overflowStrategy: OverflowStrategy;

  /** Block kind priorities */
  kindPriorities: KindPriority[];

  /** Compaction configuration (if overflowStrategy = 'compact') */
  compaction?: CompactionConfig;

  /** Sensitivity filtering configuration */
  sensitivity: SensitivityConfig;

  /** Attachment selection policy */
  attachments?: AttachmentPolicy;
}

/**
 * Default kind priorities (general-purpose).
 */
export const DEFAULT_KIND_PRIORITIES: KindPriority[] = [
  { kind: 'pinned', minTokens: 500, maxTokens: 2000, truncatable: false },
  { kind: 'reference', minTokens: 1000, maxTokens: 10000, truncatable: true },
  { kind: 'memory', minTokens: 500, maxTokens: 5000, truncatable: true },
  { kind: 'state', minTokens: 200, maxTokens: 2000, truncatable: false },
  { kind: 'tool_output', minTokens: 1000, maxTokens: 20000, truncatable: true },
  { kind: 'history', minTokens: 2000, maxTokens: 50000, truncatable: true },
  { kind: 'turn', minTokens: 500, maxTokens: 10000, truncatable: false },
];

/**
 * Default compaction configuration.
 */
export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  pruneToolOutputs: true,
  maxToolOutputAge: 3600, // 1 hour
  maxToolOutputsPerKind: 10,
  summarizeHistory: true,
  maxHistoryMessages: 20,
};

/**
 * Default sensitivity configuration (public only).
 */
export const DEFAULT_SENSITIVITY_CONFIG: SensitivityConfig = {
  maxSensitivity: 'public',
  redactRestricted: true,
};

/**
 * Attachment purpose for prioritization.
 */
export type AttachmentPurpose = 'evidence' | 'input' | 'context' | 'artifact';

/**
 * Selection strategy ranking criteria.
 */
export type RankingCriterion = 'purpose' | 'user_mention' | 'recency';

/**
 * Attachment selection strategy.
 */
export interface SelectionStrategy {
  /** Ranking criteria in priority order */
  rankBy: RankingCriterion[];

  /** Purpose priority mapping (lower = higher priority) */
  purposePriority?: Record<AttachmentPurpose, number>;
}

/**
 * Attachment policy configuration.
 */
export interface AttachmentPolicy {
  /** Maximum total tokens for all attachments */
  maxTokensTotal: number;

  /** Selection strategy */
  selectionStrategy: SelectionStrategy;
}

/**
 * Default selection strategy (purpose > user_mention > recency).
 */
export const DEFAULT_SELECTION_STRATEGY: SelectionStrategy = {
  rankBy: ['purpose', 'user_mention', 'recency'],
  purposePriority: {
    evidence: 1,
    input: 2,
    context: 3,
    artifact: 4,
  },
};

/**
 * Default attachment policy.
 */
export const DEFAULT_ATTACHMENT_POLICY: AttachmentPolicy = {
  maxTokensTotal: 10000,
  selectionStrategy: DEFAULT_SELECTION_STRATEGY,
};
