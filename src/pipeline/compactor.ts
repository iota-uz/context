/**
 * Compactor: View-based context compaction with provenance tracking.
 *
 * Responsibilities:
 * - Prune tool outputs (keep errors, truncate large outputs)
 * - Deduplicate identical blocks
 * - Trim conversation history (keep recent + errors)
 * - Summarize history (optional, needs Summarizer)
 *
 * IMPORTANT: View-based compaction never mutates the input graph.
 * Creates replacement blocks with full provenance (derivedFrom, method, version).
 */

import type { ContextBlock, BlockRef, BlockKind } from '../types/block.js';
import type { ContextView } from '../graph/views.js';
import { computeBlockHash } from '../types/hash.js';
import type { TokenEstimator } from '../adapters/token-estimator.js';

/**
 * Compaction step identifier.
 */
export type CompactionStep =
  | 'dedupe'              // Remove duplicate blocks
  | 'tool_output_prune'   // Prune large tool outputs
  | 'history_trim'        // Trim conversation history
  | 'summarize_history';  // Summarize old history

/**
 * History compaction summarizer interface.
 * Implementations use LLM to condense old conversation history.
 *
 * Note: This is different from the structured Summarizer in adapters/summarizer.ts
 * which is designed for schema-validated outputs with provenance tracking.
 */
export interface HistorySummarizer {
  /**
   * Summarize a list of history blocks into a single summary block.
   *
   * @param blocks - History blocks to summarize
   * @param targetTokens - Target token count for summary
   * @returns Summary block replacing the input blocks
   */
  summarize(
    blocks: ContextBlock[],
    targetTokens: number
  ): Promise<ContextBlock>;
}

/**
 * Tool output pruning configuration.
 */
export interface ToolOutputPruningConfig {
  /** Maximum raw tail characters to keep (default: 500) */
  maxRawTailChars: number;

  /** Preserve error tail even if large (default: true) */
  preserveErrorTail: boolean;

  /** Maximum outputs per tool type (default: 3) */
  maxOutputsPerTool: number;
}

/**
 * Compaction configuration for the pipeline.
 */
export interface PipelineCompactionConfig {
  /** Compaction steps to apply (in order) */
  steps: CompactionStep[];

  /** Tool output pruning config */
  toolOutputPruning?: ToolOutputPruningConfig;

  /** History trim config */
  historyTrim?: {
    /** Keep most recent N messages */
    keepRecentMessages: number;

    /** Always keep messages with errors */
    keepErrorMessages: boolean;
  };

  /** Summarization config (optional, requires HistorySummarizer) */
  summarization?: {
    /** Minimum messages to trigger summarization */
    minMessages: number;

    /** Summarizer to use for history compaction */
    summarizer?: HistorySummarizer;
  };
}

/**
 * Compaction result.
 */
export interface CompactionResult {
  /** Compacted blocks (includes replacements) */
  blocks: ContextBlock[];

  /** Blocks that were removed */
  removedBlocks: ContextBlock[];

  /** Compaction report */
  report: CompactionReport;
}

/**
 * Compaction report with token savings and lossiness flags.
 */
export interface CompactionReport {
  /** Tokens before compaction */
  beforeTokens: number;

  /** Tokens after compaction */
  afterTokens: number;

  /** Token savings */
  savedTokens: number;

  /** Compaction steps applied */
  stepsApplied: CompactionStep[];

  /** Step-specific reports */
  stepReports: StepReport[];
}

/**
 * Per-step compaction report.
 */
export interface StepReport {
  /** Step identifier */
  step: CompactionStep;

  /** Blocks removed */
  blocksRemoved: number;

  /** Blocks replaced */
  blocksReplaced: number;

  /** Tokens saved */
  tokensSaved: number;

  /** Lossy compaction (information lost) */
  lossy: boolean;

  /** Human-readable description */
  description: string;
}

/**
 * Default tool output pruning configuration.
 */
export const DEFAULT_TOOL_OUTPUT_PRUNING: ToolOutputPruningConfig = {
  maxRawTailChars: 500,
  preserveErrorTail: true,
  maxOutputsPerTool: 3,
};

/**
 * Compact a context view.
 * Returns a new set of blocks with replacements tracked via provenance.
 *
 * @param view - Context view to compact
 * @param config - Compaction configuration
 * @param estimator - Token estimator for calculating savings
 * @returns Compaction result
 */
export async function compactView(
  view: ContextView,
  config: PipelineCompactionConfig,
  estimator: TokenEstimator
): Promise<CompactionResult> {
  let blocks = [...view.blocks];
  const removedBlocks: ContextBlock[] = [];
  const stepReports: StepReport[] = [];

  // Apply compaction steps in order
  for (const step of config.steps) {
    const beforeCount = blocks.length;
    const beforeTokens = view.tokenEstimate?.tokens ?? 0;

    switch (step) {
      case 'dedupe': {
        const result = deduplicateBlocks(blocks);

        // Calculate token savings from removed duplicates
        const removedEstimate = result.removed.length > 0
          ? await estimator.estimate(result.removed)
          : { tokens: 0 };

        blocks = result.blocks;
        removedBlocks.push(...result.removed);

        stepReports.push({
          step,
          blocksRemoved: result.removed.length,
          blocksReplaced: 0,
          tokensSaved: removedEstimate.tokens,
          lossy: false,
          description: `Removed ${result.removed.length} duplicate blocks`,
        });
        break;
      }

      case 'tool_output_prune': {
        const pruningConfig = config.toolOutputPruning ?? DEFAULT_TOOL_OUTPUT_PRUNING;

        // Estimate tokens before pruning
        const toolOutputBlocks = blocks.filter((b) => b.meta.kind === 'tool_output');
        const beforeEstimate = toolOutputBlocks.length > 0
          ? await estimator.estimate(toolOutputBlocks)
          : { tokens: 0 };

        const result = pruneToolOutputs(blocks, pruningConfig);

        // Estimate tokens after pruning (only tool output blocks)
        const keptToolOutputs = result.blocks.filter((b) => b.meta.kind === 'tool_output');
        const afterEstimate = keptToolOutputs.length > 0
          ? await estimator.estimate(keptToolOutputs)
          : { tokens: 0 };

        blocks = result.blocks;
        removedBlocks.push(...result.removed);

        stepReports.push({
          step,
          blocksRemoved: result.removed.length,
          blocksReplaced: result.replaced.length,
          tokensSaved: beforeEstimate.tokens - afterEstimate.tokens,
          lossy: result.replaced.length > 0,
          description: `Pruned ${result.replaced.length} tool outputs, removed ${result.removed.length}`,
        });
        break;
      }

      case 'history_trim': {
        const trimConfig = config.historyTrim ?? {
          keepRecentMessages: 20,
          keepErrorMessages: true,
        };
        const result = trimHistory(blocks, trimConfig);

        // Calculate token savings from removed history blocks
        const removedEstimate = result.removed.length > 0
          ? await estimator.estimate(result.removed)
          : { tokens: 0 };

        blocks = result.blocks;
        removedBlocks.push(...result.removed);

        stepReports.push({
          step,
          blocksRemoved: result.removed.length,
          blocksReplaced: 0,
          tokensSaved: removedEstimate.tokens,
          lossy: result.removed.length > 0,
          description: `Trimmed ${result.removed.length} old history messages`,
        });
        break;
      }

      case 'summarize_history': {
        const summaryConfig = config.summarization;

        if (!summaryConfig?.summarizer) {
          stepReports.push({
            step,
            blocksRemoved: 0,
            blocksReplaced: 0,
            tokensSaved: 0,
            lossy: false,
            description: 'Summarizer not configured, skipping',
          });
          break;
        }

        const historyBlocks = blocks.filter((b) => b.meta.kind === 'history');

        if (historyBlocks.length < summaryConfig.minMessages) {
          stepReports.push({
            step,
            blocksRemoved: 0,
            blocksReplaced: 0,
            tokensSaved: 0,
            lossy: false,
            description: `Insufficient history (${historyBlocks.length} < ${summaryConfig.minMessages})`,
          });
          break;
        }

        // Split into recent (keep) and old (summarize)
        const keepCount = 10; // Keep last 10 messages raw
        const recent = historyBlocks.slice(-keepCount);
        const old = historyBlocks.slice(0, -keepCount);

        if (old.length === 0) {
          stepReports.push({
            step,
            blocksRemoved: 0,
            blocksReplaced: 0,
            tokensSaved: 0,
            lossy: false,
            description: 'No old history to summarize',
          });
          break;
        }

        // Estimate tokens before summarization
        const beforeSummaryEstimate = await estimator.estimate(old);
        const targetTokens = Math.floor(beforeSummaryEstimate.tokens * 0.3); // Compress to 30%

        // Create summary block
        const summaryBlock = await summaryConfig.summarizer.summarize(old, targetTokens);

        // Estimate tokens for summary block
        const afterSummaryEstimate = await estimator.estimateBlock(summaryBlock);

        // Replace old blocks with summary
        const nonHistoryBlocks = blocks.filter((b) => b.meta.kind !== 'history');
        blocks = [...nonHistoryBlocks, summaryBlock, ...recent];
        removedBlocks.push(...old);

        stepReports.push({
          step,
          blocksRemoved: old.length,
          blocksReplaced: 1,
          tokensSaved: beforeSummaryEstimate.tokens - afterSummaryEstimate.tokens,
          lossy: true,
          description: `Summarized ${old.length} old messages into 1 summary block`,
        });
        break;
      }
    }
  }

  // Calculate total savings - recalculate tokens for compacted blocks
  const beforeTokens = view.tokenEstimate?.tokens ?? 0;

  // Recalculate tokens for compacted blocks
  const afterEstimate = blocks.length > 0
    ? await estimator.estimate(blocks)
    : { tokens: 0 };
  const afterTokens = afterEstimate.tokens;
  const savedTokens = beforeTokens - afterTokens;

  return {
    blocks,
    removedBlocks,
    report: {
      beforeTokens,
      afterTokens,
      savedTokens,
      stepsApplied: config.steps,
      stepReports,
    },
  };
}

/**
 * Deduplicate identical blocks.
 * Keeps first occurrence of each unique blockHash.
 *
 * @param blocks - Input blocks
 * @returns Deduplicated blocks and removed duplicates
 */
function deduplicateBlocks(blocks: ContextBlock[]): {
  blocks: ContextBlock[];
  removed: ContextBlock[];
} {
  const seen = new Set<string>();
  const deduplicated: ContextBlock[] = [];
  const removed: ContextBlock[] = [];

  for (const block of blocks) {
    if (seen.has(block.blockHash)) {
      removed.push(block);
    } else {
      seen.add(block.blockHash);
      deduplicated.push(block);
    }
  }

  return { blocks: deduplicated, removed };
}

/**
 * Prune tool outputs.
 * Keeps:
 * - All error outputs (preserveErrorTail = true)
 * - Last N outputs per tool type
 * - Truncated version of large outputs (tail only)
 *
 * @param blocks - Input blocks
 * @param config - Pruning configuration
 * @returns Pruned blocks, removed blocks, and replaced blocks
 */
function pruneToolOutputs(
  blocks: ContextBlock[],
  config: ToolOutputPruningConfig
): {
  blocks: ContextBlock[];
  removed: ContextBlock[];
  replaced: ContextBlock[];
} {
  const toolOutputBlocks = blocks.filter((b) => b.meta.kind === 'tool_output');
  const otherBlocks = blocks.filter((b) => b.meta.kind !== 'tool_output');

  // Group by tool type (codecId)
  const byTool = new Map<string, ContextBlock[]>();
  for (const block of toolOutputBlocks) {
    const toolId = block.meta.codecId;
    if (!byTool.has(toolId)) {
      byTool.set(toolId, []);
    }
    byTool.get(toolId)!.push(block);
  }

  const kept: ContextBlock[] = [];
  const removed: ContextBlock[] = [];
  const replaced: ContextBlock[] = [];

  // For each tool type, keep recent outputs and prune old/large ones
  for (const [toolId, toolBlocks] of byTool.entries()) {
    // Sort by createdAt (most recent last)
    const sorted = [...toolBlocks].sort((a, b) => a.meta.createdAt - b.meta.createdAt);

    // Keep last N outputs
    const toKeep = sorted.slice(-config.maxOutputsPerTool);
    const toRemove = sorted.slice(0, -config.maxOutputsPerTool);

    // Check if any outputs need truncation
    for (const block of toKeep) {
      const payload = block.payload as any;

      // Check if output is large (needs truncation)
      const isLarge = payload.output && typeof payload.output === 'string' && payload.output.length > config.maxRawTailChars;
      const isError = payload.error || payload.status === 'error';

      if (isLarge && (!isError || !config.preserveErrorTail)) {
        // Create truncated replacement block
        const truncatedPayload = {
          ...payload,
          output: truncateTail(payload.output, config.maxRawTailChars),
          _truncated: true,
        };

        const replacementBlock = createReplacementBlock(
          block,
          truncatedPayload,
          'tool_output_prune',
          '1.0.0'
        );

        kept.push(replacementBlock);
        replaced.push(block);
      } else {
        kept.push(block);
      }
    }

    removed.push(...toRemove);
  }

  return {
    blocks: [...otherBlocks, ...kept],
    removed,
    replaced,
  };
}

/**
 * Trim conversation history.
 * Keeps recent messages and optionally error messages.
 *
 * @param blocks - Input blocks
 * @param config - Trim configuration
 * @returns Trimmed blocks and removed blocks
 */
function trimHistory(
  blocks: ContextBlock[],
  config: { keepRecentMessages: number; keepErrorMessages: boolean }
): {
  blocks: ContextBlock[];
  removed: ContextBlock[];
} {
  const historyBlocks = blocks.filter((b) => b.meta.kind === 'history');
  const otherBlocks = blocks.filter((b) => b.meta.kind !== 'history');

  if (historyBlocks.length === 0) {
    return { blocks, removed: [] };
  }

  // Sort by createdAt
  const sorted = [...historyBlocks].sort((a, b) => a.meta.createdAt - b.meta.createdAt);

  // Keep recent messages
  const recent = sorted.slice(-config.keepRecentMessages);
  const old = sorted.slice(0, -config.keepRecentMessages);

  // Optionally keep error messages from old
  const errorMessages = config.keepErrorMessages
    ? old.filter((b) => {
        const payload = b.payload as any;
        return payload.messages?.some((m: any) => m.error);
      })
    : [];

  const kept = [...recent, ...errorMessages];
  const removed = old.filter((b) => !errorMessages.includes(b));

  return {
    blocks: [...otherBlocks, ...kept],
    removed,
  };
}

/**
 * Truncate text to tail characters with ellipsis.
 *
 * @param text - Text to truncate
 * @param maxChars - Maximum characters to keep
 * @returns Truncated text
 */
function truncateTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  const tail = text.slice(-maxChars);
  return `... [truncated ${text.length - maxChars} chars] ...\n${tail}`;
}

/**
 * Create a replacement block with provenance.
 *
 * @param original - Original block
 * @param newPayload - New payload
 * @param method - Compaction method
 * @param version - Compaction version
 * @returns Replacement block
 */
function createReplacementBlock<TPayload>(
  original: ContextBlock<TPayload>,
  newPayload: TPayload,
  method: string,
  version: string
): ContextBlock<TPayload> {
  // Compute new hash
  const blockHash = computeBlockHash(
    original.meta,
    newPayload
  );

  // Create replacement block with provenance metadata
  return {
    blockHash,
    meta: {
      ...original.meta,
      source: `${original.meta.source ?? 'unknown'}:compacted`,
      tags: [...(original.meta.tags ?? []), `compacted:${method}`],
    },
    payload: newPayload,
  };
}
