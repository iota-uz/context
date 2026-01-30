/**
 * GeminiTokenEstimator: High-confidence token counting via tiktoken.
 *
 * Uses tiktoken with gpt-4 encoding as a good approximation for Gemini.
 */

import { encoding_for_model } from 'tiktoken';
import type { ContextBlock } from '../types/block.js';
import type { TokenEstimator, TokenEstimate } from './token-estimator.js';
import {
  heuristicTokenCount,
  serializeBlockForEstimation,
} from './token-estimator.js';

/**
 * GeminiTokenEstimator using tiktoken (gpt-4 encoding as approximation).
 */
export class GeminiTokenEstimator implements TokenEstimator {
  /**
   * Estimate tokens for a single block using tiktoken.
   *
   * @param block - Block to estimate
   * @returns Token estimate (high confidence)
   */
  async estimateBlock(block: ContextBlock<unknown>): Promise<TokenEstimate> {
    try {
      const text = serializeBlockForEstimation(block);
      const encoding = encoding_for_model('gpt-4');
      const tokens = encoding.encode(text);
      encoding.free(); // Important: free memory

      return {
        tokens: tokens.length,
        confidence: 'high',
      };
    } catch (error) {
      // Fallback to heuristic on error
      console.warn(
        '[GeminiTokenEstimator] tiktoken error, falling back to heuristic:',
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

      const encoding = encoding_for_model('gpt-4');
      const tokens = encoding.encode(combinedText);
      encoding.free(); // Important: free memory

      return {
        tokens: tokens.length,
        confidence: 'high',
      };
    } catch (error) {
      // Fallback: sum individual heuristic estimates
      console.warn(
        '[GeminiTokenEstimator] tiktoken error, falling back to heuristic:',
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
