/**
 * OpenAITokenEstimator: High-confidence token counting via tiktoken.
 *
 * Uses tiktoken library for accurate token counts.
 */

import { encoding_for_model } from 'tiktoken';
import type { TiktokenModel } from 'tiktoken';
import type { ContextBlock } from '../types/block.js';
import type { TokenEstimator, TokenEstimate } from './token-estimator.js';
import {
  heuristicTokenCount,
  serializeBlockForEstimation,
} from './token-estimator.js';

/**
 * OpenAITokenEstimator using tiktoken.
 */
export class OpenAITokenEstimator implements TokenEstimator {
  private readonly model: TiktokenModel;

  /**
   * Create an OpenAITokenEstimator.
   *
   * @param model - Model name (e.g., 'gpt-4', 'gpt-3.5-turbo')
   */
  constructor(model: TiktokenModel = 'gpt-4') {
    this.model = model;
  }

  /**
   * Estimate tokens for a single block using tiktoken.
   *
   * @param block - Block to estimate
   * @returns Token estimate (high confidence)
   */
  async estimateBlock(block: ContextBlock<unknown>): Promise<TokenEstimate> {
    try {
      const text = serializeBlockForEstimation(block);
      const encoding = encoding_for_model(this.model);
      const tokens = encoding.encode(text);
      encoding.free(); // Important: free memory

      return {
        tokens: tokens.length,
        confidence: 'high',
      };
    } catch (error) {
      // Fallback to heuristic on error
      console.warn(
        '[OpenAITokenEstimator] tiktoken error, falling back to heuristic:',
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
   *
   * @param blocks - Blocks to estimate
   * @returns Token estimate (high confidence if all succeed)
   */
  async estimate(blocks: ContextBlock<unknown>[]): Promise<TokenEstimate> {
    if (blocks.length === 0) {
      return { tokens: 0, confidence: 'high' };
    }

    try {
      const combinedText = blocks
        .map((block) => serializeBlockForEstimation(block))
        .join('\n\n');

      const encoding = encoding_for_model(this.model);
      const tokens = encoding.encode(combinedText);
      encoding.free(); // Important: free memory

      return {
        tokens: tokens.length,
        confidence: 'high',
      };
    } catch (error) {
      // Fallback: sum individual heuristic estimates
      console.warn(
        '[OpenAITokenEstimator] tiktoken error, falling back to heuristic:',
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
