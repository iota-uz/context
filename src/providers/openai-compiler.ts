/**
 * OpenAI compiler: Pure compilation to OpenAI chat completion format.
 *
 * Features:
 * - Inline system messages
 * - Tool/function calling support
 * - Structured outputs
 */

import type { ContextBlock } from '../types/block.js';
import type { ContextPolicy } from '../types/policy.js';
import type { OpenAICompiledContext } from '../types/compiled.js';
import type { BlockCodec } from '../types/codec.js';
import { getProviderCapabilities } from './capabilities.js';

/**
 * OpenAI compilation options.
 */
export interface OpenAICompilationOptions {
  /** Codec registry for rendering */
  codecRegistry: Map<string, BlockCodec<unknown>>;

  /** Include tool definitions (optional) */
  tools?: unknown[];
}

/**
 * Compile context to OpenAI chat completion format.
 * Pure function: same inputs → identical outputs.
 *
 * @param blocks - Ordered blocks from ContextView
 * @param policy - Context policy
 * @param options - Compilation options
 * @returns OpenAI compiled context
 */
export function compileOpenAIContext(
  blocks: ContextBlock[],
  policy: ContextPolicy,
  options: OpenAICompilationOptions
): OpenAICompiledContext {
  const capabilities = getProviderCapabilities('openai');

  // Compile all blocks to messages (including system messages inline)
  const messages = compileMessages(blocks, options.codecRegistry);

  // Calculate tokens (simplified - would use actual estimator in production)
  const estimatedTokens = blocks.length * 100; // Placeholder

  return {
    provider: 'openai',
    modelId: policy.modelId,
    messages,
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
 * Compile blocks to OpenAI messages.
 * System messages are inlined as first messages.
 *
 * @param blocks - Context blocks
 * @param codecRegistry - Codec registry
 * @returns OpenAI messages
 */
function compileMessages(
  blocks: ContextBlock[],
  codecRegistry: Map<string, BlockCodec<unknown>>
): Array<{
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: unknown;
  name?: string;
  tool_call_id?: string;
}> {
  const messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: unknown;
    name?: string;
    tool_call_id?: string;
  }> = [];

  // Compile blocks in order
  for (const block of blocks) {
    const codec = codecRegistry.get(block.meta.codecId);

    if (!codec) {
      console.warn(`[OpenAI] Codec not found: ${block.meta.codecId}`);
      continue;
    }

    const rendered = codec.render(block);
    const openaiContent = rendered.openai as any;

    // Handle different block kinds
    if (block.meta.kind === 'pinned') {
      // System messages
      messages.push({
        role: 'system',
        content: openaiContent.content || openaiContent,
      });
    } else if (block.meta.kind === 'history') {
      // History blocks are already in message format
      if (Array.isArray(openaiContent)) {
        messages.push(...openaiContent);
      } else {
        messages.push(openaiContent);
      }
    } else if (block.meta.kind === 'turn') {
      // Turn blocks are user messages
      messages.push({
        role: 'user',
        content: openaiContent.content || openaiContent,
      });
    } else if (block.meta.kind === 'tool_output') {
      // Tool output blocks
      messages.push({
        role: 'tool',
        content: typeof openaiContent === 'string'
          ? openaiContent
          : JSON.stringify(openaiContent),
        tool_call_id: (block.payload as any).toolCallId || 'unknown',
      });
    } else {
      // Other blocks (reference, memory, state) as user messages
      messages.push({
        role: 'user',
        content: typeof openaiContent === 'string'
          ? openaiContent
          : JSON.stringify(openaiContent),
      });
    }
  }

  return messages;
}

/**
 * Validate OpenAI message sequence.
 * Ensures messages follow OpenAI's alternation rules.
 *
 * @param messages - OpenAI messages
 * @returns Validation diagnostics
 */
export function validateOpenAIMessages(
  messages: Array<{ role: string; content: unknown }>
): Array<{ level: 'error' | 'warning'; message: string }> {
  const diagnostics: Array<{ level: 'error' | 'warning'; message: string }> = [];

  // Check for empty messages
  if (messages.length === 0) {
    diagnostics.push({
      level: 'error',
      message: 'Message array is empty',
    });
    return diagnostics;
  }

  // Check for user-assistant alternation
  let lastRole: string | null = null;
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === 'user' && lastRole === 'user') {
      diagnostics.push({
        level: 'warning',
        message: `Consecutive user messages at index ${i}`,
      });
    }

    if (msg.role === 'assistant' && lastRole === 'assistant') {
      diagnostics.push({
        level: 'warning',
        message: `Consecutive assistant messages at index ${i}`,
      });
    }

    lastRole = msg.role;
  }

  return diagnostics;
}
