/**
 * Integration tests for Phase 2: Context Graph & Token Estimation
 */

import { describe, it, expect } from 'vitest';
import { ContextGraph } from '../graph/context-graph.js';
import type { ContextBlock } from '../types/block.js';
import type { BlockQuery } from '../graph/queries.js';
import { OpenAITokenEstimator } from '../adapters/openai-estimator.js';

describe('Phase 2 Integration', () => {
  describe('ContextGraph', () => {
    it('should add and retrieve blocks', () => {
      const graph = new ContextGraph();

      const block: ContextBlock<string> = {
        blockHash: 'hash1',
        meta: {
          kind: 'pinned',
          sensitivity: 'public',
          codecId: 'test',
          codecVersion: '1.0.0',
          createdAt: Date.now(),
        },
        payload: 'test content',
      };

      graph.addBlock(block);

      expect(graph.hasBlock('hash1')).toBe(true);
      expect(graph.getBlock('hash1')).toEqual(block);
      expect(graph.getBlockCount()).toBe(1);
    });

    it('should track derivation edges', () => {
      const graph = new ContextGraph();

      const parent: ContextBlock<string> = {
        blockHash: 'parent',
        meta: {
          kind: 'pinned',
          sensitivity: 'public',
          codecId: 'test',
          codecVersion: '1.0.0',
          createdAt: Date.now(),
        },
        payload: 'parent content',
      };

      const child: ContextBlock<string> = {
        blockHash: 'child',
        meta: {
          kind: 'memory',
          sensitivity: 'public',
          codecId: 'test',
          codecVersion: '1.0.0',
          createdAt: Date.now(),
        },
        payload: 'child content',
      };

      graph.addBlock(parent);
      graph.addBlock(child, [{ blockHash: 'parent' }]);

      const derivedFrom = graph.getDerivedFrom('child');
      expect(derivedFrom).toHaveLength(1);
      expect(derivedFrom[0].blockHash).toBe('parent');
    });

    it('should select blocks by query', () => {
      const graph = new ContextGraph();

      const block1: ContextBlock<string> = {
        blockHash: 'hash1',
        meta: {
          kind: 'pinned',
          sensitivity: 'public',
          codecId: 'test',
          codecVersion: '1.0.0',
          createdAt: Date.now(),
          tags: ['important'],
        },
        payload: 'block 1',
      };

      const block2: ContextBlock<string> = {
        blockHash: 'hash2',
        meta: {
          kind: 'memory',
          sensitivity: 'internal',
          codecId: 'test',
          codecVersion: '1.0.0',
          createdAt: Date.now(),
          tags: ['memory'],
        },
        payload: 'block 2',
      };

      graph.addBlock(block1);
      graph.addBlock(block2);

      // Query by kind
      const pinnedBlocks = graph.select({ kinds: ['pinned'] });
      expect(pinnedBlocks).toHaveLength(1);
      expect(pinnedBlocks[0].blockHash).toBe('hash1');

      // Query by tags
      const taggedBlocks = graph.select({ tags: ['memory'] });
      expect(taggedBlocks).toHaveLength(1);
      expect(taggedBlocks[0].blockHash).toBe('hash2');

      // Query by sensitivity
      const publicBlocks = graph.select({ maxSensitivity: 'public' });
      expect(publicBlocks).toHaveLength(1);
      expect(publicBlocks[0].blockHash).toBe('hash1');
    });
  });

  describe('ContextView', () => {
    it('should create deterministically ordered view', async () => {
      const graph = new ContextGraph();

      // Add blocks in random order
      const blocks: ContextBlock<string>[] = [
        {
          blockHash: 'hash-history',
          meta: {
            kind: 'history',
            sensitivity: 'public',
            codecId: 'test',
            codecVersion: '1.0.0',
            createdAt: Date.now(),
          },
          payload: 'history',
        },
        {
          blockHash: 'hash-pinned',
          meta: {
            kind: 'pinned',
            sensitivity: 'public',
            codecId: 'test',
            codecVersion: '1.0.0',
            createdAt: Date.now(),
          },
          payload: 'pinned',
        },
        {
          blockHash: 'hash-memory',
          meta: {
            kind: 'memory',
            sensitivity: 'public',
            codecId: 'test',
            codecVersion: '1.0.0',
            createdAt: Date.now(),
          },
          payload: 'memory',
        },
      ];

      blocks.forEach((block) => graph.addBlock(block));

      const view = await graph.createView({});

      // Verify KIND_ORDER (pinned → reference → memory → state → tool_output → history → turn)
      expect(view.blocks).toHaveLength(3);
      expect(view.blocks[0].meta.kind).toBe('pinned');
      expect(view.blocks[1].meta.kind).toBe('memory');
      expect(view.blocks[2].meta.kind).toBe('history');

      // Verify stable prefix hash is computed
      expect(view.stablePrefixHash).toBeDefined();
      expect(view.stablePrefixHash.length).toBeGreaterThan(0);
    });

    it('should apply token budget', async () => {
      const graph = new ContextGraph();

      // Add blocks
      const blocks: ContextBlock<string>[] = [
        {
          blockHash: 'hash1',
          meta: {
            kind: 'pinned',
            sensitivity: 'public',
            codecId: 'test',
            codecVersion: '1.0.0',
            createdAt: Date.now(),
          },
          payload: 'a'.repeat(100), // ~25 tokens
        },
        {
          blockHash: 'hash2',
          meta: {
            kind: 'memory',
            sensitivity: 'public',
            codecId: 'test',
            codecVersion: '1.0.0',
            createdAt: Date.now(),
          },
          payload: 'b'.repeat(100), // ~25 tokens
        },
        {
          blockHash: 'hash3',
          meta: {
            kind: 'history',
            sensitivity: 'public',
            codecId: 'test',
            codecVersion: '1.0.0',
            createdAt: Date.now(),
          },
          payload: 'c'.repeat(100), // ~25 tokens
        },
      ];

      blocks.forEach((block) => graph.addBlock(block));

      // Create view with token budget
      const estimator = new OpenAITokenEstimator('gpt-4');
      const view = await graph.createView({
        tokenEstimator: estimator,
        maxTokens: 50, // Only first 2 blocks should fit
      });

      // Verify truncation
      expect(view.tokenEstimate).toBeDefined();
      expect(view.tokenEstimate!.truncated).toBe(true);
      expect(view.blocks.length).toBeLessThan(3);
    });
  });

  describe('TokenEstimator', () => {
    it('should estimate tokens using OpenAI estimator', async () => {
      const estimator = new OpenAITokenEstimator('gpt-4');

      const block: ContextBlock<string> = {
        blockHash: 'hash1',
        meta: {
          kind: 'pinned',
          sensitivity: 'public',
          codecId: 'test',
          codecVersion: '1.0.0',
          createdAt: Date.now(),
        },
        payload: 'Hello, world!',
      };

      const estimate = await estimator.estimateBlock(block);

      expect(estimate.tokens).toBeGreaterThan(0);
      expect(estimate.confidence).toBe('high');
    });
  });
});
