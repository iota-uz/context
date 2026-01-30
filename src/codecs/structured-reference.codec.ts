/**
 * Structured reference codec (kind: 'reference').
 *
 * External documentation, code snippets, API responses.
 */

import { z } from 'zod';
import type { BlockCodec, RenderedContent } from '../types/codec.js';
import type { ContextBlock } from '../types/block.js';
import { defaultHash, sortObjectKeys } from './base.js';

/**
 * Structured reference payload schema.
 */
export const StructuredReferencePayloadSchema = z.object({
  /** Reference title */
  title: z.string(),

  /** Reference content (markdown, code, JSON, etc.) */
  content: z.string(),

  /** Optional source URL */
  sourceUrl: z.string().optional(),

  /** Optional MIME type */
  mimeType: z.string().optional(),

  /** Optional cache control hint */
  cacheable: z.boolean().optional(),
});

export type StructuredReferencePayload = z.infer<typeof StructuredReferencePayloadSchema>;

/**
 * Structured reference codec implementation.
 */
export const StructuredReferenceCodec: BlockCodec<StructuredReferencePayload> = {
  codecId: 'structured-reference',
  version: '1.0.0',
  payloadSchema: StructuredReferencePayloadSchema,

  canonicalize(payload: StructuredReferencePayload): unknown {
    return sortObjectKeys({
      title: payload.title.trim(),
      content: payload.content,
      sourceUrl: payload.sourceUrl ?? null,
      mimeType: payload.mimeType ?? null,
      cacheable: payload.cacheable ?? false,
    });
  },

  hash(canonicalized: unknown): string {
    return defaultHash(canonicalized);
  },

  render(block: ContextBlock<StructuredReferencePayload>): RenderedContent {
    const { title, content, sourceUrl, cacheable } = block.payload;

    // Format as markdown with optional source
    const formattedContent = [
      `# ${title}`,
      sourceUrl ? `\n*Source: ${sourceUrl}*\n` : '',
      content,
    ].join('\n');

    return {
      // Anthropic: user message with optional cache control
      anthropic: {
        role: 'user',
        content: [
          {
            type: 'text',
            text: formattedContent,
            ...(cacheable && { cache_control: { type: 'ephemeral' } }),
          },
        ],
      },

      // OpenAI: user message
      openai: {
        role: 'user',
        content: formattedContent,
      },

      // Gemini: user message
      gemini: {
        role: 'user',
        parts: [{ text: formattedContent }],
      },
    };
  },

  validate(payload: unknown): StructuredReferencePayload {
    return StructuredReferencePayloadSchema.parse(payload);
  },
};
