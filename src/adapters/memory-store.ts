/**
 * MemoryStore: Persistence interface for context blocks.
 *
 * Provides a common interface for storing and retrieving context blocks
 * with support for querying and deletion.
 *
 * External implementations:
 * - @foundry/context-store-postgres - PostgreSQL backend
 * - @foundry/context-store-redis - Redis backend
 * - @foundry/context-store-memory - In-memory backend (testing)
 */

import type { ContextBlock } from '../types/block.js';
import type { BlockQuery } from '../graph/queries.js';

/**
 * Memory store query options.
 */
export interface MemoryQueryOptions {
  /** Block query filter */
  query?: BlockQuery;

  /** Maximum number of results */
  limit?: number;

  /** Offset for pagination */
  offset?: number;

  /** Sort by field (default: createdAt descending) */
  sortBy?: 'createdAt' | 'blockHash';

  /** Sort order */
  sortOrder?: 'asc' | 'desc';
}

/**
 * Memory store save options.
 */
export interface MemorySaveOptions {
  /** Time-to-live (seconds, optional) */
  ttl?: number;

  /** Overwrite existing block with same hash */
  overwrite?: boolean;
}

/**
 * MemoryStore interface for context block persistence.
 */
export interface MemoryStore {
  /**
   * Save a block to the store.
   *
   * @param block - Block to save
   * @param options - Save options
   * @returns Promise resolving when save is complete
   */
  save<TPayload>(
    block: ContextBlock<TPayload>,
    options?: MemorySaveOptions
  ): Promise<void>;

  /**
   * Load a block by hash.
   *
   * @param blockHash - Block hash to load
   * @returns Block if found, undefined otherwise
   */
  load<TPayload = unknown>(
    blockHash: string
  ): Promise<ContextBlock<TPayload> | undefined>;

  /**
   * Query blocks matching criteria.
   *
   * @param options - Query options
   * @returns Matching blocks
   */
  query(options?: MemoryQueryOptions): Promise<ContextBlock<unknown>[]>;

  /**
   * Delete a block by hash.
   *
   * @param blockHash - Block hash to delete
   * @returns True if block was deleted, false if not found
   */
  delete(blockHash: string): Promise<boolean>;

  /**
   * Delete all blocks matching a query.
   *
   * @param query - Block query filter
   * @returns Number of blocks deleted
   */
  deleteMany(query: BlockQuery): Promise<number>;

  /**
   * Check if a block exists in the store.
   *
   * @param blockHash - Block hash to check
   * @returns True if block exists
   */
  exists(blockHash: string): Promise<boolean>;

  /**
   * Get store statistics.
   *
   * @returns Store stats
   */
  getStats(): Promise<{
    blockCount: number;
    totalSizeBytes?: number;
  }>;

  /**
   * Clear all blocks from the store.
   * Use with caution!
   *
   * @returns Promise resolving when clear is complete
   */
  clear(): Promise<void>;
}

/**
 * InMemoryStore: Simple in-memory implementation for testing.
 *
 * WARNING: Not suitable for production use. Data is lost on process restart.
 */
export class InMemoryStore implements MemoryStore {
  private readonly blocks: Map<string, ContextBlock<unknown>>;
  private readonly ttls: Map<string, number>; // blockHash -> expiresAt timestamp

  constructor() {
    this.blocks = new Map();
    this.ttls = new Map();
  }

  /**
   * Clean up expired blocks (called before operations).
   */
  private cleanupExpired(): void {
    const now = Math.floor(Date.now() / 1000);
    const expiredHashes: string[] = [];

    for (const [blockHash, expiresAt] of this.ttls.entries()) {
      if (expiresAt <= now) {
        expiredHashes.push(blockHash);
      }
    }

    for (const hash of expiredHashes) {
      this.blocks.delete(hash);
      this.ttls.delete(hash);
    }
  }

  async save<TPayload>(
    block: ContextBlock<TPayload>,
    options?: MemorySaveOptions
  ): Promise<void> {
    this.cleanupExpired();

    const { blockHash } = block;

    // Check for existing block
    if (this.blocks.has(blockHash) && !options?.overwrite) {
      // Block already exists and overwrite is false - skip
      return;
    }

    // Save block
    this.blocks.set(blockHash, block as ContextBlock<unknown>);

    // Set TTL if provided
    if (options?.ttl) {
      const expiresAt = Math.floor(Date.now() / 1000) + options.ttl;
      this.ttls.set(blockHash, expiresAt);
    } else {
      // Remove TTL if overwriting without TTL
      this.ttls.delete(blockHash);
    }
  }

  async load<TPayload = unknown>(
    blockHash: string
  ): Promise<ContextBlock<TPayload> | undefined> {
    this.cleanupExpired();
    return this.blocks.get(blockHash) as ContextBlock<TPayload> | undefined;
  }

  async query(options?: MemoryQueryOptions): Promise<ContextBlock<unknown>[]> {
    this.cleanupExpired();

    let results = Array.from(this.blocks.values());

    // Apply query filter if provided
    if (options?.query) {
      const { matchesQuery } = await import('../graph/queries.js');
      results = results.filter((block) =>
        matchesQuery(block, options.query!, {
          select: () => [],
          hasBlock: (hash: string) => this.blocks.has(hash),
        } as any)
      );
    }

    // Sort results
    const sortBy = options?.sortBy ?? 'createdAt';
    const sortOrder = options?.sortOrder ?? 'desc';

    results.sort((a, b) => {
      let comparison = 0;

      if (sortBy === 'createdAt') {
        comparison = a.meta.createdAt - b.meta.createdAt;
      } else if (sortBy === 'blockHash') {
        comparison = a.blockHash.localeCompare(b.blockHash);
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });

    // Apply limit and offset
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? results.length;

    return results.slice(offset, offset + limit);
  }

  async delete(blockHash: string): Promise<boolean> {
    this.cleanupExpired();

    const existed = this.blocks.delete(blockHash);
    this.ttls.delete(blockHash);

    return existed;
  }

  async deleteMany(query: BlockQuery): Promise<number> {
    this.cleanupExpired();

    const matchingBlocks = await this.query({ query });
    let deleted = 0;

    for (const block of matchingBlocks) {
      if (await this.delete(block.blockHash)) {
        deleted++;
      }
    }

    return deleted;
  }

  async exists(blockHash: string): Promise<boolean> {
    this.cleanupExpired();
    return this.blocks.has(blockHash);
  }

  async getStats(): Promise<{ blockCount: number; totalSizeBytes?: number }> {
    this.cleanupExpired();

    // Estimate total size in bytes
    let totalSizeBytes = 0;

    for (const block of this.blocks.values()) {
      // Rough estimate: JSON.stringify length
      totalSizeBytes += JSON.stringify(block).length;
    }

    return {
      blockCount: this.blocks.size,
      totalSizeBytes,
    };
  }

  async clear(): Promise<void> {
    this.blocks.clear();
    this.ttls.clear();
  }

  /**
   * Get all blocks (testing only).
   *
   * @returns All blocks in the store
   */
  getAllBlocks(): ContextBlock<unknown>[] {
    this.cleanupExpired();
    return Array.from(this.blocks.values());
  }
}

/**
 * Create an in-memory store for testing.
 *
 * @returns InMemoryStore instance
 */
export function createInMemoryStore(): MemoryStore {
  return new InMemoryStore();
}
