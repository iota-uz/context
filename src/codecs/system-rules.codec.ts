/**
 * System rules codec (kind: 'pinned').
 *
 * System-level instructions and constraints.
 */

import { z } from 'zod';
import type { BlockCodec, RenderedContent } from '../types/codec.js';
import type { ContextBlock } from '../types/block.js';
import { defaultHash, sortObjectKeys } from './base.js';

/**
 * System rules payload schema.
 */
export const SystemRulesPayloadSchema = z.object({
  /** System rules text */
  text: z.string(),

  /** Optional priority (higher = more important) */
  priority: z.number().optional(),

  /** Optional cache control hint */
  cacheable: z.boolean().optional(),
});

export type SystemRulesPayload = z.infer<typeof SystemRulesPayloadSchema>;

/**
 * System rules codec implementation.
 */
export const SystemRulesCodec: BlockCodec<SystemRulesPayload> = {
  codecId: 'system-rules',
  version: '1.0.0',
  payloadSchema: SystemRulesPayloadSchema,

  canonicalize(payload: SystemRulesPayload): unknown {
    // Normalize whitespace and sort keys
    return sortObjectKeys({
      text: payload.text.trim(),
      priority: payload.priority ?? 0,
      cacheable: payload.cacheable ?? false,
    });
  },

  hash(canonicalized: unknown): string {
    return defaultHash(canonicalized);
  },

  render(block: ContextBlock<SystemRulesPayload>): RenderedContent {
    const { text, cacheable } = block.payload;

    return {
      // Anthropic: system message with optional cache control
      anthropic: {
        type: 'text',
        text,
        ...(cacheable && { cache_control: { type: 'ephemeral' } }),
      },

      // OpenAI: system message
      openai: {
        role: 'system',
        content: text,
      },

      // Gemini: system instruction (string)
      gemini: text,
    };
  },

  validate(payload: unknown): SystemRulesPayload {
    return SystemRulesPayloadSchema.parse(payload);
  },
};
