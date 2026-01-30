/**
 * Unit tests for Compactor: tool output pruning and deduplication.
 *
 * Tests:
 * - Tool output pruning produces normalized shape
 * - Deduplication removes identical blockHash
 * - History trimming keeps recent + error messages
 * - Provenance metadata is preserved
 */

import { describe, it, expect } from 'vitest';
import { compactView, DEFAULT_TOOL_OUTPUT_PRUNING } from '../pipeline/compactor.js';
import type { ContextBlock } from '../types/block.js';
import type { ContextView } from '../graph/views.js';
import { heuristicTokenCount, serializeBlockForEstimation, type TokenEstimator, type TokenEstimate } from '../adapters/token-estimator.js';

// Mock token estimator for tests
class MockTokenEstimator implements TokenEstimator {
  async estimate(blocks: ContextBlock<unknown>[]): Promise<TokenEstimate> {
    const totalTokens = blocks.reduce((sum, block) => {
      const text = serializeBlockForEstimation(block);
      return sum + heuristicTokenCount(text);
    }, 0);
    return { tokens: totalTokens, confidence: 'low' };
  }

  async estimateBlock(block: ContextBlock<unknown>): Promise<TokenEstimate> {
    const text = serializeBlockForEstimation(block);
    return { tokens: heuristicTokenCount(text), confidence: 'low' };
  }
}

describe('Compactor', () => {
  describe('Deduplication', () => {
    it('should remove duplicate blocks by blockHash', async () => {
      const duplicateBlock: ContextBlock<string> = createBlock('hash1', 'memory', 'data');
      const blocks: ContextBlock[] = [
        duplicateBlock,
        duplicateBlock, // Duplicate
        createBlock('hash2', 'memory', 'other'),
      ];

      const view = createTestView(blocks);
      const estimator = new MockTokenEstimator();
      const result = await compactView(view, { steps: ['dedupe'] }, estimator);

      expect(result.blocks).toHaveLength(2);
      expect(result.removedBlocks).toHaveLength(1);
      expect(result.blocks.map((b) => b.blockHash)).toEqual(['hash1', 'hash2']);
    });

    it('should keep first occurrence of duplicate', async () => {
      const block1: ContextBlock<any> = createBlock('hash1', 'memory', 'first');
      const block2: ContextBlock<any> = createBlock('hash1', 'memory', 'duplicate');

      const view = createTestView([block1, block2]);
      const estimator = new MockTokenEstimator();
      const result = await compactView(view, { steps: ['dedupe'] }, estimator);

      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].payload).toBe('first');
    });

    it('should handle no duplicates', async () => {
      const blocks: ContextBlock[] = [
        createBlock('hash1', 'memory', 'data1'),
        createBlock('hash2', 'memory', 'data2'),
        createBlock('hash3', 'memory', 'data3'),
      ];

      const view = createTestView(blocks);
      const estimator = new MockTokenEstimator();
      const result = await compactView(view, { steps: ['dedupe'] }, estimator);

      expect(result.blocks).toHaveLength(3);
      expect(result.removedBlocks).toHaveLength(0);
    });

    it('should report dedupe step results', async () => {
      const duplicateBlock: ContextBlock<string> = createBlock('hash1', 'memory', 'data');
      const blocks: ContextBlock[] = [duplicateBlock, duplicateBlock, duplicateBlock];

      const view = createTestView(blocks);
      const estimator = new MockTokenEstimator();
      const result = await compactView(view, { steps: ['dedupe'] }, estimator);

      const dedupeReport = result.report.stepReports.find((r) => r.step === 'dedupe');
      expect(dedupeReport).toBeDefined();
      expect(dedupeReport!.blocksRemoved).toBe(2);
      expect(dedupeReport!.lossy).toBe(false);
    });
  });

  describe('Tool Output Pruning', () => {
    it('should truncate large tool outputs', async () => {
      const largeOutput = 'x'.repeat(1000);
      const block: ContextBlock<any> = createBlock('hash1', 'tool_output', {
        toolName: 'test_tool',
        output: largeOutput,
      });

      const view = createTestView([block]);
      const estimator = new MockTokenEstimator();
      const result = await compactView(view, {
        steps: ['tool_output_prune'],
        toolOutputPruning: {
          maxRawTailChars: 100,
          preserveErrorTail: true,
          maxOutputsPerTool: 3,
        },
      }, estimator);

      // Should have a replacement block
      expect(result.blocks).toHaveLength(1);
      const truncated = result.blocks[0].payload as any;

      expect(truncated._truncated).toBe(true);
      expect(truncated.output.length).toBeLessThan(largeOutput.length);
      expect(truncated.output).toContain('truncated');
    });

    it('should preserve error outputs even if large', async () => {
      const largeErrorOutput = 'error: ' + 'x'.repeat(1000);
      const block: ContextBlock<any> = createBlock('hash1', 'tool_output', {
        toolName: 'test_tool',
        output: largeErrorOutput,
        error: true,
      });

      const view = createTestView([block]);
      const estimator = new MockTokenEstimator();
      const result = await compactView(view, {
        steps: ['tool_output_prune'],
        toolOutputPruning: {
          maxRawTailChars: 100,
          preserveErrorTail: true, // Keep errors
          maxOutputsPerTool: 3,
        },
      }, estimator);

      // Should NOT be truncated because it's an error
      const output = result.blocks[0].payload as any;
      expect(output._truncated).toBeUndefined();
      expect(output.output).toBe(largeErrorOutput);
    });

    it('should keep only recent N outputs per tool', async () => {
      const blocks: ContextBlock<any>[] = [
        createToolOutputBlock('hash1', 'tool1', 'output1', 1000),
        createToolOutputBlock('hash2', 'tool1', 'output2', 2000),
        createToolOutputBlock('hash3', 'tool1', 'output3', 3000),
        createToolOutputBlock('hash4', 'tool1', 'output4', 4000),
        createToolOutputBlock('hash5', 'tool1', 'output5', 5000),
      ];

      const view = createTestView(blocks);
      const estimator = new MockTokenEstimator();
      const result = await compactView(view, {
        steps: ['tool_output_prune'],
        toolOutputPruning: {
          maxRawTailChars: 500,
          preserveErrorTail: true,
          maxOutputsPerTool: 3, // Keep last 3
        },
      }, estimator);

      // Should keep only 3 most recent
      expect(result.blocks).toHaveLength(3);
      expect(result.removedBlocks).toHaveLength(2);

      // Check that most recent are kept
      const hashes = result.blocks.map((b) => b.blockHash);
      expect(hashes).toContain('hash3');
      expect(hashes).toContain('hash4');
      expect(hashes).toContain('hash5');
    });

    it('should handle multiple tool types independently', async () => {
      const blocks: ContextBlock<any>[] = [
        createToolOutputBlock('hash1', 'tool1', 'output1', 1000),
        createToolOutputBlock('hash2', 'tool1', 'output2', 2000),
        createToolOutputBlock('hash3', 'tool2', 'output3', 3000),
        createToolOutputBlock('hash4', 'tool2', 'output4', 4000),
      ];

      const view = createTestView(blocks);
      const estimator = new MockTokenEstimator();
      const result = await compactView(view, {
        steps: ['tool_output_prune'],
        toolOutputPruning: {
          maxRawTailChars: 500,
          preserveErrorTail: true,
          maxOutputsPerTool: 1, // Keep 1 per tool
        },
      }, estimator);

      // Should keep 1 from each tool (most recent)
      expect(result.blocks).toHaveLength(2);
      expect(result.blocks.map((b) => b.blockHash).sort()).toEqual(['hash2', 'hash4']);
    });

    it('should preserve non-tool_output blocks', async () => {
      const blocks: ContextBlock<any>[] = [
        createBlock('hash1', 'pinned', 'system'),
        createToolOutputBlock('hash2', 'tool1', 'output1', 1000),
        createToolOutputBlock('hash3', 'tool1', 'output2', 2000),
        createBlock('hash4', 'memory', 'memory'),
      ];

      const view = createTestView(blocks);
      const estimator = new MockTokenEstimator();
      const result = await compactView(view, {
        steps: ['tool_output_prune'],
        toolOutputPruning: {
          maxRawTailChars: 500,
          preserveErrorTail: true,
          maxOutputsPerTool: 1,
        },
      }, estimator);

      // Should keep all non-tool_output blocks + 1 tool output
      expect(result.blocks).toHaveLength(3);
      const kinds = result.blocks.map((b) => b.meta.kind);
      expect(kinds).toContain('pinned');
      expect(kinds).toContain('memory');
      expect(kinds).toContain('tool_output');
    });

    it('should report pruning step results', async () => {
      const largeOutput = 'x'.repeat(1000);
      const block: ContextBlock<any> = createBlock('hash1', 'tool_output', {
        toolName: 'test_tool',
        output: largeOutput,
      });

      const view = createTestView([block]);
      const estimator = new MockTokenEstimator();
      const result = await compactView(view, {
        steps: ['tool_output_prune'],
      }, estimator);

      const pruneReport = result.report.stepReports.find(
        (r) => r.step === 'tool_output_prune'
      );
      expect(pruneReport).toBeDefined();
      expect(pruneReport!.blocksReplaced).toBeGreaterThan(0);
      expect(pruneReport!.lossy).toBe(true);
    });

    it('should use default config when not provided', async () => {
      const largeOutput = 'x'.repeat(1000);
      const block: ContextBlock<any> = createBlock('hash1', 'tool_output', {
        toolName: 'test_tool',
        output: largeOutput,
      });

      const view = createTestView([block]);
      const estimator = new MockTokenEstimator();
      const result = await compactView(view, {
        steps: ['tool_output_prune'],
        // No toolOutputPruning config - should use DEFAULT_TOOL_OUTPUT_PRUNING
      }, estimator);

      expect(result.blocks).toHaveLength(1);
      const truncated = result.blocks[0].payload as any;
      expect(truncated._truncated).toBe(true);
      // Default maxRawTailChars is 500
      expect(truncated.output.length).toBeLessThan(largeOutput.length);
    });
  });

  describe('History Trimming', () => {
    it('should keep recent N messages', async () => {
      const blocks: ContextBlock<any>[] = [
        createHistoryBlock('hash1', 1000),
        createHistoryBlock('hash2', 2000),
        createHistoryBlock('hash3', 3000),
        createHistoryBlock('hash4', 4000),
        createHistoryBlock('hash5', 5000),
      ];

      const view = createTestView(blocks);
      const estimator = new MockTokenEstimator();
      const result = await compactView(view, {
        steps: ['history_trim'],
        historyTrim: {
          keepRecentMessages: 2,
          keepErrorMessages: false,
        },
      }, estimator);

      // Should keep 2 most recent
      expect(result.blocks).toHaveLength(2);
      expect(result.blocks.map((b) => b.blockHash)).toEqual(['hash4', 'hash5']);
    });

    it('should preserve error messages', async () => {
      const blocks: ContextBlock<any>[] = [
        createHistoryBlock('hash1', 1000, { hasError: true }),
        createHistoryBlock('hash2', 2000, { hasError: false }),
        createHistoryBlock('hash3', 3000, { hasError: false }),
        createHistoryBlock('hash4', 4000, { hasError: false }),
      ];

      const view = createTestView(blocks);
      const estimator = new MockTokenEstimator();
      const result = await compactView(view, {
        steps: ['history_trim'],
        historyTrim: {
          keepRecentMessages: 2, // Keep hash3, hash4
          keepErrorMessages: true, // Also keep hash1 (error)
        },
      }, estimator);

      // Should keep 2 recent + 1 error
      expect(result.blocks).toHaveLength(3);
      const hashes = result.blocks.map((b) => b.blockHash);
      expect(hashes).toContain('hash1'); // Error message
      expect(hashes).toContain('hash3'); // Recent
      expect(hashes).toContain('hash4'); // Recent
    });

    it('should not remove error messages when keepErrorMessages is false', async () => {
      const blocks: ContextBlock<any>[] = [
        createHistoryBlock('hash1', 1000, { hasError: true }),
        createHistoryBlock('hash2', 2000, { hasError: false }),
        createHistoryBlock('hash3', 3000, { hasError: false }),
      ];

      const view = createTestView(blocks);
      const estimator = new MockTokenEstimator();
      const result = await compactView(view, {
        steps: ['history_trim'],
        historyTrim: {
          keepRecentMessages: 1,
          keepErrorMessages: false,
        },
      }, estimator);

      // Should only keep 1 most recent (hash3)
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].blockHash).toBe('hash3');
    });

    it('should preserve non-history blocks', async () => {
      const blocks: ContextBlock<any>[] = [
        createBlock('hash1', 'pinned', 'system'),
        createHistoryBlock('hash2', 1000),
        createHistoryBlock('hash3', 2000),
        createBlock('hash4', 'memory', 'memory'),
      ];

      const view = createTestView(blocks);
      const estimator = new MockTokenEstimator();
      const result = await compactView(view, {
        steps: ['history_trim'],
        historyTrim: {
          keepRecentMessages: 1,
          keepErrorMessages: false,
        },
      }, estimator);

      // Should keep all non-history + 1 history
      expect(result.blocks).toHaveLength(3);
      const kinds = result.blocks.map((b) => b.meta.kind);
      expect(kinds).toContain('pinned');
      expect(kinds).toContain('memory');
      expect(kinds).toContain('history');
    });

    it('should handle no history blocks', async () => {
      const blocks: ContextBlock<any>[] = [
        createBlock('hash1', 'pinned', 'system'),
        createBlock('hash2', 'memory', 'memory'),
      ];

      const view = createTestView(blocks);
      const estimator = new MockTokenEstimator();
      const result = await compactView(view, {
        steps: ['history_trim'],
      }, estimator);

      expect(result.blocks).toHaveLength(2);
      expect(result.removedBlocks).toHaveLength(0);
    });

    it('should report trimming step results', async () => {
      const blocks: ContextBlock<any>[] = [
        createHistoryBlock('hash1', 1000),
        createHistoryBlock('hash2', 2000),
        createHistoryBlock('hash3', 3000),
      ];

      const view = createTestView(blocks);
      const estimator = new MockTokenEstimator();
      const result = await compactView(view, {
        steps: ['history_trim'],
        historyTrim: {
          keepRecentMessages: 1,
          keepErrorMessages: false,
        },
      }, estimator);

      const trimReport = result.report.stepReports.find(
        (r) => r.step === 'history_trim'
      );
      expect(trimReport).toBeDefined();
      expect(trimReport!.blocksRemoved).toBe(2);
      expect(trimReport!.lossy).toBe(true);
    });
  });

  describe('Multiple Steps', () => {
    it('should apply steps in order', async () => {
      const duplicate: ContextBlock<string> = createBlock('hash1', 'memory', 'data');
      const blocks: ContextBlock<any>[] = [
        duplicate,
        duplicate, // Will be removed by dedupe
        createToolOutputBlock('hash2', 'tool1', 'x'.repeat(1000), 1000), // Will be truncated
        createHistoryBlock('hash3', 1000), // Will be trimmed
        createHistoryBlock('hash4', 2000),
      ];

      const view = createTestView(blocks);
      const estimator = new MockTokenEstimator();
      const result = await compactView(view, {
        steps: ['dedupe', 'tool_output_prune', 'history_trim'],
        toolOutputPruning: {
          maxRawTailChars: 100,
          preserveErrorTail: true,
          maxOutputsPerTool: 3,
        },
        historyTrim: {
          keepRecentMessages: 1,
          keepErrorMessages: false,
        },
      }, estimator);

      expect(result.report.stepsApplied).toEqual([
        'dedupe',
        'tool_output_prune',
        'history_trim',
      ]);
      expect(result.report.stepReports).toHaveLength(3);
    });

    it('should accumulate removed blocks', async () => {
      const duplicate: ContextBlock<string> = createBlock('hash1', 'memory', 'data');
      const blocks: ContextBlock<any>[] = [
        duplicate,
        duplicate,
        createHistoryBlock('hash2', 1000),
        createHistoryBlock('hash3', 2000),
      ];

      const view = createTestView(blocks);
      const estimator = new MockTokenEstimator();
      const result = await compactView(view, {
        steps: ['dedupe', 'history_trim'],
        historyTrim: {
          keepRecentMessages: 1,
          keepErrorMessages: false,
        },
      }, estimator);

      // 1 removed by dedupe + 1 removed by trim
      expect(result.removedBlocks).toHaveLength(2);
    });
  });

  describe('Provenance Tracking', () => {
    it('should add provenance to truncated tool outputs', async () => {
      const largeOutput = 'x'.repeat(1000);
      const block: ContextBlock<any> = {
        blockHash: 'original-hash',
        meta: {
          kind: 'tool_output',
          sensitivity: 'public',
          codecId: 'tool-output',
          codecVersion: '1.0.0',
          createdAt: Date.now(),
          source: 'test-source',
        },
        payload: {
          toolName: 'test_tool',
          output: largeOutput,
        },
      };

      const view = createTestView([block]);
      const estimator = new MockTokenEstimator();
      const result = await compactView(view, {
        steps: ['tool_output_prune'],
        toolOutputPruning: {
          maxRawTailChars: 100,
          preserveErrorTail: true,
          maxOutputsPerTool: 3,
        },
      }, estimator);

      const replacement = result.blocks[0];
      expect(replacement.meta.source).toContain('compacted');
      expect(replacement.meta.tags).toContain('compacted:tool_output_prune');
    });
  });

  describe('Compaction Report', () => {
    it('should generate complete report', async () => {
      const blocks: ContextBlock<any>[] = [
        createBlock('hash1', 'memory', 'data'),
        createBlock('hash1', 'memory', 'data'), // Duplicate
      ];

      const view = createTestView(blocks);
      const estimator = new MockTokenEstimator();
      const result = await compactView(view, {
        steps: ['dedupe'],
      }, estimator);

      expect(result.report).toHaveProperty('beforeTokens');
      expect(result.report).toHaveProperty('afterTokens');
      expect(result.report).toHaveProperty('savedTokens');
      expect(result.report.stepsApplied).toEqual(['dedupe']);
      expect(result.report.stepReports).toHaveLength(1);
    });
  });
});

// Test helpers

function createBlock(
  hash: string,
  kind: 'pinned' | 'memory' | 'history' | 'tool_output',
  payload: any
): ContextBlock<any> {
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

function createToolOutputBlock(
  hash: string,
  codecId: string,
  output: string,
  createdAt: number
): ContextBlock<any> {
  return {
    blockHash: hash,
    meta: {
      kind: 'tool_output',
      sensitivity: 'public',
      codecId,
      codecVersion: '1.0.0',
      createdAt,
    },
    payload: {
      toolName: codecId,
      output,
    },
  };
}

function createHistoryBlock(
  hash: string,
  createdAt: number,
  options: { hasError?: boolean } = {}
): ContextBlock<any> {
  return {
    blockHash: hash,
    meta: {
      kind: 'history',
      sensitivity: 'public',
      codecId: 'conversation-history',
      codecVersion: '1.0.0',
      createdAt,
    },
    payload: {
      messages: [
        {
          role: 'user',
          content: 'Test',
          ...(options.hasError && { error: 'Test error' }),
        },
      ],
    },
  };
}

function createTestView(blocks: ContextBlock[]): ContextView {
  return {
    blocks,
    tokenEstimate: {
      tokens: blocks.length * 100, // Simplified estimate
      confidence: 'low',
      truncated: false,
    },
    stablePrefixHash: 'test-hash',
    createdAt: Date.now() / 1000,
  };
}
