/**
 * Unit tests for token estimators.
 *
 * Tests AnthropicTokenEstimator, OpenAITokenEstimator, GeminiTokenEstimator.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  heuristicTokenCount,
  serializeBlockForEstimation,
  LOW_CONFIDENCE_MULTIPLIER,
} from '../adapters/token-estimator.js';
import { OpenAITokenEstimator } from '../adapters/openai-estimator.js';
import { GeminiTokenEstimator } from '../adapters/gemini-estimator.js';
import type { ContextBlock } from '../types/block.js';

describe('Token Estimator', () => {
  describe('heuristicTokenCount', () => {
    it('should estimate tokens using chars/4 with multiplier', () => {
      const text = 'a'.repeat(100); // 100 chars
      const tokens = heuristicTokenCount(text);

      // Expected: (100 / 4) * 1.2 = 30
      expect(tokens).toBe(30);
    });

    it('should round up fractional tokens', () => {
      const text = 'a'.repeat(7); // 7 chars
      const tokens = heuristicTokenCount(text);

      // Expected: ceil((7 / 4) * 1.2) = ceil(2.1) = 3
      expect(tokens).toBe(3);
    });

    it('should apply safety multiplier', () => {
      const text = 'a'.repeat(40); // 40 chars

      const tokens = heuristicTokenCount(text);

      // Without multiplier: 40 / 4 = 10
      // With multiplier: 10 * 1.2 = 12
      expect(tokens).toBe(12);
    });

    it('should handle empty string', () => {
      expect(heuristicTokenCount('')).toBe(0);
    });

    it('should handle long text', () => {
      const text = 'a'.repeat(10000);
      const tokens = heuristicTokenCount(text);

      // Expected: (10000 / 4) * 1.2 = 3000
      expect(tokens).toBe(3000);
    });
  });

  describe('serializeBlockForEstimation', () => {
    it('should serialize payload as JSON', () => {
      const block: ContextBlock<any> = {
        blockHash: 'test',
        meta: {
          kind: 'pinned',
          sensitivity: 'public',
          codecId: 'test',
          codecVersion: '1.0.0',
          createdAt: Date.now(),
        },
        payload: { text: 'Hello, world!' },
      };

      const serialized = serializeBlockForEstimation(block);

      expect(serialized).toBe('{"text":"Hello, world!"}');
    });

    it('should handle complex payloads', () => {
      const block: ContextBlock<any> = {
        blockHash: 'test',
        meta: {
          kind: 'memory',
          sensitivity: 'public',
          codecId: 'test',
          codecVersion: '1.0.0',
          createdAt: Date.now(),
        },
        payload: {
          nested: {
            array: [1, 2, 3],
            text: 'test',
          },
        },
      };

      const serialized = serializeBlockForEstimation(block);

      expect(serialized).toContain('"nested"');
      expect(serialized).toContain('"array"');
    });
  });

  describe('OpenAITokenEstimator', () => {
    it('should create estimator with model', () => {
      const estimator = new OpenAITokenEstimator('gpt-4');

      expect(estimator).toBeDefined();
    });

    it('should estimate block tokens with high confidence', async () => {
      const estimator = new OpenAITokenEstimator('gpt-4');

      const block: ContextBlock<any> = {
        blockHash: 'test',
        meta: {
          kind: 'pinned',
          sensitivity: 'public',
          codecId: 'test',
          codecVersion: '1.0.0',
          createdAt: Date.now(),
        },
        payload: { text: 'Hello, world!' },
      };

      const estimate = await estimator.estimateBlock(block);

      expect(estimate.tokens).toBeGreaterThan(0);
      expect(estimate.confidence).toBe('high'); // tiktoken-based
    });

    it('should estimate multiple blocks', async () => {
      const estimator = new OpenAITokenEstimator('gpt-4');

      const blocks: ContextBlock<any>[] = [
        {
          blockHash: 'test1',
          meta: {
            kind: 'pinned',
            sensitivity: 'public',
            codecId: 'test',
            codecVersion: '1.0.0',
            createdAt: Date.now(),
          },
          payload: { text: 'Block 1' },
        },
        {
          blockHash: 'test2',
          meta: {
            kind: 'memory',
            sensitivity: 'public',
            codecId: 'test',
            codecVersion: '1.0.0',
            createdAt: Date.now(),
          },
          payload: { text: 'Block 2' },
        },
      ];

      const estimate = await estimator.estimate(blocks);

      expect(estimate.tokens).toBeGreaterThan(0);
      expect(estimate.confidence).toBe('high');
    });

    it('should return zero tokens for empty array', async () => {
      const estimator = new OpenAITokenEstimator('gpt-4');

      const estimate = await estimator.estimate([]);

      expect(estimate.tokens).toBe(0);
      expect(estimate.confidence).toBe('high');
    });

    it('should estimate different token counts for different content', async () => {
      const estimator = new OpenAITokenEstimator('gpt-4');

      const block1: ContextBlock<any> = {
        blockHash: 'test1',
        meta: {
          kind: 'pinned',
          sensitivity: 'public',
          codecId: 'test',
          codecVersion: '1.0.0',
          createdAt: Date.now(),
        },
        payload: { text: 'Short' },
      };

      const block2: ContextBlock<any> = {
        blockHash: 'test2',
        meta: {
          kind: 'pinned',
          sensitivity: 'public',
          codecId: 'test',
          codecVersion: '1.0.0',
          createdAt: Date.now(),
        },
        payload: { text: 'This is a much longer text with many more tokens' },
      };

      const estimate1 = await estimator.estimateBlock(block1);
      const estimate2 = await estimator.estimateBlock(block2);

      expect(estimate2.tokens).toBeGreaterThan(estimate1.tokens);
    });
  });

  describe('GeminiTokenEstimator', () => {
    it('should create estimator', () => {
      const estimator = new GeminiTokenEstimator();

      expect(estimator).toBeDefined();
    });

    it('should estimate block tokens with high confidence', async () => {
      const estimator = new GeminiTokenEstimator();

      const block: ContextBlock<any> = {
        blockHash: 'test',
        meta: {
          kind: 'pinned',
          sensitivity: 'public',
          codecId: 'test',
          codecVersion: '1.0.0',
          createdAt: Date.now(),
        },
        payload: { text: 'Hello, Gemini!' },
      };

      const estimate = await estimator.estimateBlock(block);

      expect(estimate.tokens).toBeGreaterThan(0);
      expect(estimate.confidence).toBe('high'); // tiktoken-based
    });

    it('should estimate multiple blocks', async () => {
      const estimator = new GeminiTokenEstimator();

      const blocks: ContextBlock<any>[] = [
        {
          blockHash: 'test1',
          meta: {
            kind: 'pinned',
            sensitivity: 'public',
            codecId: 'test',
            codecVersion: '1.0.0',
            createdAt: Date.now(),
          },
          payload: { text: 'Block 1' },
        },
        {
          blockHash: 'test2',
          meta: {
            kind: 'memory',
            sensitivity: 'public',
            codecId: 'test',
            codecVersion: '1.0.0',
            createdAt: Date.now(),
          },
          payload: { text: 'Block 2' },
        },
      ];

      const estimate = await estimator.estimate(blocks);

      expect(estimate.tokens).toBeGreaterThan(0);
      expect(estimate.confidence).toBe('high');
    });

    it('should return zero tokens for empty array', async () => {
      const estimator = new GeminiTokenEstimator();

      const estimate = await estimator.estimate([]);

      expect(estimate.tokens).toBe(0);
      expect(estimate.confidence).toBe('high');
    });
  });

  describe('Confidence levels', () => {
    it('should use correct confidence for OpenAI tiktoken', async () => {
      const estimator = new OpenAITokenEstimator('gpt-4');

      const block: ContextBlock<any> = {
        blockHash: 'test',
        meta: {
          kind: 'pinned',
          sensitivity: 'public',
          codecId: 'test',
          codecVersion: '1.0.0',
          createdAt: Date.now(),
        },
        payload: { text: 'Test' },
      };

      const estimate = await estimator.estimateBlock(block);

      expect(estimate.confidence).toBe('high');
    });

    it('should use correct confidence for Gemini tiktoken', async () => {
      const estimator = new GeminiTokenEstimator();

      const block: ContextBlock<any> = {
        blockHash: 'test',
        meta: {
          kind: 'pinned',
          sensitivity: 'public',
          codecId: 'test',
          codecVersion: '1.0.0',
          createdAt: Date.now(),
        },
        payload: { text: 'Test' },
      };

      const estimate = await estimator.estimateBlock(block);

      expect(estimate.confidence).toBe('high');
    });
  });

  describe('LOW_CONFIDENCE_MULTIPLIER', () => {
    it('should be 1.2 for safety', () => {
      expect(LOW_CONFIDENCE_MULTIPLIER).toBe(1.2);
    });
  });
});
