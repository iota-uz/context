/**
 * Default context policy for general-purpose LLM conversations.
 *
 * This policy provides sensible defaults for:
 * - Token budget: 180K context window with 8K completion reserve
 * - Caching: Provider-native caching with breakpoints for pinned/reference content
 * - Compaction: Tool output pruning + history summarization
 * - Attachments: 10K token budget with purpose-based selection
 * - Sensitivity: Public content only with redaction for restricted content
 */

import type { ContextPolicy } from '../types/policy.js';
import {
  DEFAULT_KIND_PRIORITIES,
  DEFAULT_COMPACTION_CONFIG,
  DEFAULT_SENSITIVITY_CONFIG,
  DEFAULT_ATTACHMENT_POLICY,
} from '../types/policy.js';

/**
 * Default context policy configuration.
 *
 * Use this as a starting point for most conversational workflows.
 * Override specific properties as needed for your use case.
 *
 * @example
 * ```typescript
 * import { DEFAULT_POLICY, ContextBuilder } from '@foundry/context';
 *
 * const builder = new ContextBuilder({
 *   ...DEFAULT_POLICY,
 *   contextWindow: 200_000, // Override for larger context
 * });
 * ```
 */
export const DEFAULT_POLICY: ContextPolicy = {
  // Provider configuration
  provider: 'anthropic',
  modelId: 'claude-sonnet-4-5',

  // Token budget
  contextWindow: 180_000,
  completionReserve: 8_000,

  // Overflow handling
  overflowStrategy: 'compact',

  // Block priorities
  kindPriorities: DEFAULT_KIND_PRIORITIES,

  // Compaction configuration
  compaction: {
    ...DEFAULT_COMPACTION_CONFIG,
    // Tool output pruning
    pruneToolOutputs: true,
    maxToolOutputAge: 3600, // 1 hour
    maxToolOutputsPerKind: 10,

    // History summarization
    summarizeHistory: true,
    maxHistoryMessages: 20,
  },

  // Sensitivity filtering
  sensitivity: DEFAULT_SENSITIVITY_CONFIG,

  // Attachment selection
  attachments: DEFAULT_ATTACHMENT_POLICY,
};
