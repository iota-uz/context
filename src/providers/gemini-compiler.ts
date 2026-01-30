/**
 * Gemini compiler: Pure compilation to Gemini content format.
 *
 * Features:
 * - Separate system instruction
 * - User/model role mapping
 * - Parts-based content structure
 * - Caching support (for large contexts)
 */

import type { ContextBlock } from '../types/block.js';
import type { ContextPolicy } from '../types/policy.js';
import type { GeminiCompiledContext } from '../types/compiled.js';
import type { BlockCodec } from '../types/codec.js';
import { getProviderCapabilities } from './capabilities.js';

/**
 * Gemini compilation options.
 */
export interface GeminiCompilationOptions {
  /** Codec registry for rendering */
  codecRegistry: Map<string, BlockCodec<unknown>>;

  /** Cache configuration (optional) */
  caching?: {
    /** Enable caching for large contexts */
    enabled: boolean;

    /** Minimum tokens for caching */
    minTokens: number;
  };
}

/**
 * Compile context to Gemini content format.
 * Pure function: same inputs → identical outputs.
 *
 * @param blocks - Ordered blocks from ContextView
 * @param policy - Context policy
 * @param options - Compilation options
 * @returns Gemini compiled context
 */
export function compileGeminiContext(
  blocks: ContextBlock[],
  policy: ContextPolicy,
  options: GeminiCompilationOptions
): GeminiCompiledContext {
  const capabilities = getProviderCapabilities('gemini');

  // Separate system blocks from message blocks
  const systemBlocks = blocks.filter((b) => b.meta.kind === 'pinned');
  const messageBlocks = blocks.filter((b) => b.meta.kind !== 'pinned');

  // Compile system instruction
  const systemInstruction = compileSystemInstruction(systemBlocks, options.codecRegistry);

  // Compile message blocks
  const messages = compileMessages(messageBlocks, options.codecRegistry);

  // Calculate tokens (simplified - would use actual estimator in production)
  const estimatedTokens = blocks.length * 100; // Placeholder

  return {
    provider: 'gemini',
    modelId: policy.modelId,
    messages,
    system: systemInstruction,
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
 * Compile system instruction from system blocks.
 * Gemini uses a single string for system instruction.
 *
 * @param blocks - System blocks
 * @param codecRegistry - Codec registry
 * @returns System instruction string (or undefined)
 */
function compileSystemInstruction(
  blocks: ContextBlock[],
  codecRegistry: Map<string, BlockCodec<unknown>>
): string | undefined {
  if (blocks.length === 0) {
    return undefined;
  }

  const parts: string[] = [];

  for (const block of blocks) {
    const codec = codecRegistry.get(block.meta.codecId);

    if (!codec) {
      console.warn(`[Gemini] Codec not found: ${block.meta.codecId}`);
      continue;
    }

    const rendered = codec.render(block);
    const geminiContent = rendered.gemini;

    // Extract text from rendered content
    if (typeof geminiContent === 'string') {
      parts.push(geminiContent);
    } else {
      parts.push(JSON.stringify(geminiContent));
    }
  }

  return parts.join('\n\n');
}

/**
 * Compile blocks to Gemini messages.
 * Gemini uses user/model roles and parts-based content.
 *
 * @param blocks - Message blocks
 * @param codecRegistry - Codec registry
 * @returns Gemini messages
 */
function compileMessages(
  blocks: ContextBlock[],
  codecRegistry: Map<string, BlockCodec<unknown>>
): Array<{
  role: 'user' | 'model';
  parts: unknown[];
}> {
  const messages: Array<{
    role: 'user' | 'model';
    parts: unknown[];
  }> = [];

  for (const block of blocks) {
    const codec = codecRegistry.get(block.meta.codecId);

    if (!codec) {
      console.warn(`[Gemini] Codec not found: ${block.meta.codecId}`);
      continue;
    }

    const rendered = codec.render(block);
    const geminiContent = rendered.gemini as any;

    // Handle different block kinds
    if (block.meta.kind === 'history') {
      // History blocks are already in message format
      if (Array.isArray(geminiContent)) {
        messages.push(...geminiContent);
      } else {
        messages.push(geminiContent);
      }
    } else if (block.meta.kind === 'turn') {
      // Turn blocks are user messages
      messages.push({
        role: 'user',
        parts: geminiContent.parts || [{ text: geminiContent }],
      });
    } else {
      // Other blocks (reference, memory, state, tool_output) as user messages
      const textContent = typeof geminiContent === 'string'
        ? geminiContent
        : JSON.stringify(geminiContent);

      messages.push({
        role: 'user',
        parts: [{ text: textContent }],
      });
    }
  }

  // Ensure alternating user/model roles (required by Gemini)
  return enforceAlternatingRoles(messages);
}

/**
 * Enforce alternating user/model roles.
 * Gemini requires strict alternation between user and model messages.
 *
 * @param messages - Input messages
 * @returns Messages with enforced alternation
 */
function enforceAlternatingRoles(
  messages: Array<{ role: 'user' | 'model'; parts: unknown[] }>
): Array<{ role: 'user' | 'model'; parts: unknown[] }> {
  const result: Array<{ role: 'user' | 'model'; parts: unknown[] }> = [];

  let currentRole: 'user' | 'model' | null = null;
  let currentParts: unknown[] = [];

  for (const msg of messages) {
    if (msg.role === currentRole) {
      // Same role - merge parts
      currentParts.push(...msg.parts);
    } else {
      // Different role - flush current message
      if (currentRole !== null && currentParts.length > 0) {
        result.push({ role: currentRole, parts: currentParts });
      }

      // Start new message
      currentRole = msg.role;
      currentParts = [...msg.parts];
    }
  }

  // Flush final message
  if (currentRole !== null && currentParts.length > 0) {
    result.push({ role: currentRole, parts: currentParts });
  }

  return result;
}

/**
 * Validate Gemini message sequence.
 *
 * @param messages - Gemini messages
 * @returns Validation diagnostics
 */
export function validateGeminiMessages(
  messages: Array<{ role: 'user' | 'model'; parts: unknown[] }>
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

  // Check for strict alternation
  let lastRole: 'user' | 'model' | null = null;
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === lastRole) {
      diagnostics.push({
        level: 'error',
        message: `Consecutive ${msg.role} messages at index ${i} (Gemini requires strict alternation)`,
      });
    }

    lastRole = msg.role;
  }

  // Check for empty parts
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.parts.length === 0) {
      diagnostics.push({
        level: 'error',
        message: `Empty parts array at index ${i}`,
      });
    }
  }

  return diagnostics;
}
