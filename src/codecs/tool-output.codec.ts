/**
 * Tool output codec (kind: 'tool_output').
 *
 * Results from tool execution.
 */

import { z } from 'zod';
import type { BlockCodec, RenderedContent } from '../types/codec.js';
import type { ContextBlock } from '../types/block.js';
import { defaultHash, sortObjectKeys } from './base.js';

/**
 * Tool output payload schema.
 */
export const ToolOutputPayloadSchema = z.object({
  /** Tool name */
  toolName: z.string(),

  /** Tool call ID (for correlation) */
  toolCallId: z.string(),

  /** Tool output (success or error) */
  output: z.union([
    z.object({
      success: z.literal(true),
      result: z.unknown(),
    }),
    z.object({
      success: z.literal(false),
      error: z.string(),
    }),
  ]),

  /** Execution duration (ms) */
  durationMs: z.number().optional(),
});

export type ToolOutputPayload = z.infer<typeof ToolOutputPayloadSchema>;

/**
 * Tool output codec implementation.
 */
export const ToolOutputCodec: BlockCodec<ToolOutputPayload> = {
  codecId: 'tool-output',
  version: '1.0.0',
  payloadSchema: ToolOutputPayloadSchema,

  canonicalize(payload: ToolOutputPayload): unknown {
    return sortObjectKeys({
      toolName: payload.toolName,
      toolCallId: payload.toolCallId,
      output: payload.output,
      // Exclude durationMs from canonicalization (not content-relevant)
    });
  },

  hash(canonicalized: unknown): string {
    return defaultHash(canonicalized);
  },

  render(block: ContextBlock<ToolOutputPayload>): RenderedContent {
    const { toolName, toolCallId, output } = block.payload;

    // Format output content
    const contentText = output.success
      ? JSON.stringify(output.result, null, 2)
      : `Error: ${output.error}`;

    return {
      // Anthropic: user message with tool_result
      anthropic: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolCallId,
            content: contentText,
            is_error: !output.success,
          },
        ],
      },

      // OpenAI: tool message
      openai: {
        role: 'tool',
        tool_call_id: toolCallId,
        name: toolName,
        content: contentText,
      },

      // Gemini: user message with function response
      gemini: {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: toolName,
              response: output.success ? output.result : { error: output.error },
            },
          },
        ],
      },
    };
  },

  validate(payload: unknown): ToolOutputPayload {
    return ToolOutputPayloadSchema.parse(payload);
  },
};
