/**
 * User turn codec (kind: 'turn').
 *
 * Represents a user's conversational turn/message to the assistant.
 */

import { z } from 'zod';
import type { BlockCodec, RenderedContent } from '../types/codec.js';
import type { ContextBlock } from '../types/block.js';
import { defaultHash, sortObjectKeys } from './base.js';

/**
 * User turn payload schema.
 */
export const UserTurnPayloadSchema = z.object({
  /** User message text */
  text: z.string(),
});

export type UserTurnPayload = z.infer<typeof UserTurnPayloadSchema>;

/**
 * User turn codec implementation.
 */
export const UserTurnCodec: BlockCodec<UserTurnPayload> = {
  codecId: 'user-turn',
  version: '1.0.0',
  payloadSchema: UserTurnPayloadSchema,

  canonicalize(payload: UserTurnPayload): unknown {
    // Normalize whitespace
    return sortObjectKeys({
      text: payload.text.trim(),
    });
  },

  hash(canonicalized: unknown): string {
    return defaultHash(canonicalized);
  },

  render(block: ContextBlock<UserTurnPayload>): RenderedContent {
    const { text } = block.payload;

    return {
      // Anthropic: user message
      anthropic: {
        role: 'user',
        content: text,
      },

      // OpenAI: user message
      openai: {
        role: 'user',
        content: text,
      },

      // Gemini: user message with parts array
      gemini: {
        role: 'user',
        parts: [{ text }],
      },
    };
  },

  validate(payload: unknown): UserTurnPayload {
    return UserTurnPayloadSchema.parse(payload);
  },
};
