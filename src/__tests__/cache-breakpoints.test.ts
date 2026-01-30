/**
 * Unit tests for Anthropic cache breakpoint resolution.
 *
 * Tests:
 * - "After last matching block" rule
 * - Selector matching (kind, codecId, tag, source)
 * - Diagnostics for no matches / many matches
 * - Cache control placement in system messages
 */

import { describe, it, expect } from 'vitest';
import { compileAnthropicContext } from '../providers/anthropic-compiler.js';
import type { ContextBlock } from '../types/block.js';
import type { ContextPolicy } from '../types/policy.js';
import type { BlockCodec } from '../types/codec.js';

// Mock codec for testing
const mockCodec: BlockCodec<any> = {
  codecId: 'test-codec',
  version: '1.0.0',
  payloadSchema: null as any,
  canonicalize: (payload) => payload,
  hash: (canon) => 'test-hash',
  validate: (payload) => payload,
  render: (block) => ({
    anthropic: [{ type: 'text', text: JSON.stringify(block.payload) }],
    openai: { role: 'system', content: JSON.stringify(block.payload) },
    gemini: JSON.stringify(block.payload),
  }),
};

describe('Anthropic Cache Breakpoints', () => {
  describe('Cache Breakpoint Resolution', () => {
    it('should resolve to last matching block by kind', () => {
      const blocks: ContextBlock[] = [
        createBlock('hash1', 'pinned', 'block1'),
        createBlock('hash2', 'pinned', 'block2'),
        createBlock('hash3', 'pinned', 'block3'),
      ];

      const codecRegistry = new Map([['test-codec', mockCodec]]);

      const result = compileAnthropicContext(
        blocks,
        createTestPolicy(),
        {
          codecRegistry,
          cacheBreakpoint: { kind: 'pinned' },
        }
      );

      // Cache control should be on last pinned block (index 2)
      const systemMessages = result.system!;
      expect(systemMessages).toHaveLength(3);
      expect(systemMessages[0].cache_control).toBeUndefined();
      expect(systemMessages[1].cache_control).toBeUndefined();
      expect(systemMessages[2].cache_control).toEqual({ type: 'ephemeral' });
    });

    it('should resolve to last matching block by codecId', () => {
      const blocks: ContextBlock[] = [
        createBlockWithCodec('hash1', 'pinned', 'codec-a', 'block1'),
        createBlockWithCodec('hash2', 'pinned', 'codec-b', 'block2'),
        createBlockWithCodec('hash3', 'pinned', 'codec-a', 'block3'),
      ];

      const codecA = { ...mockCodec, codecId: 'codec-a' };
      const codecB = { ...mockCodec, codecId: 'codec-b' };
      const codecRegistry = new Map([
        ['codec-a', codecA],
        ['codec-b', codecB],
      ]);

      const result = compileAnthropicContext(
        blocks,
        createTestPolicy(),
        {
          codecRegistry,
          cacheBreakpoint: { codecId: 'codec-a' },
        }
      );

      // Cache control should be on last codec-a block (index 2)
      const systemMessages = result.system!;
      expect(systemMessages[2].cache_control).toEqual({ type: 'ephemeral' });
    });

    it('should resolve to last matching block by tag', () => {
      const blocks: ContextBlock[] = [
        createBlockWithTags('hash1', 'pinned', ['tag1'], 'block1'),
        createBlockWithTags('hash2', 'pinned', ['tag2'], 'block2'),
        createBlockWithTags('hash3', 'pinned', ['tag1', 'tag2'], 'block3'),
      ];

      const codecRegistry = new Map([['test-codec', mockCodec]]);

      const result = compileAnthropicContext(
        blocks,
        createTestPolicy(),
        {
          codecRegistry,
          cacheBreakpoint: { tag: 'tag1' },
        }
      );

      // Cache control should be on last block with tag1 (index 2)
      const systemMessages = result.system!;
      expect(systemMessages[2].cache_control).toEqual({ type: 'ephemeral' });
    });

    it('should resolve to last matching block by source', () => {
      const blocks: ContextBlock[] = [
        createBlockWithSource('hash1', 'pinned', 'source-a', 'block1'),
        createBlockWithSource('hash2', 'pinned', 'source-b', 'block2'),
        createBlockWithSource('hash3', 'pinned', 'source-a', 'block3'),
      ];

      const codecRegistry = new Map([['test-codec', mockCodec]]);

      const result = compileAnthropicContext(
        blocks,
        createTestPolicy(),
        {
          codecRegistry,
          cacheBreakpoint: { source: 'source-a' },
        }
      );

      // Cache control should be on last source-a block (index 2)
      const systemMessages = result.system!;
      expect(systemMessages[2].cache_control).toEqual({ type: 'ephemeral' });
    });

    it('should match blocks with multiple criteria (AND logic)', () => {
      const blocks: ContextBlock[] = [
        createBlockWithDetails('hash1', 'pinned', 'codec-a', ['tag1'], 'source-a', 'block1'),
        createBlockWithDetails('hash2', 'pinned', 'codec-a', ['tag2'], 'source-a', 'block2'),
        createBlockWithDetails('hash3', 'pinned', 'codec-a', ['tag1'], 'source-b', 'block3'),
        createBlockWithDetails('hash4', 'pinned', 'codec-a', ['tag1'], 'source-a', 'block4'),
      ];

      const codecRegistry = new Map([['codec-a', mockCodec]]);

      const result = compileAnthropicContext(
        blocks,
        createTestPolicy(),
        {
          codecRegistry,
          cacheBreakpoint: {
            kind: 'pinned',
            codecId: 'codec-a',
            tag: 'tag1',
            source: 'source-a',
          },
        }
      );

      // Only hash1 and hash4 match all criteria, cache control on hash4 (last)
      const systemMessages = result.system!;
      expect(systemMessages[3].cache_control).toEqual({ type: 'ephemeral' });
    });
  });

  describe('No Matches', () => {
    it('should not add cache_control when no blocks match', () => {
      const blocks: ContextBlock[] = [
        createBlock('hash1', 'pinned', 'block1'),
        createBlock('hash2', 'pinned', 'block2'),
      ];

      const codecRegistry = new Map([['test-codec', mockCodec]]);

      const result = compileAnthropicContext(
        blocks,
        createTestPolicy(),
        {
          codecRegistry,
          cacheBreakpoint: { kind: 'memory' }, // No memory blocks
        }
      );

      // No cache_control on any block
      const systemMessages = result.system!;
      expect(systemMessages.every((m) => !m.cache_control)).toBe(true);
    });

    it('should handle empty blocks array', () => {
      const blocks: ContextBlock[] = [];
      const codecRegistry = new Map([['test-codec', mockCodec]]);

      const result = compileAnthropicContext(
        blocks,
        createTestPolicy(),
        {
          codecRegistry,
          cacheBreakpoint: { kind: 'pinned' },
        }
      );

      expect(result.system).toBeUndefined();
    });
  });

  describe('No Cache Breakpoint', () => {
    it('should not add cache_control when no breakpoint provided', () => {
      const blocks: ContextBlock[] = [
        createBlock('hash1', 'pinned', 'block1'),
        createBlock('hash2', 'pinned', 'block2'),
      ];

      const codecRegistry = new Map([['test-codec', mockCodec]]);

      const result = compileAnthropicContext(
        blocks,
        createTestPolicy(),
        {
          codecRegistry,
          // No cacheBreakpoint
        }
      );

      const systemMessages = result.system!;
      expect(systemMessages.every((m) => !m.cache_control)).toBe(true);
    });
  });

  describe('System vs Message Blocks', () => {
    it('should only apply cache control to system blocks (pinned)', () => {
      const blocks: ContextBlock[] = [
        createBlock('hash1', 'pinned', 'system1'),
        createBlock('hash2', 'pinned', 'system2'),
        createBlock('hash3', 'memory', 'memory1'), // Not pinned
        createBlock('hash4', 'history', 'history1'), // Not pinned
      ];

      const codecRegistry = new Map([['test-codec', mockCodec]]);

      const result = compileAnthropicContext(
        blocks,
        createTestPolicy(),
        {
          codecRegistry,
          cacheBreakpoint: { kind: 'pinned' },
        }
      );

      // Only system messages should have cache_control possibility
      expect(result.system).toHaveLength(2);
      expect(result.messages).toHaveLength(2);
      expect(result.system![1].cache_control).toEqual({ type: 'ephemeral' });
    });

    it('should not add cache control to non-pinned blocks', () => {
      const blocks: ContextBlock[] = [
        createBlock('hash1', 'memory', 'memory1'),
        createBlock('hash2', 'history', 'history1'),
      ];

      const codecRegistry = new Map([['test-codec', mockCodec]]);

      const result = compileAnthropicContext(
        blocks,
        createTestPolicy(),
        {
          codecRegistry,
          cacheBreakpoint: { kind: 'memory' },
        }
      );

      // No system blocks, so no cache control
      expect(result.system).toBeUndefined();
      expect(result.messages).toHaveLength(2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle single matching block', () => {
      const blocks: ContextBlock[] = [
        createBlock('hash1', 'pinned', 'block1'),
      ];

      const codecRegistry = new Map([['test-codec', mockCodec]]);

      const result = compileAnthropicContext(
        blocks,
        createTestPolicy(),
        {
          codecRegistry,
          cacheBreakpoint: { kind: 'pinned' },
        }
      );

      const systemMessages = result.system!;
      expect(systemMessages).toHaveLength(1);
      expect(systemMessages[0].cache_control).toEqual({ type: 'ephemeral' });
    });

    it('should handle many matching blocks (use last)', () => {
      const blocks: ContextBlock[] = Array.from({ length: 100 }, (_, i) =>
        createBlock(`hash${i}`, 'pinned', `block${i}`)
      );

      const codecRegistry = new Map([['test-codec', mockCodec]]);

      const result = compileAnthropicContext(
        blocks,
        createTestPolicy(),
        {
          codecRegistry,
          cacheBreakpoint: { kind: 'pinned' },
        }
      );

      // Cache control on last block
      const systemMessages = result.system!;
      expect(systemMessages).toHaveLength(100);
      expect(systemMessages[99].cache_control).toEqual({ type: 'ephemeral' });
      // All others should not have cache_control
      for (let i = 0; i < 99; i++) {
        expect(systemMessages[i].cache_control).toBeUndefined();
      }
    });

    it('should handle interleaved matching and non-matching blocks', () => {
      const blocks: ContextBlock[] = [
        createBlockWithCodec('hash1', 'pinned', 'codec-a', 'block1'),
        createBlockWithCodec('hash2', 'pinned', 'codec-b', 'block2'),
        createBlockWithCodec('hash3', 'pinned', 'codec-a', 'block3'),
        createBlockWithCodec('hash4', 'pinned', 'codec-b', 'block4'),
        createBlockWithCodec('hash5', 'pinned', 'codec-a', 'block5'),
      ];

      const codecA = { ...mockCodec, codecId: 'codec-a' };
      const codecB = { ...mockCodec, codecId: 'codec-b' };
      const codecRegistry = new Map([
        ['codec-a', codecA],
        ['codec-b', codecB],
      ]);

      const result = compileAnthropicContext(
        blocks,
        createTestPolicy(),
        {
          codecRegistry,
          cacheBreakpoint: { codecId: 'codec-a' },
        }
      );

      // Cache control on last codec-a block (index 4)
      const systemMessages = result.system!;
      expect(systemMessages[4].cache_control).toEqual({ type: 'ephemeral' });
    });
  });

  describe('Selector Combinations', () => {
    it('should match when kind AND codecId both match', () => {
      const blocks: ContextBlock[] = [
        createBlockWithCodec('hash1', 'pinned', 'codec-a', 'block1'),
        createBlockWithCodec('hash2', 'memory', 'codec-a', 'block2'), // Wrong kind
        createBlockWithCodec('hash3', 'pinned', 'codec-b', 'block3'), // Wrong codec
        createBlockWithCodec('hash4', 'pinned', 'codec-a', 'block4'), // Match
      ];

      const codecA = { ...mockCodec, codecId: 'codec-a' };
      const codecB = { ...mockCodec, codecId: 'codec-b' };
      const codecRegistry = new Map([
        ['codec-a', codecA],
        ['codec-b', codecB],
      ]);

      const result = compileAnthropicContext(
        blocks.filter((b) => b.meta.kind === 'pinned'), // Only pinned blocks become system messages
        createTestPolicy(),
        {
          codecRegistry,
          cacheBreakpoint: { kind: 'pinned', codecId: 'codec-a' },
        }
      );

      // hash1 and hash4 match, cache control on hash4 (last)
      const systemMessages = result.system!;
      // Only 3 pinned blocks: hash1, hash3, hash4
      expect(systemMessages).toHaveLength(3);
      expect(systemMessages[2].cache_control).toEqual({ type: 'ephemeral' });
    });

    it('should not match when only some criteria match', () => {
      const blocks: ContextBlock[] = [
        createBlockWithDetails('hash1', 'pinned', 'codec-a', ['tag1'], 'source-a', 'block1'),
        createBlockWithDetails('hash2', 'pinned', 'codec-a', ['tag2'], 'source-a', 'block2'),
      ];

      const codecRegistry = new Map([['codec-a', mockCodec]]);

      const result = compileAnthropicContext(
        blocks,
        createTestPolicy(),
        {
          codecRegistry,
          cacheBreakpoint: {
            codecId: 'codec-a',
            tag: 'tag1',
            source: 'source-b', // Doesn't match
          },
        }
      );

      // No blocks match all criteria
      const systemMessages = result.system!;
      expect(systemMessages.every((m) => !m.cache_control)).toBe(true);
    });
  });

  describe('Determinism', () => {
    it('should produce same cache placement for same input', () => {
      const blocks: ContextBlock[] = [
        createBlock('hash1', 'pinned', 'block1'),
        createBlock('hash2', 'pinned', 'block2'),
        createBlock('hash3', 'pinned', 'block3'),
      ];

      const codecRegistry = new Map([['test-codec', mockCodec]]);

      const result1 = compileAnthropicContext(
        blocks,
        createTestPolicy(),
        {
          codecRegistry,
          cacheBreakpoint: { kind: 'pinned' },
        }
      );

      const result2 = compileAnthropicContext(
        blocks,
        createTestPolicy(),
        {
          codecRegistry,
          cacheBreakpoint: { kind: 'pinned' },
        }
      );

      expect(result1.system).toEqual(result2.system);
    });
  });
});

// Test helpers

function createBlock(
  hash: string,
  kind: 'pinned' | 'memory' | 'history',
  payload: string
): ContextBlock {
  return {
    blockHash: hash,
    meta: {
      kind,
      sensitivity: 'public',
      codecId: 'test-codec',
      codecVersion: '1.0.0',
      createdAt: Date.now(),
    },
    payload,
  };
}

function createBlockWithCodec(
  hash: string,
  kind: 'pinned' | 'memory' | 'history',
  codecId: string,
  payload: string
): ContextBlock {
  return {
    blockHash: hash,
    meta: {
      kind,
      sensitivity: 'public',
      codecId,
      codecVersion: '1.0.0',
      createdAt: Date.now(),
    },
    payload,
  };
}

function createBlockWithTags(
  hash: string,
  kind: 'pinned' | 'memory' | 'history',
  tags: string[],
  payload: string
): ContextBlock {
  return {
    blockHash: hash,
    meta: {
      kind,
      sensitivity: 'public',
      codecId: 'test-codec',
      codecVersion: '1.0.0',
      createdAt: Date.now(),
      tags,
    },
    payload,
  };
}

function createBlockWithSource(
  hash: string,
  kind: 'pinned' | 'memory' | 'history',
  source: string,
  payload: string
): ContextBlock {
  return {
    blockHash: hash,
    meta: {
      kind,
      sensitivity: 'public',
      codecId: 'test-codec',
      codecVersion: '1.0.0',
      createdAt: Date.now(),
      source,
    },
    payload,
  };
}

function createBlockWithDetails(
  hash: string,
  kind: 'pinned' | 'memory' | 'history',
  codecId: string,
  tags: string[],
  source: string,
  payload: string
): ContextBlock {
  return {
    blockHash: hash,
    meta: {
      kind,
      sensitivity: 'public',
      codecId,
      codecVersion: '1.0.0',
      createdAt: Date.now(),
      tags,
      source,
    },
    payload,
  };
}

function createTestPolicy(): ContextPolicy {
  return {
    modelId: 'test-model',
    provider: 'anthropic',
    contextWindow: 100000,
    completionReserve: 4000,
    overflowStrategy: 'error',
    kindPriorities: [],
    sensitivity: {
      maxSensitivity: 'public',
      redactRestricted: true,
    },
    compaction: {
      pruneToolOutputs: false,
      summarizeHistory: false,
    },
  };
}
