/**
 * BlockQuery: Filtering and selection of context blocks.
 *
 * Supports filtering by kind, tags, sensitivity, stability, provenance, and token budget.
 */

import type { BlockKind, SensitivityLevel, ContextBlock } from '../types/block.js';
import type { ContextGraph } from './context-graph.js';

/**
 * Block query for filtering blocks in a ContextGraph.
 */
export interface BlockQuery {
  /** Filter by block kinds (OR logic: match any) */
  kinds?: BlockKind[];

  /** Filter by tags (AND logic: block must have all tags) */
  tags?: string[];

  /** Filter by minimum sensitivity level */
  minSensitivity?: SensitivityLevel;

  /** Filter by maximum sensitivity level */
  maxSensitivity?: SensitivityLevel;

  /** Filter by source identifier */
  source?: string;

  /** Filter by minimum creation timestamp (Unix seconds) */
  minCreatedAt?: number;

  /** Filter by maximum creation timestamp (Unix seconds) */
  maxCreatedAt?: number;

  /** Filter by provenance: only blocks derived from given hashes */
  derivedFromAny?: string[];

  /** Filter by provenance: only blocks NOT derived from given hashes */
  notDerivedFromAny?: string[];

  /** Filter by references: only blocks referencing any of given hashes */
  referencesAny?: string[];

  /** Exclude blocks with given hashes */
  excludeHashes?: string[];

  /** Maximum token budget (requires token estimation - applied in views) */
  maxTokens?: number;
}

/**
 * Sensitivity level ordering (public < internal < restricted).
 */
const SENSITIVITY_ORDER: Record<SensitivityLevel, number> = {
  public: 0,
  internal: 1,
  restricted: 2,
};

/**
 * Compare two sensitivity levels.
 *
 * @param a - First sensitivity level
 * @param b - Second sensitivity level
 * @returns Negative if a < b, positive if a > b, zero if equal
 */
export function compareSensitivity(a: SensitivityLevel, b: SensitivityLevel): number {
  return SENSITIVITY_ORDER[a] - SENSITIVITY_ORDER[b];
}

/**
 * Check if a block matches a query.
 * Does NOT apply token budget (that's done in view creation).
 *
 * @param block - Block to check
 * @param query - Query to match
 * @param graph - Context graph (for provenance/reference lookups)
 * @returns True if block matches query
 */
export function matchesQuery(
  block: ContextBlock<unknown>,
  query: BlockQuery,
  graph: ContextGraph
): boolean {
  // Filter by kinds (OR logic)
  if (query.kinds && query.kinds.length > 0) {
    if (!query.kinds.includes(block.meta.kind)) {
      return false;
    }
  }

  // Filter by tags (AND logic: block must have all query tags)
  if (query.tags && query.tags.length > 0) {
    const blockTags = new Set(block.meta.tags ?? []);
    for (const tag of query.tags) {
      if (!blockTags.has(tag)) {
        return false;
      }
    }
  }

  // Filter by minimum sensitivity
  if (query.minSensitivity !== undefined) {
    if (compareSensitivity(block.meta.sensitivity, query.minSensitivity) < 0) {
      return false;
    }
  }

  // Filter by maximum sensitivity
  if (query.maxSensitivity !== undefined) {
    if (compareSensitivity(block.meta.sensitivity, query.maxSensitivity) > 0) {
      return false;
    }
  }

  // Filter by source
  if (query.source !== undefined) {
    if (block.meta.source !== query.source) {
      return false;
    }
  }

  // Filter by minimum creation timestamp
  if (query.minCreatedAt !== undefined) {
    if (block.meta.createdAt < query.minCreatedAt) {
      return false;
    }
  }

  // Filter by maximum creation timestamp
  if (query.maxCreatedAt !== undefined) {
    if (block.meta.createdAt > query.maxCreatedAt) {
      return false;
    }
  }

  // Filter by provenance: derivedFromAny
  if (query.derivedFromAny && query.derivedFromAny.length > 0) {
    const parents = graph.getDerivedFrom(block.blockHash);
    const parentHashes = new Set(parents.map((p) => p.blockHash));

    const hasMatch = query.derivedFromAny.some((hash) => parentHashes.has(hash));
    if (!hasMatch) {
      return false;
    }
  }

  // Filter by provenance: notDerivedFromAny
  if (query.notDerivedFromAny && query.notDerivedFromAny.length > 0) {
    const parents = graph.getDerivedFrom(block.blockHash);
    const parentHashes = new Set(parents.map((p) => p.blockHash));

    const hasMatch = query.notDerivedFromAny.some((hash) => parentHashes.has(hash));
    if (hasMatch) {
      return false;
    }
  }

  // Filter by references: referencesAny
  if (query.referencesAny && query.referencesAny.length > 0) {
    const refs = graph.getReferences(block.blockHash);
    const refSet = new Set(refs);

    const hasMatch = query.referencesAny.some((hash) => refSet.has(hash));
    if (!hasMatch) {
      return false;
    }
  }

  // Exclude specific hashes
  if (query.excludeHashes && query.excludeHashes.length > 0) {
    if (query.excludeHashes.includes(block.blockHash)) {
      return false;
    }
  }

  // All filters passed
  return true;
}

/**
 * Create an empty query (matches all blocks).
 *
 * @returns Empty query
 */
export function emptyQuery(): BlockQuery {
  return {};
}

/**
 * Merge multiple queries (AND logic: block must match all queries).
 *
 * @param queries - Queries to merge
 * @returns Merged query
 */
export function mergeQueries(...queries: BlockQuery[]): BlockQuery {
  const merged: BlockQuery = {};

  for (const query of queries) {
    // Merge kinds (intersection)
    if (query.kinds) {
      if (merged.kinds) {
        const kindSet = new Set(merged.kinds);
        merged.kinds = query.kinds.filter((k) => kindSet.has(k));
      } else {
        merged.kinds = [...query.kinds];
      }
    }

    // Merge tags (union - block must have all)
    if (query.tags) {
      merged.tags = [...(merged.tags ?? []), ...query.tags];
    }

    // Merge sensitivity (most restrictive)
    if (query.minSensitivity !== undefined) {
      if (merged.minSensitivity === undefined) {
        merged.minSensitivity = query.minSensitivity;
      } else {
        // Take the higher minimum
        if (compareSensitivity(query.minSensitivity, merged.minSensitivity) > 0) {
          merged.minSensitivity = query.minSensitivity;
        }
      }
    }

    if (query.maxSensitivity !== undefined) {
      if (merged.maxSensitivity === undefined) {
        merged.maxSensitivity = query.maxSensitivity;
      } else {
        // Take the lower maximum
        if (compareSensitivity(query.maxSensitivity, merged.maxSensitivity) < 0) {
          merged.maxSensitivity = query.maxSensitivity;
        }
      }
    }

    // Merge source (must match - conflicting sources = no results)
    if (query.source !== undefined) {
      if (merged.source !== undefined && merged.source !== query.source) {
        // Conflict: return impossible query
        merged.kinds = [];
      } else {
        merged.source = query.source;
      }
    }

    // Merge timestamps (most restrictive)
    if (query.minCreatedAt !== undefined) {
      if (merged.minCreatedAt === undefined) {
        merged.minCreatedAt = query.minCreatedAt;
      } else {
        merged.minCreatedAt = Math.max(merged.minCreatedAt, query.minCreatedAt);
      }
    }

    if (query.maxCreatedAt !== undefined) {
      if (merged.maxCreatedAt === undefined) {
        merged.maxCreatedAt = query.maxCreatedAt;
      } else {
        merged.maxCreatedAt = Math.min(merged.maxCreatedAt, query.maxCreatedAt);
      }
    }

    // Merge provenance (union)
    if (query.derivedFromAny) {
      merged.derivedFromAny = [
        ...(merged.derivedFromAny ?? []),
        ...query.derivedFromAny,
      ];
    }

    if (query.notDerivedFromAny) {
      merged.notDerivedFromAny = [
        ...(merged.notDerivedFromAny ?? []),
        ...query.notDerivedFromAny,
      ];
    }

    if (query.referencesAny) {
      merged.referencesAny = [
        ...(merged.referencesAny ?? []),
        ...query.referencesAny,
      ];
    }

    // Merge excludeHashes (union)
    if (query.excludeHashes) {
      merged.excludeHashes = [
        ...(merged.excludeHashes ?? []),
        ...query.excludeHashes,
      ];
    }

    // Merge maxTokens (minimum)
    if (query.maxTokens !== undefined) {
      if (merged.maxTokens === undefined) {
        merged.maxTokens = query.maxTokens;
      } else {
        merged.maxTokens = Math.min(merged.maxTokens, query.maxTokens);
      }
    }
  }

  return merged;
}
