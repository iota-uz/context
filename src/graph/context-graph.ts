/**
 * ContextGraph: Core data structure for managing context blocks and relationships.
 *
 * Holds blocks, tracks derivation/reference edges, supports querying and view creation.
 */

import type { ContextBlock, BlockRef } from '../types/block.js';
import type { BlockQuery } from './queries.js';
import type { ContextView, ViewOptions } from './views.js';
import { createContextView } from './views.js';
import { matchesQuery } from './queries.js';

/**
 * Edge types for block relationships.
 */
export interface ContextGraphEdges {
  /** Derivation edges: blockHash -> parent BlockRefs (provenance tracking) */
  derivedFrom: Map<string, BlockRef[]>;

  /** Reference edges: blockHash -> referenced blockHashes (lightweight citations) */
  references: Map<string, string[]>;
}

/**
 * ContextGraph: Mutable graph of context blocks with relationship tracking.
 *
 * Responsibilities:
 * - Store blocks by content-addressed hash
 * - Track derivation and reference relationships
 * - Support query-based block selection
 * - Create deterministic views with stable ordering
 */
export class ContextGraph {
  /** All blocks indexed by blockHash */
  private readonly blocks: Map<string, ContextBlock<unknown>>;

  /** Block relationship edges */
  private readonly edges: ContextGraphEdges;

  constructor() {
    this.blocks = new Map();
    this.edges = {
      derivedFrom: new Map(),
      references: new Map(),
    };
  }

  /**
   * Add a block to the graph.
   * Idempotent: if block already exists (same hash), this is a no-op.
   *
   * @param block - Block to add
   * @param derivedFrom - Optional parent blocks for provenance
   * @param references - Optional referenced block hashes
   */
  addBlock<TPayload>(
    block: ContextBlock<TPayload>,
    derivedFrom?: BlockRef[],
    references?: string[]
  ): void {
    const { blockHash } = block;

    // Idempotent: skip if already exists
    if (this.blocks.has(blockHash)) {
      return;
    }

    // Add block
    this.blocks.set(blockHash, block as ContextBlock<unknown>);

    // Add derivation edges
    if (derivedFrom && derivedFrom.length > 0) {
      this.edges.derivedFrom.set(blockHash, derivedFrom);
    }

    // Add reference edges
    if (references && references.length > 0) {
      this.edges.references.set(blockHash, references);
    }
  }

  /**
   * Remove a block from the graph.
   * Also removes associated edges.
   *
   * @param blockHash - Block hash to remove
   * @returns True if block was removed, false if not found
   */
  removeBlock(blockHash: string): boolean {
    const existed = this.blocks.delete(blockHash);

    // Clean up edges
    this.edges.derivedFrom.delete(blockHash);
    this.edges.references.delete(blockHash);

    return existed;
  }

  /**
   * Get a block by hash.
   *
   * @param blockHash - Block hash
   * @returns Block if found, undefined otherwise
   */
  getBlock<TPayload = unknown>(blockHash: string): ContextBlock<TPayload> | undefined {
    return this.blocks.get(blockHash) as ContextBlock<TPayload> | undefined;
  }

  /**
   * Check if a block exists in the graph.
   *
   * @param blockHash - Block hash
   * @returns True if block exists
   */
  hasBlock(blockHash: string): boolean {
    return this.blocks.has(blockHash);
  }

  /**
   * Get all blocks in the graph (unordered).
   *
   * @returns Array of all blocks
   */
  getAllBlocks(): ContextBlock<unknown>[] {
    return Array.from(this.blocks.values());
  }

  /**
   * Get the number of blocks in the graph.
   *
   * @returns Block count
   */
  getBlockCount(): number {
    return this.blocks.size;
  }

  /**
   * Get parent blocks (provenance) for a given block.
   *
   * @param blockHash - Block hash
   * @returns Array of parent BlockRefs, or empty array if none
   */
  getDerivedFrom(blockHash: string): BlockRef[] {
    return this.edges.derivedFrom.get(blockHash) ?? [];
  }

  /**
   * Get referenced block hashes for a given block.
   *
   * @param blockHash - Block hash
   * @returns Array of referenced hashes, or empty array if none
   */
  getReferences(blockHash: string): string[] {
    return this.edges.references.get(blockHash) ?? [];
  }

  /**
   * Select blocks matching a query.
   * Returns blocks in arbitrary order (use createView for deterministic ordering).
   *
   * @param query - Block query
   * @returns Matching blocks
   */
  select(query: BlockQuery): ContextBlock<unknown>[] {
    const allBlocks = this.getAllBlocks();
    return allBlocks.filter((block) => matchesQuery(block, query, this));
  }

  /**
   * Create a deterministic view of the graph.
   * View is immutable snapshot with stable ordering (KIND_ORDER + lexicographic).
   *
   * @param options - View options (query, token budget, etc.)
   * @returns ContextView with ordered blocks
   */
  async createView(options: ViewOptions): Promise<ContextView> {
    return createContextView(this, options);
  }

  /**
   * Clear all blocks and edges.
   */
  clear(): void {
    this.blocks.clear();
    this.edges.derivedFrom.clear();
    this.edges.references.clear();
  }

  /**
   * Get graph statistics.
   *
   * @returns Graph stats
   */
  getStats(): {
    blockCount: number;
    derivationEdgeCount: number;
    referenceEdgeCount: number;
  } {
    return {
      blockCount: this.blocks.size,
      derivationEdgeCount: this.edges.derivedFrom.size,
      referenceEdgeCount: this.edges.references.size,
    };
  }
}
