/**
 * Conversation history codec (kind: 'history').
 *
 * Previous turns in conversation.
 */

import { z } from 'zod';
import type { BlockCodec, RenderedContent } from '../types/codec.js';
import type { ContextBlock } from '../types/block.js';
import { defaultHash, sortObjectKeys } from './base.js';

/**
 * Conversation message schema.
 */
export const ConversationMessageSchema = z.object({
  /** Message role */
  role: z.enum(['user', 'assistant']),

  /** Message content (text or structured) */
  content: z.union([
    z.string(),
    z.array(z.record(z.unknown())),
  ]),

  /** Optional message ID */
  messageId: z.string().optional(),

  /** Optional timestamp */
  timestamp: z.number().optional(),
});

export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;

/**
 * Conversation history payload schema.
 */
export const ConversationHistoryPayloadSchema = z.object({
  /** Array of messages */
  messages: z.array(ConversationMessageSchema),

  /** Optional summary of earlier messages */
  summary: z.string().optional(),
});

export type ConversationHistoryPayload = z.infer<typeof ConversationHistoryPayloadSchema>;

/**
 * Conversation history codec implementation.
 */
export const ConversationHistoryCodec: BlockCodec<ConversationHistoryPayload> = {
  codecId: 'conversation-history',
  version: '1.0.0',
  payloadSchema: ConversationHistoryPayloadSchema,

  canonicalize(payload: ConversationHistoryPayload): unknown {
    // Canonicalize messages (exclude volatile fields like timestamp)
    const canonicalMessages = payload.messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    return sortObjectKeys({
      messages: canonicalMessages,
      summary: payload.summary ?? null,
    });
  },

  hash(canonicalized: unknown): string {
    return defaultHash(canonicalized);
  },

  render(block: ContextBlock<ConversationHistoryPayload>): RenderedContent {
    const { messages, summary } = block.payload;

    // Add summary as first message if present
    const allMessages = summary
      ? [{ role: 'user' as const, content: `**Earlier conversation (summary):**\n${summary}` }, ...messages]
      : messages;

    return {
      // Anthropic: messages array
      anthropic: allMessages.map((msg) => ({
        role: msg.role,
        content: typeof msg.content === 'string'
          ? msg.content
          : msg.content,
      })),

      // OpenAI: messages array
      openai: allMessages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),

      // Gemini: convert to user/model role
      gemini: allMessages.map((msg) => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: typeof msg.content === 'string'
          ? [{ text: msg.content }]
          : msg.content,
      })),
    };
  },

  validate(payload: unknown): ConversationHistoryPayload {
    return ConversationHistoryPayloadSchema.parse(payload);
  },
};
