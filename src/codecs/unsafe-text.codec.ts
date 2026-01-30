/**
 * Unsafe text codec (any kind).
 *
 * Raw text passthrough without validation. Use with caution.
 */

import { z } from 'zod';
import type { BlockCodec, RenderedContent } from '../types/codec.js';
import type { ContextBlock } from '../types/block.js';
import { defaultHash } from './base.js';

/**
 * Unsafe text payload schema.
 */
export const UnsafeTextPayloadSchema = z.object({
  /** Raw text content */
  text: z.string(),

  /** Optional role override (user, assistant, system) */
  role: z.enum(['user', 'assistant', 'system']).optional(),
});

export type UnsafeTextPayload = z.infer<typeof UnsafeTextPayloadSchema>;

/**
 * Unsafe text codec implementation.
 */
export const UnsafeTextCodec: BlockCodec<UnsafeTextPayload> = {
  codecId: 'unsafe-text',
  version: '1.0.0',
  payloadSchema: UnsafeTextPayloadSchema,

  canonicalize(payload: UnsafeTextPayload): unknown {
    // Canonicalize: trim whitespace and normalize role
    return {
      text: payload.text.trim(),
      role: payload.role ?? 'user',
    };
  },

  hash(canonicalized: unknown): string {
    return defaultHash(canonicalized);
  },

  render(block: ContextBlock<UnsafeTextPayload>): RenderedContent {
    const { text, role = 'user' } = block.payload;

    return {
      // Anthropic: message with specified role
      anthropic: {
        role: role === 'system' ? 'user' : role,
        content: role === 'system'
          ? [{ type: 'text', text }]
          : text,
      },

      // OpenAI: message with specified role
      openai: {
        role: role === 'system' ? 'system' : role,
        content: text,
      },

      // Gemini: convert role to user/model
      gemini: {
        role: role === 'assistant' ? 'model' : 'user',
        parts: [{ text }],
      },
    };
  },

  validate(payload: unknown): UnsafeTextPayload {
    return UnsafeTextPayloadSchema.parse(payload);
  },
};
