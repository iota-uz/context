/**
 * Unit tests for BlockQuery filtering logic.
 *
 * Tests matchesQuery, compareSensitivity, mergeQueries, and emptyQuery.
 */

import { describe, it, expect } from 'vitest';
import {
  matchesQuery,
  compareSensitivity,
  mergeQueries,
  emptyQuery,
} from '../graph/queries.js';
import { ContextGraph } from '../graph/context-graph.js';
import type { ContextBlock, BlockKind } from '../types/block.js';
import type { BlockQuery } from '../graph/queries.js';

describe('BlockQuery', () => {
  describe('compareSensitivity', () => {
    it('should order public < internal < restricted', () => {
      expect(compareSensitivity('public', 'internal')).toBeLessThan(0);
      expect(compareSensitivity('internal', 'restricted')).toBeLessThan(0);
      expect(compareSensitivity('public', 'restricted')).toBeLessThan(0);
    });

    it('should be symmetric', () => {
      expect(compareSensitivity('internal', 'public')).toBeGreaterThan(0);
      expect(compareSensitivity('restricted', 'internal')).toBeGreaterThan(0);
      expect(compareSensitivity('restricted', 'public')).toBeGreaterThan(0);
    });

    it('should return zero for equal levels', () => {
      expect(compareSensitivity('public', 'public')).toBe(0);
      expect(compareSensitivity('internal', 'internal')).toBe(0);
      expect(compareSensitivity('restricted', 'restricted')).toBe(0);
    });
  });

  describe('matchesQuery', () => {
    const graph = new ContextGraph();

    describe('Kind filtering', () => {
      it('should match blocks with specified kinds', () => {
        const block = createBlock('hash1', 'pinned', 'test');

        expect(matchesQuery(block, { kinds: ['pinned'] }, graph)).toBe(true);
        expect(matchesQuery(block, { kinds: ['memory'] }, graph)).toBe(false);
      });

      it('should use OR logic for multiple kinds', () => {
        const block = createBlock('hash1', 'memory', 'test');

        expect(
          matchesQuery(block, { kinds: ['pinned', 'memory'] }, graph)
        ).toBe(true);
      });

      it('should match all blocks when kinds is empty', () => {
        const block = createBlock('hash1', 'pinned', 'test');

        expect(matchesQuery(block, { kinds: [] }, graph)).toBe(true);
      });
    });

    describe('Tag filtering', () => {
      it('should match blocks with all specified tags', () => {
        const block = createBlock('hash1', 'pinned', 'test');
        block.meta.tags = ['important', 'cached'];

        expect(
          matchesQuery(block, { tags: ['important'] }, graph)
        ).toBe(true);
        expect(
          matchesQuery(block, { tags: ['important', 'cached'] }, graph)
        ).toBe(true);
      });

      it('should use AND logic for multiple tags', () => {
        const block = createBlock('hash1', 'pinned', 'test');
        block.meta.tags = ['important'];

        expect(
          matchesQuery(block, { tags: ['important', 'cached'] }, graph)
        ).toBe(false);
      });

      it('should match blocks without tags when tags filter is empty', () => {
        const block = createBlock('hash1', 'pinned', 'test');

        expect(matchesQuery(block, { tags: [] }, graph)).toBe(true);
      });
    });

    describe('Sensitivity filtering', () => {
      it('should filter by maximum sensitivity', () => {
        const publicBlock = createBlock('hash1', 'pinned', 'test');
        publicBlock.meta.sensitivity = 'public';

        const internalBlock = createBlock('hash2', 'memory', 'test');
        internalBlock.meta.sensitivity = 'internal';

        expect(
          matchesQuery(publicBlock, { maxSensitivity: 'public' }, graph)
        ).toBe(true);
        expect(
          matchesQuery(internalBlock, { maxSensitivity: 'public' }, graph)
        ).toBe(false);
      });

      it('should filter by minimum sensitivity', () => {
        const publicBlock = createBlock('hash1', 'pinned', 'test');
        publicBlock.meta.sensitivity = 'public';

        const internalBlock = createBlock('hash2', 'memory', 'test');
        internalBlock.meta.sensitivity = 'internal';

        expect(
          matchesQuery(publicBlock, { minSensitivity: 'internal' }, graph)
        ).toBe(false);
        expect(
          matchesQuery(internalBlock, { minSensitivity: 'internal' }, graph)
        ).toBe(true);
      });
    });

    describe('Source filtering', () => {
      it('should filter by source', () => {
        const block = createBlock('hash1', 'pinned', 'test');
        block.meta.source = 'test-source';

        expect(
          matchesQuery(block, { source: 'test-source' }, graph)
        ).toBe(true);
        expect(
          matchesQuery(block, { source: 'other-source' }, graph)
        ).toBe(false);
      });
    });

    describe('Timestamp filtering', () => {
      it('should filter by minimum creation timestamp', () => {
        const block = createBlock('hash1', 'pinned', 'test');
        block.meta.createdAt = 1000;

        expect(
          matchesQuery(block, { minCreatedAt: 900 }, graph)
        ).toBe(true);
        expect(
          matchesQuery(block, { minCreatedAt: 1100 }, graph)
        ).toBe(false);
      });

      it('should filter by maximum creation timestamp', () => {
        const block = createBlock('hash1', 'pinned', 'test');
        block.meta.createdAt = 1000;

        expect(
          matchesQuery(block, { maxCreatedAt: 1100 }, graph)
        ).toBe(true);
        expect(
          matchesQuery(block, { maxCreatedAt: 900 }, graph)
        ).toBe(false);
      });
    });

    describe('Provenance filtering', () => {
      it('should filter by derivedFromAny', () => {
        const parent = createBlock('parent', 'pinned', 'parent');
        const child = createBlock('child', 'memory', 'child');

        const testGraph = new ContextGraph();
        testGraph.addBlock(parent);
        testGraph.addBlock(child, [{ blockHash: 'parent' }]);

        expect(
          matchesQuery(child, { derivedFromAny: ['parent'] }, testGraph)
        ).toBe(true);
        expect(
          matchesQuery(child, { derivedFromAny: ['other'] }, testGraph)
        ).toBe(false);
      });

      it('should filter by notDerivedFromAny', () => {
        const parent = createBlock('parent', 'pinned', 'parent');
        const child = createBlock('child', 'memory', 'child');

        const testGraph = new ContextGraph();
        testGraph.addBlock(parent);
        testGraph.addBlock(child, [{ blockHash: 'parent' }]);

        expect(
          matchesQuery(child, { notDerivedFromAny: ['parent'] }, testGraph)
        ).toBe(false);
        expect(
          matchesQuery(child, { notDerivedFromAny: ['other'] }, testGraph)
        ).toBe(true);
      });
    });

    describe('Reference filtering', () => {
      it('should filter by referencesAny', () => {
        const ref = createBlock('ref', 'reference', 'ref');
        const block = createBlock('block', 'memory', 'block');

        const testGraph = new ContextGraph();
        testGraph.addBlock(ref);
        testGraph.addBlock(block, undefined, ['ref']);

        expect(
          matchesQuery(block, { referencesAny: ['ref'] }, testGraph)
        ).toBe(true);
        expect(
          matchesQuery(block, { referencesAny: ['other'] }, testGraph)
        ).toBe(false);
      });
    });

    describe('Exclude hashes', () => {
      it('should exclude specific block hashes', () => {
        const block = createBlock('hash1', 'pinned', 'test');

        expect(
          matchesQuery(block, { excludeHashes: ['hash2'] }, graph)
        ).toBe(true);
        expect(
          matchesQuery(block, { excludeHashes: ['hash1'] }, graph)
        ).toBe(false);
      });
    });

    describe('Combined filters', () => {
      it('should apply multiple filters with AND logic', () => {
        const block = createBlock('hash1', 'pinned', 'test');
        block.meta.tags = ['important'];
        block.meta.sensitivity = 'public';

        const query: BlockQuery = {
          kinds: ['pinned'],
          tags: ['important'],
          maxSensitivity: 'public',
        };

        expect(matchesQuery(block, query, graph)).toBe(true);
      });

      it('should reject if any filter fails', () => {
        const block = createBlock('hash1', 'pinned', 'test');
        block.meta.tags = ['important'];
        block.meta.sensitivity = 'internal';

        const query: BlockQuery = {
          kinds: ['pinned'],
          tags: ['important'],
          maxSensitivity: 'public', // Fails this filter
        };

        expect(matchesQuery(block, query, graph)).toBe(false);
      });
    });
  });

  describe('emptyQuery', () => {
    it('should create empty query object', () => {
      const query = emptyQuery();

      expect(query).toEqual({});
    });
  });

  describe('mergeQueries', () => {
    it('should merge kinds with intersection', () => {
      const q1: BlockQuery = { kinds: ['pinned', 'memory'] };
      const q2: BlockQuery = { kinds: ['memory', 'history'] };

      const merged = mergeQueries(q1, q2);

      expect(merged.kinds).toEqual(['memory']);
    });

    it('should merge tags with union', () => {
      const q1: BlockQuery = { tags: ['tag1'] };
      const q2: BlockQuery = { tags: ['tag2'] };

      const merged = mergeQueries(q1, q2);

      expect(merged.tags).toEqual(['tag1', 'tag2']);
    });

    it('should merge sensitivity with most restrictive', () => {
      const q1: BlockQuery = { minSensitivity: 'public' };
      const q2: BlockQuery = { minSensitivity: 'internal' };

      const merged = mergeQueries(q1, q2);

      expect(merged.minSensitivity).toBe('internal'); // Higher minimum
    });

    it('should merge maxSensitivity with lower maximum', () => {
      const q1: BlockQuery = { maxSensitivity: 'internal' };
      const q2: BlockQuery = { maxSensitivity: 'public' };

      const merged = mergeQueries(q1, q2);

      expect(merged.maxSensitivity).toBe('public'); // Lower maximum
    });

    it('should merge timestamps with most restrictive range', () => {
      const q1: BlockQuery = { minCreatedAt: 100, maxCreatedAt: 500 };
      const q2: BlockQuery = { minCreatedAt: 200, maxCreatedAt: 400 };

      const merged = mergeQueries(q1, q2);

      expect(merged.minCreatedAt).toBe(200); // Max of minimums
      expect(merged.maxCreatedAt).toBe(400); // Min of maximums
    });

    it('should merge provenance with union', () => {
      const q1: BlockQuery = { derivedFromAny: ['hash1'] };
      const q2: BlockQuery = { derivedFromAny: ['hash2'] };

      const merged = mergeQueries(q1, q2);

      expect(merged.derivedFromAny).toEqual(['hash1', 'hash2']);
    });

    it('should merge excludeHashes with union', () => {
      const q1: BlockQuery = { excludeHashes: ['hash1'] };
      const q2: BlockQuery = { excludeHashes: ['hash2'] };

      const merged = mergeQueries(q1, q2);

      expect(merged.excludeHashes).toEqual(['hash1', 'hash2']);
    });

    it('should merge maxTokens with minimum', () => {
      const q1: BlockQuery = { maxTokens: 1000 };
      const q2: BlockQuery = { maxTokens: 500 };

      const merged = mergeQueries(q1, q2);

      expect(merged.maxTokens).toBe(500);
    });

    it('should handle conflicting sources', () => {
      const q1: BlockQuery = { source: 'source1' };
      const q2: BlockQuery = { source: 'source2' };

      const merged = mergeQueries(q1, q2);

      // Conflicting sources = impossible query (empty kinds array)
      expect(merged.kinds).toEqual([]);
    });

    it('should merge empty queries', () => {
      const merged = mergeQueries({}, {});

      expect(merged).toEqual({});
    });

    it('should handle single query', () => {
      const q1: BlockQuery = { kinds: ['pinned'] };

      const merged = mergeQueries(q1);

      expect(merged).toEqual({ kinds: ['pinned'] });
    });
  });
});

// Helper to create test blocks
function createBlock(
  hash: string,
  kind: BlockKind,
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
