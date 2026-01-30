/**
 * Compiled context types for LLM provider consumption.
 */

import type { ContextBlock } from './block.js';
import type { Provider } from './policy.js';
import type { ResolvedAttachment } from './attachment.js';

/**
 * Compiled context for a specific provider.
 */
export interface CompiledContext {
  /** Target provider */
  provider: Provider;

  /** Model identifier */
  modelId: string;

  /** Provider-specific messages array */
  messages: unknown[];

  /** Provider-specific system message(s) */
  system?: unknown;

  /** Resolved attachments (if any) */
  attachments?: ResolvedAttachment[];

  /** Total estimated tokens */
  estimatedTokens: number;

  /** Blocks included in compilation */
  blocks: ContextBlock[];

  /** Blocks excluded (overflow, sensitivity, etc.) */
  excludedBlocks?: ContextBlock[];

  /** Compilation metadata */
  meta: CompiledContextMeta;
}

/**
 * Compilation metadata.
 */
export interface CompiledContextMeta {
  /** Compilation timestamp (Unix seconds) */
  compiledAt: number;

  /** Context window size */
  contextWindow: number;

  /** Completion reserve (tokens) */
  completionReserve: number;

  /** Available tokens (contextWindow - completionReserve) */
  availableTokens: number;

  /** Overflow occurred */
  overflowed: boolean;

  /** Compaction applied */
  compacted: boolean;

  /** Truncation applied */
  truncated: boolean;

  /** Token breakdown by block kind */
  tokensByKind: Record<string, number>;
}

/**
 * Anthropic-specific compiled context.
 */
export interface AnthropicCompiledContext extends CompiledContext {
  provider: 'anthropic';
  messages: Array<{
    role: 'user' | 'assistant';
    content: unknown;
  }>;
  system?: Array<{
    type: 'text';
    text: string;
    cache_control?: { type: 'ephemeral' };
  }>;
}

/**
 * OpenAI-specific compiled context.
 */
export interface OpenAICompiledContext extends CompiledContext {
  provider: 'openai';
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: unknown;
    name?: string;
    tool_call_id?: string;
  }>;
}

/**
 * Gemini-specific compiled context.
 */
export interface GeminiCompiledContext extends CompiledContext {
  provider: 'gemini';
  messages: Array<{
    role: 'user' | 'model';
    parts: unknown[];
  }>;
  system?: string;
}
