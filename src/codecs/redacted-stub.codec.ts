/**
 * Redacted stub codec (any kind).
 *
 * Placeholder for sensitive content that was removed.
 */

import { z } from 'zod';
import type { BlockCodec, RenderedContent } from '../types/codec.js';
import type { ContextBlock } from '../types/block.js';
import { defaultHash, sortObjectKeys } from './base.js';

/**
 * Redacted stub payload schema.
 */
export const RedactedStubPayloadSchema = z.object({
  /** Original block hash (for reference) */
  originalBlockHash: z.string(),

  /** Reason for redaction */
  reason: z.string(),

  /** Optional placeholder text */
  placeholder: z.string().optional(),
});

export type RedactedStubPayload = z.infer<typeof RedactedStubPayloadSchema>;

/**
 * Redacted stub codec implementation.
 */
export const RedactedStubCodec: BlockCodec<RedactedStubPayload> = {
  codecId: 'redacted-stub',
  version: '1.0.0',
  payloadSchema: RedactedStubPayloadSchema,

  canonicalize(payload: RedactedStubPayload): unknown {
    return sortObjectKeys({
      originalBlockHash: payload.originalBlockHash,
      reason: payload.reason,
      placeholder: payload.placeholder ?? '[REDACTED]',
    });
  },

  hash(canonicalized: unknown): string {
    return defaultHash(canonicalized);
  },

  render(block: ContextBlock<RedactedStubPayload>): RenderedContent {
    const { placeholder, reason } = block.payload;
    const text = `${placeholder ?? '[REDACTED]'}\n\n*Reason: ${reason}*`;

    return {
      // Anthropic: user message
      anthropic: {
        role: 'user',
        content: [{ type: 'text', text }],
      },

      // OpenAI: user message
      openai: {
        role: 'user',
        content: text,
      },

      // Gemini: user message
      gemini: {
        role: 'user',
        parts: [{ text }],
      },
    };
  },

  validate(payload: unknown): RedactedStubPayload {
    return RedactedStubPayloadSchema.parse(payload);
  },
};
