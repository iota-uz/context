/**
 * Tool schema codec (kind: 'reference').
 *
 * Tool definitions for function calling.
 */

import { z } from 'zod';
import type { BlockCodec, RenderedContent } from '../types/codec.js';
import type { ContextBlock } from '../types/block.js';
import { defaultHash, sortObjectKeys } from './base.js';

/**
 * Tool schema payload schema (JSON Schema-like).
 */
export const ToolSchemaPayloadSchema = z.object({
  /** Tool name */
  name: z.string(),

  /** Tool description */
  description: z.string(),

  /** Input schema (JSON Schema) */
  inputSchema: z.record(z.unknown()),

  /** Optional cache control hint */
  cacheable: z.boolean().optional(),
});

export type ToolSchemaPayload = z.infer<typeof ToolSchemaPayloadSchema>;

/**
 * Tool schema codec implementation.
 */
export const ToolSchemaCodec: BlockCodec<ToolSchemaPayload> = {
  codecId: 'tool-schema',
  version: '1.0.0',
  payloadSchema: ToolSchemaPayloadSchema,

  canonicalize(payload: ToolSchemaPayload): unknown {
    // Sort keys for deterministic hashing
    return sortObjectKeys({
      name: payload.name,
      description: payload.description.trim(),
      inputSchema: sortObjectKeys(payload.inputSchema as Record<string, unknown>),
      cacheable: payload.cacheable ?? false,
    });
  },

  hash(canonicalized: unknown): string {
    return defaultHash(canonicalized);
  },

  render(block: ContextBlock<ToolSchemaPayload>): RenderedContent {
    const { name, description, inputSchema, cacheable } = block.payload;

    return {
      // Anthropic: tool definition
      anthropic: {
        name,
        description,
        input_schema: inputSchema,
        ...(cacheable && { cache_control: { type: 'ephemeral' } }),
      },

      // OpenAI: function definition
      openai: {
        type: 'function',
        function: {
          name,
          description,
          parameters: inputSchema,
        },
      },

      // Gemini: function declaration
      gemini: {
        name,
        description,
        parameters: inputSchema,
      },
    };
  },

  validate(payload: unknown): ToolSchemaPayload {
    return ToolSchemaPayloadSchema.parse(payload);
  },
};
