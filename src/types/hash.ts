/**
 * Block hashing utilities.
 */

import { createHash } from 'crypto';
import type { BlockMeta, StableMetaSubset } from './block.js';
import type { BlockCodec } from './codec.js';

/**
 * Extract stable metadata subset for hashing.
 * Excludes volatile fields like createdAt, source, tags.
 *
 * @param meta - Full block metadata
 * @returns Stable metadata subset
 */
export function extractStableMetaSubset(meta: BlockMeta): StableMetaSubset {
  return {
    kind: meta.kind,
    sensitivity: meta.sensitivity,
    codecId: meta.codecId,
    codecVersion: meta.codecVersion,
  };
}

/**
 * Compute content-addressed block hash.
 * Uses StableMetaSubset + codec.canonicalize(payload) for deterministic hashing.
 *
 * @param meta - Block metadata (or StableMetaSubset)
 * @param payload - Block payload (or canonicalized payload if codec not provided)
 * @param codec - Block codec for canonicalization (optional)
 * @returns Hex-encoded SHA-256 hash
 */
export function computeBlockHash<TPayload>(
  meta: BlockMeta | StableMetaSubset,
  payload: TPayload,
  codec?: BlockCodec<TPayload>
): string {
  // Extract stable metadata subset (if full meta provided)
  const stableMeta = 'createdAt' in meta ? extractStableMetaSubset(meta) : meta;

  // Canonicalize payload (if codec provided)
  const canonicalized = codec ? codec.canonicalize(payload) : payload;

  // Combine stable meta + canonicalized payload
  const combined = {
    meta: stableMeta,
    payload: canonicalized,
  };

  // Compute SHA-256 hash
  const hash = createHash('sha256')
    .update(JSON.stringify(combined))
    .digest('hex');

  return hash;
}

