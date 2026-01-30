/**
 * TokenEstimator: Single source of truth for token counting.
 *
 * Provides provider-specific token estimation for context blocks.
 * NOT implemented by codecs - this is the only place token counting happens.
 */

import type { ContextBlock } from '../types/block.js';

/**
 * Token estimation result.
 */
export interface TokenEstimate {
  /** Estimated token count */
  tokens: number;

  /**
   * Confidence level:
   * - 'exact': API-provided count (Anthropic)
   * - 'high': tiktoken-based (OpenAI/Gemini)
   * - 'low': Heuristic fallback (chars / 4)
   */
  confidence: 'exact' | 'high' | 'low';
}

/**
 * TokenEstimator interface.
 * All implementations must be async (Anthropic uses API calls).
 */
export interface TokenEstimator {
  /**
   * Estimate tokens for a list of blocks.
   *
   * @param blocks - Blocks to estimate
   * @returns Token estimate
   */
  estimate(blocks: ContextBlock<unknown>[]): Promise<TokenEstimate>;

  /**
   * Estimate tokens for a single block.
   *
   * @param block - Block to estimate
   * @returns Token estimate
   */
  estimateBlock(block: ContextBlock<unknown>): Promise<TokenEstimate>;
}

/**
 * Safety multiplier for low-confidence estimates.
 * Applies 1.2x multiplier to heuristic estimates to avoid budget overruns.
 */
export const LOW_CONFIDENCE_MULTIPLIER = 1.2;

/**
 * Heuristic token estimation (chars / 4).
 * Used as fallback when tiktoken/API is unavailable.
 *
 * @param text - Text to estimate
 * @returns Token count
 */
export function heuristicTokenCount(text: string): number {
  return Math.ceil((text.length / 4) * LOW_CONFIDENCE_MULTIPLIER);
}

/**
 * Serialize a block to text for token estimation.
 * Uses JSON.stringify as a reasonable approximation of rendered content.
 *
 * @param block - Block to serialize
 * @returns Serialized text
 */
export function serializeBlockForEstimation(block: ContextBlock<unknown>): string {
  return JSON.stringify(block.payload);
}
