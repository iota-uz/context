/**
 * Summarizer implementations for history compaction.
 *
 * Uses LLM to condense old conversation history into compact summaries.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ContextBlock } from '../types/block.js';
import type { HistorySummarizer } from './compactor.js';
import { computeBlockHash } from '../types/hash.js';

/**
 * Anthropic-based history summarizer.
 * Uses Claude Haiku for cost-effective summarization.
 */
export class AnthropicSummarizer implements HistorySummarizer {
  constructor(private anthropicClient: Anthropic) {}

  async summarize(blocks: ContextBlock[], targetTokens: number): Promise<ContextBlock> {
    // Render blocks to text (simplified - just stringify payload)
    const messages = blocks.map((block) => {
      const payload = block.payload as any;
      if (payload.messages && Array.isArray(payload.messages)) {
        return payload.messages
          .map((m: any) => `${m.role}: ${JSON.stringify(m.content)}`)
          .join('\n');
      }
      return JSON.stringify(payload);
    });

    const text = messages.join('\n\n');

    // Call Anthropic with summarization prompt
    const response = await this.anthropicClient.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: targetTokens,
      messages: [
        {
          role: 'user',
          content: `Summarize the following conversation history concisely, preserving key context and decisions:\n\n${text}`,
        },
      ],
    });

    const summary =
      response.content[0].type === 'text' ? response.content[0].text : '';

    // Create summary block with provenance
    const summaryPayload = {
      summary,
      originalBlockCount: blocks.length,
      summarizedAt: Date.now(),
    };

    const firstBlock = blocks[0];
    const blockHash = computeBlockHash(
      {
        ...firstBlock.meta,
        source: `${firstBlock.meta.source ?? 'unknown'}:summarized`,
      },
      summaryPayload
    );

    return {
      blockHash,
      meta: {
        ...firstBlock.meta,
        kind: 'history',
        source: `${firstBlock.meta.source ?? 'unknown'}:summarized`,
        tags: [...(firstBlock.meta.tags ?? []), 'summarized'],
        createdAt: Date.now(),
      },
      payload: summaryPayload,
    };
  }
}
