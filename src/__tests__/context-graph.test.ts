/**
 * Unit tests for ContextGraph.
 *
 * Tests block management, relationship tracking, queries, and view creation.
 */

import { describe, it, expect } from 'vitest';
import { ContextGraph } from '../graph/context-graph.js';
import type { ContextBlock, BlockRef } from '../types/block.js';

describe('ContextGraph', () => {
  describe('Block management', () => {
    it('should add and retrieve blocks', () => {
      const graph = new ContextGraph();

      const block: ContextBlock<string> = createBlock('hash1', 'pinned', 'test');

      graph.addBlock(block);

      expect(graph.hasBlock('hash1')).toBe(true);
      expect(graph.getBlock('hash1')).toEqual(block);
    });

    it('should be idempotent when adding same block', () => {
      const graph = new ContextGraph();

      const block = createBlock('hash1', 'pinned', 'test');

      graph.addBlock(block);
      graph.addBlock(block); // Add again

      expect(graph.getBlockCount()).toBe(1);
    });

    it('should remove blocks', () => {
      const graph = new ContextGraph();

      const block = createBlock('hash1', 'pinned', 'test');
      graph.addBlock(block);

      const removed = graph.removeBlock('hash1');

      expect(removed).toBe(true);
      expect(graph.hasBlock('hash1')).toBe(false);
      expect(graph.getBlockCount()).toBe(0);
    });

    it('should return false when removing non-existent block', () => {
      const graph = new ContextGraph();

      const removed = graph.removeBlock('non-existent');

      expect(removed).toBe(false);
    });

    it('should count blocks correctly', () => {
      const graph = new ContextGraph();

      expect(graph.getBlockCount()).toBe(0);

      graph.addBlock(createBlock('hash1', 'pinned', 'test1'));
      expect(graph.getBlockCount()).toBe(1);

      graph.addBlock(createBlock('hash2', 'memory', 'test2'));
      expect(graph.getBlockCount()).toBe(2);

      graph.removeBlock('hash1');
      expect(graph.getBlockCount()).toBe(1);
    });

    it('should return undefined for non-existent block', () => {
      const graph = new ContextGraph();

      expect(graph.getBlock('non-existent')).toBeUndefined();
    });

    it('should list all block hashes', () => {
      const graph = new ContextGraph();

      graph.addBlock(createBlock('hash1', 'pinned', 'test1'));
      graph.addBlock(createBlock('hash2', 'memory', 'test2'));
      graph.addBlock(createBlock('hash3', 'history', 'test3'));

      const blocks = graph.getAllBlocks();

      expect(blocks).toHaveLength(3);
      expect(blocks.map((b) => b.blockHash)).toContain('hash1');
      expect(blocks.map((b) => b.blockHash)).toContain('hash2');
      expect(blocks.map((b) => b.blockHash)).toContain('hash3');
    });
  });

  describe('Derivation edges', () => {
    it('should track derivation relationships', () => {
      const graph = new ContextGraph();

      const parent = createBlock('parent', 'pinned', 'parent');
      const child = createBlock('child', 'memory', 'child');

      graph.addBlock(parent);
      graph.addBlock(child, [{ blockHash: 'parent' }]);

      const derivedFrom = graph.getDerivedFrom('child');

      expect(derivedFrom).toHaveLength(1);
      expect(derivedFrom[0].blockHash).toBe('parent');
    });

    it('should track multiple parent blocks', () => {
      const graph = new ContextGraph();

      graph.addBlock(createBlock('parent1', 'pinned', 'p1'));
      graph.addBlock(createBlock('parent2', 'pinned', 'p2'));
      graph.addBlock(createBlock('child', 'memory', 'child'), [
        { blockHash: 'parent1' },
        { blockHash: 'parent2' },
      ]);

      const derivedFrom = graph.getDerivedFrom('child');

      expect(derivedFrom).toHaveLength(2);
      expect(derivedFrom.map((p) => p.blockHash)).toContain('parent1');
      expect(derivedFrom.map((p) => p.blockHash)).toContain('parent2');
    });

    it('should return empty array for blocks with no parents', () => {
      const graph = new ContextGraph();

      graph.addBlock(createBlock('hash1', 'pinned', 'test'));

      const derivedFrom = graph.getDerivedFrom('hash1');

      expect(derivedFrom).toEqual([]);
    });

    it('should clean up derivation edges when removing block', () => {
      const graph = new ContextGraph();

      graph.addBlock(createBlock('parent', 'pinned', 'parent'));
      graph.addBlock(createBlock('child', 'memory', 'child'), [
        { blockHash: 'parent' },
      ]);

      graph.removeBlock('child');

      expect(graph.getDerivedFrom('child')).toEqual([]);
    });
  });

  describe('Reference edges', () => {
    it('should track reference relationships', () => {
      const graph = new ContextGraph();

      graph.addBlock(createBlock('ref1', 'reference', 'ref1'));
      graph.addBlock(
        createBlock('block', 'memory', 'block'),
        undefined,
        ['ref1']
      );

      const references = graph.getReferences('block');

      expect(references).toHaveLength(1);
      expect(references).toContain('ref1');
    });

    it('should track multiple references', () => {
      const graph = new ContextGraph();

      graph.addBlock(createBlock('ref1', 'reference', 'r1'));
      graph.addBlock(createBlock('ref2', 'reference', 'r2'));
      graph.addBlock(
        createBlock('block', 'memory', 'block'),
        undefined,
        ['ref1', 'ref2']
      );

      const references = graph.getReferences('block');

      expect(references).toHaveLength(2);
      expect(references).toContain('ref1');
      expect(references).toContain('ref2');
    });

    it('should return empty array for blocks with no references', () => {
      const graph = new ContextGraph();

      graph.addBlock(createBlock('hash1', 'pinned', 'test'));

      const references = graph.getReferences('hash1');

      expect(references).toEqual([]);
    });

    it('should clean up reference edges when removing block', () => {
      const graph = new ContextGraph();

      graph.addBlock(createBlock('ref', 'reference', 'ref'));
      graph.addBlock(
        createBlock('block', 'memory', 'block'),
        undefined,
        ['ref']
      );

      graph.removeBlock('block');

      expect(graph.getReferences('block')).toEqual([]);
    });
  });

  describe('Block selection with queries', () => {
    it('should select all blocks with empty query', () => {
      const graph = new ContextGraph();

      graph.addBlock(createBlock('hash1', 'pinned', 'test1'));
      graph.addBlock(createBlock('hash2', 'memory', 'test2'));

      const selected = graph.select({});

      expect(selected).toHaveLength(2);
    });

    it('should filter by kind', () => {
      const graph = new ContextGraph();

      graph.addBlock(createBlock('hash1', 'pinned', 'test1'));
      graph.addBlock(createBlock('hash2', 'memory', 'test2'));
      graph.addBlock(createBlock('hash3', 'history', 'test3'));

      const selected = graph.select({ kinds: ['pinned', 'memory'] });

      expect(selected).toHaveLength(2);
      expect(selected.map((b) => b.blockHash)).toContain('hash1');
      expect(selected.map((b) => b.blockHash)).toContain('hash2');
    });

    it('should filter by tags', () => {
      const graph = new ContextGraph();

      const block1 = createBlock('hash1', 'pinned', 'test1');
      block1.meta.tags = ['important'];

      const block2 = createBlock('hash2', 'memory', 'test2');
      block2.meta.tags = ['memory'];

      graph.addBlock(block1);
      graph.addBlock(block2);

      const selected = graph.select({ tags: ['important'] });

      expect(selected).toHaveLength(1);
      expect(selected[0].blockHash).toBe('hash1');
    });

    it('should filter by sensitivity', () => {
      const graph = new ContextGraph();

      const block1 = createBlock('hash1', 'pinned', 'test1');
      block1.meta.sensitivity = 'public';

      const block2 = createBlock('hash2', 'memory', 'test2');
      block2.meta.sensitivity = 'internal';

      graph.addBlock(block1);
      graph.addBlock(block2);

      const selected = graph.select({ maxSensitivity: 'public' });

      expect(selected).toHaveLength(1);
      expect(selected[0].blockHash).toBe('hash1');
    });

    it('should filter by excludeHashes', () => {
      const graph = new ContextGraph();

      graph.addBlock(createBlock('hash1', 'pinned', 'test1'));
      graph.addBlock(createBlock('hash2', 'memory', 'test2'));
      graph.addBlock(createBlock('hash3', 'history', 'test3'));

      const selected = graph.select({ excludeHashes: ['hash2'] });

      expect(selected).toHaveLength(2);
      expect(selected.map((b) => b.blockHash)).not.toContain('hash2');
    });
  });

  describe('View creation', () => {
    it('should create view with deterministic ordering', async () => {
      const graph = new ContextGraph();

      // Add blocks in random order
      graph.addBlock(createBlock('hash-history', 'history', 'history'));
      graph.addBlock(createBlock('hash-pinned', 'pinned', 'pinned'));
      graph.addBlock(createBlock('hash-memory', 'memory', 'memory'));

      const view = await graph.createView({});

      // Should be ordered by KIND_ORDER
      expect(view.blocks).toHaveLength(3);
      expect(view.blocks[0].meta.kind).toBe('pinned');
      expect(view.blocks[1].meta.kind).toBe('memory');
      expect(view.blocks[2].meta.kind).toBe('history');
    });

    it('should compute stable prefix hash', async () => {
      const graph = new ContextGraph();

      graph.addBlock(createBlock('hash1', 'pinned', 'test1'));
      graph.addBlock(createBlock('hash2', 'memory', 'test2'));

      const view = await graph.createView({});

      expect(view.stablePrefixHash).toBeDefined();
      expect(view.stablePrefixHash.length).toBeGreaterThan(0);
    });

    it('should apply query filter in view', async () => {
      const graph = new ContextGraph();

      graph.addBlock(createBlock('hash1', 'pinned', 'test1'));
      graph.addBlock(createBlock('hash2', 'memory', 'test2'));
      graph.addBlock(createBlock('hash3', 'history', 'test3'));

      const view = await graph.createView({ query: { kinds: ['pinned'] } });

      expect(view.blocks).toHaveLength(1);
      expect(view.blocks[0].meta.kind).toBe('pinned');
    });

    it('should create empty view for empty graph', async () => {
      const graph = new ContextGraph();

      const view = await graph.createView({});

      expect(view.blocks).toEqual([]);
      expect(view.stablePrefixHash).toBeDefined();
    });
  });

  describe('Edge cases', () => {
    it('should handle large number of blocks', () => {
      const graph = new ContextGraph();

      // Add 1000 blocks
      for (let i = 0; i < 1000; i++) {
        graph.addBlock(createBlock(`hash${i}`, 'memory', `block${i}`));
      }

      expect(graph.getBlockCount()).toBe(1000);
    });

    it('should handle blocks with same content but different hashes', () => {
      const graph = new ContextGraph();

      const block1 = createBlock('hash1', 'pinned', 'same content');
      const block2 = createBlock('hash2', 'pinned', 'same content');

      graph.addBlock(block1);
      graph.addBlock(block2);

      expect(graph.getBlockCount()).toBe(2);
    });
  });
});

// Helper to create test blocks
function createBlock(
  hash: string,
  kind: 'pinned' | 'reference' | 'memory' | 'state' | 'tool_output' | 'history' | 'turn',
  payload: string
): ContextBlock<string> {
  return {
    blockHash: hash,
    meta: {
      kind,
      sensitivity: 'public',
      codecId: 'test',
      codecVersion: '1.0.0',
      createdAt: Date.now(),
    },
    payload,
  };
}
