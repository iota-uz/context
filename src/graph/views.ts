/**
 * ContextView: Immutable, deterministically-ordered snapshot of context blocks.
 *
 * Views provide stable ordering (KIND_ORDER + lexicographic) and token estimation.
 */

import { createHash } from 'crypto';
import type { ContextBlock } from '../types/block.js';
import type { ContextGraph } from './context-graph.js';
import type { BlockQuery } from './queries.js';
import type { TokenEstimator } from '../adapters/token-estimator.js';
import { compareKinds } from './kind-order.js';

/**
 * View options for creating a ContextView.
 */
export interface ViewOptions {
  /** Query to filter blocks (default: all blocks) */
  query?: BlockQuery;

  /** Token estimator for budget enforcement (optional) */
  tokenEstimator?: TokenEstimator;

  /** Maximum token budget (requires tokenEstimator) */
  maxTokens?: number;
}

/**
 * Token estimation result for a view.
 */
export interface ViewTokenEstimate {
  /** Estimated token count */
  tokens: number;

  /** Confidence level */
  confidence: 'exact' | 'high' | 'low';

  /** Whether token budget was exceeded (blocks were truncated) */
  truncated: boolean;
}

/**
 * ContextView: Immutable snapshot of blocks with deterministic ordering.
 *
 * Ordering rules:
 * 1. Primary: KIND_ORDER (pinned → reference → memory → state → tool_output → history → turn)
 * 2. Secondary: Lexicographic by blockHash within same kind
 */
export interface ContextView {
  /** Ordered blocks (immutable) */
  readonly blocks: ReadonlyArray<ContextBlock<unknown>>;

  /** Token estimation (if estimator provided) */
  readonly tokenEstimate?: ViewTokenEstimate;

  /**
   * Stable prefix hash (computed from ordered block hashes).
   * Two views with identical ordered blocks have identical prefix hashes.
   */
  readonly stablePrefixHash: string;

  /** View creation timestamp */
  readonly createdAt: number;
}

/**
 * Sort blocks deterministically by KIND_ORDER + lexicographic.
 *
 * @param blocks - Blocks to sort
 * @returns Sorted blocks (new array)
 */
export function sortBlocksDeterministic(
  blocks: ContextBlock<unknown>[]
): ContextBlock<unknown>[] {
  return [...blocks].sort((a, b) => {
    // Primary: KIND_ORDER
    const kindCmp = compareKinds(a.meta.kind, b.meta.kind);
    if (kindCmp !== 0) {
      return kindCmp;
    }

    // Secondary: Lexicographic by blockHash
    return a.blockHash.localeCompare(b.blockHash);
  });
}

/**
 * Compute stable prefix hash from ordered block hashes.
 *
 * @param blocks - Ordered blocks
 * @returns Hex-encoded SHA-256 hash
 */
export function computeStablePrefixHash(blocks: ReadonlyArray<ContextBlock<unknown>>): string {
  // Concatenate block hashes in order
  const concatenated = blocks.map((b) => b.blockHash).join('|');

  // Compute SHA-256 hash
  const hash = createHash('sha256')
    .update(concatenated)
    .digest('hex');

  return hash;
}

/**
 * Apply token budget to blocks (truncate if needed).
 * Returns blocks that fit within budget + estimation metadata.
 *
 * @param blocks - Ordered blocks
 * @param estimator - Token estimator
 * @param maxTokens - Maximum token budget
 * @returns Truncated blocks + estimation result
 */
async function applyTokenBudget(
  blocks: ContextBlock<unknown>[],
  estimator: TokenEstimator,
  maxTokens: number
): Promise<{ blocks: ContextBlock<unknown>[]; estimate: ViewTokenEstimate }> {
  let totalTokens = 0;
  let lowestConfidence: 'exact' | 'high' | 'low' = 'exact';
  const includedBlocks: ContextBlock<unknown>[] = [];

  for (const block of blocks) {
    // Estimate tokens for this block
    const blockEstimate = await estimator.estimateBlock(block);
    const projectedTotal = totalTokens + blockEstimate.tokens;

    // Check if adding this block would exceed budget
    if (projectedTotal > maxTokens) {
      // Budget exceeded - stop here
      return {
        blocks: includedBlocks,
        estimate: {
          tokens: totalTokens,
          confidence: lowestConfidence,
          truncated: true,
        },
      };
    }

    // Include block
    includedBlocks.push(block);
    totalTokens += blockEstimate.tokens;

    // Track lowest confidence
    if (blockEstimate.confidence === 'low') {
      lowestConfidence = 'low';
    } else if (blockEstimate.confidence === 'high' && lowestConfidence === 'exact') {
      lowestConfidence = 'high';
    }
  }

  // All blocks fit within budget
  return {
    blocks: includedBlocks,
    estimate: {
      tokens: totalTokens,
      confidence: lowestConfidence,
      truncated: false,
    },
  };
}

/**
 * Create a ContextView from a graph and options.
 *
 * @param graph - Context graph
 * @param options - View options
 * @returns ContextView
 */
export async function createContextView(
  graph: ContextGraph,
  options: ViewOptions
): Promise<ContextView> {
  // Select blocks matching query
  const query = options.query ?? {};
  let selectedBlocks = graph.select(query);

  // Sort blocks deterministically
  selectedBlocks = sortBlocksDeterministic(selectedBlocks);

  // Apply token budget if provided
  let tokenEstimate: ViewTokenEstimate | undefined;
  if (options.tokenEstimator && options.maxTokens !== undefined) {
    const result = await applyTokenBudget(
      selectedBlocks,
      options.tokenEstimator,
      options.maxTokens
    );
    selectedBlocks = result.blocks;
    tokenEstimate = result.estimate;
  } else if (options.tokenEstimator) {
    // Estimate without budget enforcement
    const estimate = await options.tokenEstimator.estimate(selectedBlocks);
    tokenEstimate = {
      tokens: estimate.tokens,
      confidence: estimate.confidence,
      truncated: false,
    };
  }

  // Compute stable prefix hash
  const stablePrefixHash = computeStablePrefixHash(selectedBlocks);

  return {
    blocks: selectedBlocks,
    tokenEstimate,
    stablePrefixHash,
    createdAt: Math.floor(Date.now() / 1000),
  };
}

/**
 * Check if two views have identical content (same blocks in same order).
 *
 * @param a - First view
 * @param b - Second view
 * @returns True if views have identical content
 */
export function viewsEqual(a: ContextView, b: ContextView): boolean {
  return a.stablePrefixHash === b.stablePrefixHash;
}

/**
 * Merge multiple views into a single view (preserves ordering).
 * Deduplicates blocks by hash.
 *
 * @param views - Views to merge
 * @returns Merged view
 */
export function mergeViews(...views: ContextView[]): ContextView {
  const seenHashes = new Set<string>();
  const mergedBlocks: ContextBlock<unknown>[] = [];

  for (const view of views) {
    for (const block of view.blocks) {
      if (!seenHashes.has(block.blockHash)) {
        seenHashes.add(block.blockHash);
        mergedBlocks.push(block);
      }
    }
  }

  // Re-sort merged blocks
  const sortedBlocks = sortBlocksDeterministic(mergedBlocks);

  // Compute new prefix hash
  const stablePrefixHash = computeStablePrefixHash(sortedBlocks);

  return {
    blocks: sortedBlocks,
    stablePrefixHash,
    createdAt: Math.floor(Date.now() / 1000),
  };
}
