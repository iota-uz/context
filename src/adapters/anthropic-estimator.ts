/**
 * AnthropicTokenEstimator: Exact token counting via Anthropic API.
 *
 * Uses client.messages.countTokens() for exact counts.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ContextBlock } from '../types/block.js';
import type { TokenEstimator, TokenEstimate } from './token-estimator.js';
import {
  heuristicTokenCount,
  serializeBlockForEstimation,
} from './token-estimator.js';

/**
 * AnthropicTokenEstimator using API-based exact counting.
 */
export class AnthropicTokenEstimator implements TokenEstimator {
  private readonly client: Anthropic;
  private readonly model: string;

  /**
   * Create an AnthropicTokenEstimator.
   *
   * @param client - Anthropic SDK client
   * @param model - Model name (e.g., 'claude-sonnet-4-5')
   */
  constructor(client: Anthropic, model: string = 'claude-sonnet-4-5') {
    this.client = client;
    this.model = model;
  }

  /**
   * Estimate tokens for a single block using Anthropic API.
   *
   * @param block - Block to estimate
   * @returns Token estimate (exact confidence)
   */
  async estimateBlock(block: ContextBlock<unknown>): Promise<TokenEstimate> {
    try {
      // Serialize block to text
      const text = serializeBlockForEstimation(block);

      // Use Anthropic API for exact count
      const result = await this.client.messages.countTokens({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: text,
          },
        ],
      });

      return {
        tokens: result.input_tokens,
        confidence: 'exact',
      };
    } catch (error) {
      // Fallback to heuristic on API error
      console.warn(
        '[AnthropicTokenEstimator] API error, falling back to heuristic:',
        error
      );
      const text = serializeBlockForEstimation(block);
      return {
        tokens: heuristicTokenCount(text),
        confidence: 'low',
      };
    }
  }

  /**
   * Estimate tokens for multiple blocks.
   * Batches API calls for efficiency.
   *
   * @param blocks - Blocks to estimate
   * @returns Token estimate (exact confidence if all succeed)
   */
  async estimate(blocks: ContextBlock<unknown>[]): Promise<TokenEstimate> {
    if (blocks.length === 0) {
      return { tokens: 0, confidence: 'exact' };
    }

    try {
      // Concatenate all block texts
      const combinedText = blocks
        .map((block) => serializeBlockForEstimation(block))
        .join('\n\n');

      // Single API call for all blocks
      const result = await this.client.messages.countTokens({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: combinedText,
          },
        ],
      });

      return {
        tokens: result.input_tokens,
        confidence: 'exact',
      };
    } catch (error) {
      // Fallback: sum individual heuristic estimates
      console.warn(
        '[AnthropicTokenEstimator] API error, falling back to heuristic:',
        error
      );

      let totalTokens = 0;
      for (const block of blocks) {
        const text = serializeBlockForEstimation(block);
        totalTokens += heuristicTokenCount(text);
      }

      return {
        tokens: totalTokens,
        confidence: 'low',
      };
    }
  }
}
