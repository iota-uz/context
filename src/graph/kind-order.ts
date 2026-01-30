/**
 * KIND_ORDER: Deterministic block ordering for context compilation.
 *
 * This is the single source of truth for block ordering.
 * All context compilation MUST respect this order.
 */

import type { BlockKind, ContextBlock } from '../types/block.js';

/**
 * Immutable block kind ordering (pinned → reference → memory → state → tool_output → history → turn).
 *
 * NEVER modify this array. It is the contract for deterministic compilation.
 */
export const KIND_ORDER: readonly BlockKind[] = Object.freeze([
  'pinned',       // System rules, always first
  'reference',    // Tool schemas, external docs
  'memory',       // Long-term memory, RAG results
  'state',        // Current workflow/session state
  'tool_output',  // Tool execution results
  'history',      // Conversation history
  'turn',         // Current turn (user message)
] as const);

/**
 * Get kind index for ordering comparison.
 * Returns -1 if kind is not in KIND_ORDER.
 *
 * @param kind - Block kind
 * @returns Index in KIND_ORDER, or -1 if not found
 */
export function getKindIndex(kind: BlockKind): number {
  return KIND_ORDER.indexOf(kind);
}

/**
 * Compare two block kinds for ordering.
 * Returns negative if a < b, positive if a > b, zero if equal.
 *
 * @param a - First block kind
 * @param b - Second block kind
 * @returns Comparison result
 */
export function compareKinds(a: BlockKind, b: BlockKind): number {
  const indexA = getKindIndex(a);
  const indexB = getKindIndex(b);

  // Throw if either kind is not in KIND_ORDER
  if (indexA === -1) {
    throw new Error(`Invalid block kind: ${a}`);
  }
  if (indexB === -1) {
    throw new Error(`Invalid block kind: ${b}`);
  }

  return indexA - indexB;
}

/**
 * Sort blocks by KIND_ORDER (stable sort, preserves relative order within same kind).
 *
 * @param blocks - Blocks to sort
 * @returns Sorted blocks (new array)
 */
export function sortBlocksByKind<TPayload = unknown>(
  blocks: ContextBlock<TPayload>[]
): ContextBlock<TPayload>[] {
  return [...blocks].sort((a, b) => compareKinds(a.meta.kind, b.meta.kind));
}

/**
 * Validate that blocks are sorted by KIND_ORDER.
 * Throws if blocks are not sorted correctly.
 *
 * @param blocks - Blocks to validate
 */
export function validateBlockOrder<TPayload = unknown>(
  blocks: ContextBlock<TPayload>[]
): void {
  for (let i = 1; i < blocks.length; i++) {
    const prev = blocks[i - 1];
    const curr = blocks[i];

    const comparison = compareKinds(prev.meta.kind, curr.meta.kind);
    if (comparison > 0) {
      throw new Error(
        `Blocks not sorted by KIND_ORDER: ${prev.meta.kind} (index ${i - 1}) ` +
        `comes before ${curr.meta.kind} (index ${i})`
      );
    }
  }
}

/**
 * Group blocks by kind (in KIND_ORDER).
 * Returns a map of kind -> blocks.
 *
 * @param blocks - Blocks to group
 * @returns Map of kind to blocks
 */
export function groupBlocksByKind<TPayload = unknown>(
  blocks: ContextBlock<TPayload>[]
): Map<BlockKind, ContextBlock<TPayload>[]> {
  const groups = new Map<BlockKind, ContextBlock<TPayload>[]>();

  for (const block of blocks) {
    const kind = block.meta.kind;
    if (!groups.has(kind)) {
      groups.set(kind, []);
    }
    groups.get(kind)!.push(block);
  }

  return groups;
}

/**
 * Check if a kind is valid (exists in KIND_ORDER).
 *
 * @param kind - Block kind to check
 * @returns True if valid
 */
export function isValidKind(kind: string): kind is BlockKind {
  return getKindIndex(kind as BlockKind) !== -1;
}
