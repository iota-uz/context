/**
 * Unit tests for KIND_ORDER enforcement.
 *
 * Tests block ordering, comparison, sorting, and validation.
 */

import { describe, it, expect } from 'vitest';
import {
  KIND_ORDER,
  getKindIndex,
  compareKinds,
  sortBlocksByKind,
  validateBlockOrder,
  groupBlocksByKind,
  isValidKind,
} from '../graph/kind-order.js';
import type { ContextBlock, BlockKind } from '../types/block.js';

describe('KIND_ORDER', () => {
  describe('KIND_ORDER constant', () => {
    it('should define correct order', () => {
      expect(KIND_ORDER).toEqual([
        'pinned',
        'reference',
        'memory',
        'state',
        'tool_output',
        'history',
        'turn',
      ]);
    });

    it('should be immutable', () => {
      expect(Object.isFrozen(KIND_ORDER)).toBe(true);
    });

    it('should have 7 kinds', () => {
      expect(KIND_ORDER).toHaveLength(7);
    });
  });

  describe('getKindIndex', () => {
    it('should return correct index for each kind', () => {
      expect(getKindIndex('pinned')).toBe(0);
      expect(getKindIndex('reference')).toBe(1);
      expect(getKindIndex('memory')).toBe(2);
      expect(getKindIndex('state')).toBe(3);
      expect(getKindIndex('tool_output')).toBe(4);
      expect(getKindIndex('history')).toBe(5);
      expect(getKindIndex('turn')).toBe(6);
    });

    it('should return -1 for invalid kind', () => {
      expect(getKindIndex('invalid' as BlockKind)).toBe(-1);
    });
  });

  describe('compareKinds', () => {
    it('should return negative when a < b', () => {
      expect(compareKinds('pinned', 'memory')).toBeLessThan(0);
      expect(compareKinds('reference', 'history')).toBeLessThan(0);
    });

    it('should return positive when a > b', () => {
      expect(compareKinds('memory', 'pinned')).toBeGreaterThan(0);
      expect(compareKinds('turn', 'state')).toBeGreaterThan(0);
    });

    it('should return zero when a == b', () => {
      expect(compareKinds('pinned', 'pinned')).toBe(0);
      expect(compareKinds('memory', 'memory')).toBe(0);
    });

    it('should throw for invalid kind', () => {
      expect(() => compareKinds('invalid' as BlockKind, 'pinned')).toThrow(
        'Invalid block kind: invalid'
      );
      expect(() => compareKinds('pinned', 'invalid' as BlockKind)).toThrow(
        'Invalid block kind: invalid'
      );
    });
  });

  describe('sortBlocksByKind', () => {
    it('should sort blocks by KIND_ORDER', () => {
      const blocks: ContextBlock<string>[] = [
        createBlock('hash3', 'history', 'block 3'),
        createBlock('hash1', 'pinned', 'block 1'),
        createBlock('hash2', 'memory', 'block 2'),
      ];

      const sorted = sortBlocksByKind(blocks);

      expect(sorted).toHaveLength(3);
      expect(sorted[0].meta.kind).toBe('pinned');
      expect(sorted[1].meta.kind).toBe('memory');
      expect(sorted[2].meta.kind).toBe('history');
    });

    it('should preserve relative order within same kind (stable sort)', () => {
      const blocks: ContextBlock<string>[] = [
        createBlock('hash1', 'memory', 'block 1'),
        createBlock('hash2', 'memory', 'block 2'),
        createBlock('hash3', 'memory', 'block 3'),
      ];

      const sorted = sortBlocksByKind(blocks);

      expect(sorted[0].blockHash).toBe('hash1');
      expect(sorted[1].blockHash).toBe('hash2');
      expect(sorted[2].blockHash).toBe('hash3');
    });

    it('should not mutate original array', () => {
      const blocks: ContextBlock<string>[] = [
        createBlock('hash2', 'history', 'block 2'),
        createBlock('hash1', 'pinned', 'block 1'),
      ];

      const originalOrder = blocks.map((b) => b.blockHash);
      const sorted = sortBlocksByKind(blocks);

      // Original should be unchanged
      expect(blocks.map((b) => b.blockHash)).toEqual(originalOrder);
      // Sorted should be different
      expect(sorted.map((b) => b.blockHash)).toEqual(['hash1', 'hash2']);
    });

    it('should handle empty array', () => {
      const sorted = sortBlocksByKind([]);

      expect(sorted).toEqual([]);
    });

    it('should handle single block', () => {
      const blocks = [createBlock('hash1', 'pinned', 'block 1')];
      const sorted = sortBlocksByKind(blocks);

      expect(sorted).toHaveLength(1);
      expect(sorted[0].blockHash).toBe('hash1');
    });

    it('should sort all kinds correctly', () => {
      const blocks: ContextBlock<string>[] = [
        createBlock('hash7', 'turn', 'block 7'),
        createBlock('hash5', 'tool_output', 'block 5'),
        createBlock('hash3', 'memory', 'block 3'),
        createBlock('hash1', 'pinned', 'block 1'),
        createBlock('hash6', 'history', 'block 6'),
        createBlock('hash4', 'state', 'block 4'),
        createBlock('hash2', 'reference', 'block 2'),
      ];

      const sorted = sortBlocksByKind(blocks);

      expect(sorted.map((b) => b.meta.kind)).toEqual([
        'pinned',
        'reference',
        'memory',
        'state',
        'tool_output',
        'history',
        'turn',
      ]);
    });
  });

  describe('validateBlockOrder', () => {
    it('should pass for correctly ordered blocks', () => {
      const blocks: ContextBlock<string>[] = [
        createBlock('hash1', 'pinned', 'block 1'),
        createBlock('hash2', 'memory', 'block 2'),
        createBlock('hash3', 'history', 'block 3'),
      ];

      expect(() => validateBlockOrder(blocks)).not.toThrow();
    });

    it('should pass for blocks of same kind', () => {
      const blocks: ContextBlock<string>[] = [
        createBlock('hash1', 'memory', 'block 1'),
        createBlock('hash2', 'memory', 'block 2'),
        createBlock('hash3', 'memory', 'block 3'),
      ];

      expect(() => validateBlockOrder(blocks)).not.toThrow();
    });

    it('should throw for incorrectly ordered blocks', () => {
      const blocks: ContextBlock<string>[] = [
        createBlock('hash1', 'memory', 'block 1'),
        createBlock('hash2', 'pinned', 'block 2'), // Wrong order!
      ];

      expect(() => validateBlockOrder(blocks)).toThrow(
        'Blocks not sorted by KIND_ORDER'
      );
    });

    it('should throw with descriptive error message', () => {
      const blocks: ContextBlock<string>[] = [
        createBlock('hash1', 'history', 'block 1'),
        createBlock('hash2', 'memory', 'block 2'),
      ];

      expect(() => validateBlockOrder(blocks)).toThrow(
        'history (index 0) comes before memory (index 1)'
      );
    });

    it('should pass for empty array', () => {
      expect(() => validateBlockOrder([])).not.toThrow();
    });

    it('should pass for single block', () => {
      const blocks = [createBlock('hash1', 'pinned', 'block 1')];

      expect(() => validateBlockOrder(blocks)).not.toThrow();
    });
  });

  describe('groupBlocksByKind', () => {
    it('should group blocks by kind', () => {
      const blocks: ContextBlock<string>[] = [
        createBlock('hash1', 'pinned', 'block 1'),
        createBlock('hash2', 'memory', 'block 2'),
        createBlock('hash3', 'pinned', 'block 3'),
        createBlock('hash4', 'history', 'block 4'),
      ];

      const groups = groupBlocksByKind(blocks);

      expect(groups.size).toBe(3);
      expect(groups.get('pinned')).toHaveLength(2);
      expect(groups.get('memory')).toHaveLength(1);
      expect(groups.get('history')).toHaveLength(1);
    });

    it('should preserve block order within groups', () => {
      const blocks: ContextBlock<string>[] = [
        createBlock('hash1', 'memory', 'block 1'),
        createBlock('hash2', 'memory', 'block 2'),
        createBlock('hash3', 'memory', 'block 3'),
      ];

      const groups = groupBlocksByKind(blocks);
      const memoryBlocks = groups.get('memory')!;

      expect(memoryBlocks.map((b) => b.blockHash)).toEqual([
        'hash1',
        'hash2',
        'hash3',
      ]);
    });

    it('should handle empty array', () => {
      const groups = groupBlocksByKind([]);

      expect(groups.size).toBe(0);
    });

    it('should handle single kind', () => {
      const blocks: ContextBlock<string>[] = [
        createBlock('hash1', 'pinned', 'block 1'),
        createBlock('hash2', 'pinned', 'block 2'),
      ];

      const groups = groupBlocksByKind(blocks);

      expect(groups.size).toBe(1);
      expect(groups.get('pinned')).toHaveLength(2);
    });
  });

  describe('isValidKind', () => {
    it('should return true for valid kinds', () => {
      expect(isValidKind('pinned')).toBe(true);
      expect(isValidKind('reference')).toBe(true);
      expect(isValidKind('memory')).toBe(true);
      expect(isValidKind('state')).toBe(true);
      expect(isValidKind('tool_output')).toBe(true);
      expect(isValidKind('history')).toBe(true);
      expect(isValidKind('turn')).toBe(true);
    });

    it('should return false for invalid kinds', () => {
      expect(isValidKind('invalid')).toBe(false);
      expect(isValidKind('')).toBe(false);
      expect(isValidKind('PINNED')).toBe(false);
      expect(isValidKind('tool-output')).toBe(false);
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
