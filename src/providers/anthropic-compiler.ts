/**
 * Anthropic compiler: Pure compilation to Anthropic message format.
 *
 * Features:
 * - System messages with prompt caching
 * - Cache breakpoint resolution ("after last matching block")
 * - Diagnostics for cache configuration
 */

import type { ContextBlock } from '../types/block.js';
import type { ContextPolicy } from '../types/policy.js';
import type { CompiledContext, AnthropicCompiledContext } from '../types/compiled.js';
import type { BlockCodec } from '../types/codec.js';
import { getProviderCapabilities } from './capabilities.js';

/**
 * Cache breakpoint selector for Anthropic prompt caching.
 */
export interface CacheBreakpointSelector {
  /** Block kind to match */
  kind?: string;

  /** Codec ID to match */
  codecId?: string;

  /** Tag to match */
  tag?: string;

  /** Source to match */
  source?: string;
}

/**
 * Cache breakpoint diagnostic.
 */
export interface CacheBreakpointDiagnostic {
  /** Diagnostic level */
  level: 'error' | 'warning' | 'info';

  /** Diagnostic message */
  message: string;

  /** Matched blocks count */
  matchedBlocks?: number;

  /** Breakpoint position (if resolved) */
  position?: number;
}

/**
 * Anthropic compilation options.
 */
export interface AnthropicCompilationOptions {
  /** Cache breakpoint selector (omit = no caching) */
  cacheBreakpoint?: CacheBreakpointSelector;

  /** Codec registry for rendering */
  codecRegistry: Map<string, BlockCodec<unknown>>;
}

/**
 * Compile context to Anthropic message format.
 * Pure function: same inputs → identical outputs.
 *
 * @param blocks - Ordered blocks from ContextView
 * @param policy - Context policy
 * @param options - Compilation options
 * @returns Anthropic compiled context
 */
export function compileAnthropicContext(
  blocks: ContextBlock[],
  policy: ContextPolicy,
  options: AnthropicCompilationOptions
): AnthropicCompiledContext {
  const capabilities = getProviderCapabilities('anthropic');

  // Separate system blocks from message blocks
  const systemBlocks = blocks.filter((b) => b.meta.kind === 'pinned');
  const messageBlocks = blocks.filter((b) => b.meta.kind !== 'pinned');

  // Compile system messages
  const systemMessages = compileSystemMessages(
    systemBlocks,
    options.codecRegistry,
    options.cacheBreakpoint
  );

  // Compile message blocks
  const messages = compileMessages(messageBlocks, options.codecRegistry);

  // Calculate tokens (simplified - would use actual estimator in production)
  const estimatedTokens = blocks.length * 100; // Placeholder

  return {
    provider: 'anthropic',
    modelId: policy.modelId,
    messages,
    system: systemMessages.length > 0 ? systemMessages : undefined,
    estimatedTokens,
    blocks,
    meta: {
      compiledAt: Math.floor(Date.now() / 1000),
      contextWindow: policy.contextWindow,
      completionReserve: policy.completionReserve,
      availableTokens: policy.contextWindow - policy.completionReserve,
      overflowed: false,
      compacted: false,
      truncated: false,
      tokensByKind: {},
    },
  };
}

/**
 * Compile system messages with optional prompt caching.
 *
 * @param blocks - System blocks
 * @param codecRegistry - Codec registry
 * @param cacheBreakpoint - Cache breakpoint selector
 * @returns Anthropic system messages
 */
function compileSystemMessages(
  blocks: ContextBlock[],
  codecRegistry: Map<string, BlockCodec<unknown>>,
  cacheBreakpoint?: CacheBreakpointSelector
): Array<{
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}> {
  if (blocks.length === 0) {
    return [];
  }

  const messages: Array<{
    type: 'text';
    text: string;
    cache_control?: { type: 'ephemeral' };
  }> = [];

  // Resolve cache breakpoint position
  let cacheBreakpointPos = -1;
  const diagnostics: CacheBreakpointDiagnostic[] = [];

  if (cacheBreakpoint) {
    const result = resolveCacheBreakpoint(blocks, cacheBreakpoint);
    cacheBreakpointPos = result.position;
    diagnostics.push(...result.diagnostics);
  }

  // Compile each system block
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const codec = codecRegistry.get(block.meta.codecId);

    if (!codec) {
      console.warn(`[Anthropic] Codec not found: ${block.meta.codecId}`);
      continue;
    }

    const rendered = codec.render(block);
    const anthropicContent = rendered.anthropic as any;

    // Add cache control if this is the breakpoint
    const isCacheBreakpoint = i === cacheBreakpointPos;

    messages.push({
      type: 'text',
      text: anthropicContent.text || JSON.stringify(anthropicContent),
      ...(isCacheBreakpoint && { cache_control: { type: 'ephemeral' } }),
    });
  }

  return messages;
}

/**
 * Compile message blocks to Anthropic message format.
 *
 * @param blocks - Message blocks
 * @param codecRegistry - Codec registry
 * @returns Anthropic messages
 */
function compileMessages(
  blocks: ContextBlock[],
  codecRegistry: Map<string, BlockCodec<unknown>>
): Array<{
  role: 'user' | 'assistant';
  content: unknown;
}> {
  const messages: Array<{
    role: 'user' | 'assistant';
    content: unknown;
  }> = [];

  for (const block of blocks) {
    const codec = codecRegistry.get(block.meta.codecId);

    if (!codec) {
      console.warn(`[Anthropic] Codec not found: ${block.meta.codecId}`);
      continue;
    }

    const rendered = codec.render(block);
    const anthropicContent = rendered.anthropic as any;

    // Handle different block kinds
    if (block.meta.kind === 'history') {
      // History blocks are already in message format
      if (Array.isArray(anthropicContent)) {
        messages.push(...anthropicContent);
      }
    } else if (block.meta.kind === 'turn') {
      // Turn blocks are user messages
      messages.push({
        role: 'user',
        content: anthropicContent.content || anthropicContent,
      });
    } else {
      // Other blocks (reference, memory, state, tool_output) as user messages
      messages.push({
        role: 'user',
        content: typeof anthropicContent === 'string'
          ? anthropicContent
          : JSON.stringify(anthropicContent),
      });
    }
  }

  return messages;
}

/**
 * Resolve cache breakpoint position using "after last matching block" strategy.
 *
 * @param blocks - System blocks
 * @param selector - Cache breakpoint selector
 * @returns Resolved position and diagnostics
 */
function resolveCacheBreakpoint(
  blocks: ContextBlock[],
  selector: CacheBreakpointSelector
): {
  position: number;
  diagnostics: CacheBreakpointDiagnostic[];
} {
  const diagnostics: CacheBreakpointDiagnostic[] = [];

  // Find all matching blocks
  const matchedIndices: number[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    const matches =
      (selector.kind === undefined || block.meta.kind === selector.kind) &&
      (selector.codecId === undefined || block.meta.codecId === selector.codecId) &&
      (selector.tag === undefined || block.meta.tags?.includes(selector.tag)) &&
      (selector.source === undefined || block.meta.source === selector.source);

    if (matches) {
      matchedIndices.push(i);
    }
  }

  // Apply "after last matching block" rule
  if (matchedIndices.length === 0) {
    diagnostics.push({
      level: 'warning',
      message: 'No blocks matched cache breakpoint selector',
      matchedBlocks: 0,
    });
    return { position: -1, diagnostics };
  }

  if (matchedIndices.length > 10) {
    diagnostics.push({
      level: 'warning',
      message: `Many blocks matched (${matchedIndices.length}), using last match`,
      matchedBlocks: matchedIndices.length,
    });
  }

  const lastMatchIndex = matchedIndices[matchedIndices.length - 1];

  diagnostics.push({
    level: 'info',
    message: `Cache breakpoint resolved to block ${lastMatchIndex}`,
    matchedBlocks: matchedIndices.length,
    position: lastMatchIndex,
  });

  return { position: lastMatchIndex, diagnostics };
}
