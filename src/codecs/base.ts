/**
 * Base codec utilities.
 */

import { createHash } from 'crypto';

/**
 * Default hash implementation: SHA-256 of JSON.stringify(canonicalized).
 *
 * @param canonicalized - Canonicalized payload
 * @returns Hex-encoded SHA-256 hash
 */
export function defaultHash(canonicalized: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalized))
    .digest('hex');
}

/**
 * Sort object keys for deterministic serialization.
 *
 * @param obj - Object to sort
 * @returns Object with sorted keys
 */
export function sortObjectKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    const value = obj[key];
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      sorted[key] = sortObjectKeys(value as Record<string, unknown>);
    } else {
      sorted[key] = value;
    }
  }
  return sorted;
}
