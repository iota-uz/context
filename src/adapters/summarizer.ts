/**
 * Summarizer: Generate summaries with sensitivity filtering.
 *
 * Provides schema-enforced summarization with forbidden field validation.
 */

import { createHash } from 'crypto';
import type { ZodSchema } from 'zod';
import type { ContextBlock, SensitivityLevel } from '../types/block.js';
import type { ModelRef } from '../types/policy.js';

/**
 * Summarization provenance.
 */
export interface SummaryProvenance {
  /** Source block hashes */
  derivedFrom: string[];

  /** Summarization method */
  method: 'summarize';

  /** Summarizer version */
  version: string;

  /** Source content snapshot hash */
  snapshotHash: string;

  /** Creation timestamp */
  createdAt: number;
}

/**
 * Summary block result.
 */
export interface SummaryBlock<TOutput = unknown> {
  /** Validated summary output */
  summary: TOutput;

  /** Provenance information */
  provenance: SummaryProvenance;

  /** Token usage */
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

/**
 * Summarizer interface.
 */
export interface Summarizer {
  /**
   * Generate a summary of blocks with schema validation.
   *
   * @param blocks - Blocks to summarize
   * @param schema - Expected output schema
   * @param options - Summarization options
   * @returns Summary block
   */
  summarize<TOutput>(
    blocks: ContextBlock<unknown>[],
    schema: ZodSchema<TOutput>,
    options?: SummarizationOptions
  ): Promise<SummaryBlock<TOutput>>;
}

/**
 * Summarization options.
 */
export interface SummarizationOptions {
  /** Instruction/prompt for summarization */
  instruction?: string;

  /** Maximum output tokens */
  maxOutputTokens?: number;

  /** Forbidden fields that must not appear in summary */
  forbiddenFields?: string[];

  /** Allowed sensitivity levels for summarization */
  allowedForSummarization?: SensitivityLevel[];
}

/**
 * Default summarization options.
 */
export const DEFAULT_SUMMARIZATION_OPTIONS: Required<
  Omit<SummarizationOptions, 'instruction' | 'maxOutputTokens'>
> = {
  forbiddenFields: ['raw_messages', 'full_transcript', 'raw_history'],
  allowedForSummarization: ['public'],
};

/**
 * Default summarizer using gpt-5-nano.
 */
export class DefaultSummarizer implements Summarizer {
  private readonly version = '1.0.0';

  constructor(
    private readonly modelRef: ModelRef = {
      provider: 'openai',
      model: 'gpt-5-nano',
    },
    private readonly executor?: (
      instruction: string,
      content: string,
      schema: ZodSchema
    ) => Promise<{
      output: unknown;
      usage: { inputTokens: number; outputTokens: number; totalTokens: number };
    }>
  ) {}

  /**
   * Filter blocks by sensitivity level.
   *
   * @param blocks - Blocks to filter
   * @param allowedLevels - Allowed sensitivity levels
   * @returns Filtered blocks
   */
  private filterBySensitivity(
    blocks: ContextBlock<unknown>[],
    allowedLevels: SensitivityLevel[]
  ): ContextBlock<unknown>[] {
    return blocks.filter((block) => allowedLevels.includes(block.meta.sensitivity));
  }

  /**
   * Compute snapshot hash from block hashes.
   *
   * @param blocks - Blocks to hash
   * @returns Hex-encoded SHA-256 hash
   */
  private computeSnapshotHash(blocks: ContextBlock<unknown>[]): string {
    const concatenated = blocks.map((b) => b.blockHash).join('|');
    return createHash('sha256').update(concatenated).digest('hex');
  }

  /**
   * Default executor (throws error - must be provided).
   */
  private async defaultExecutor(
    instruction: string,
    content: string,
    schema: ZodSchema
  ): Promise<{
    output: unknown;
    usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  }> {
    throw new Error(
      'Summarizer executor not provided. Please provide an executor function in constructor.'
    );
  }

  async summarize<TOutput>(
    blocks: ContextBlock<unknown>[],
    schema: ZodSchema<TOutput>,
    options?: SummarizationOptions
  ): Promise<SummaryBlock<TOutput>> {
    const opts = {
      ...DEFAULT_SUMMARIZATION_OPTIONS,
      ...options,
    };

    // Filter blocks by sensitivity
    const filteredBlocks = this.filterBySensitivity(
      blocks,
      opts.allowedForSummarization ?? DEFAULT_SUMMARIZATION_OPTIONS.allowedForSummarization
    );

    if (filteredBlocks.length === 0) {
      throw new Error('No blocks available for summarization after sensitivity filtering');
    }

    // Build content string from blocks
    const content = filteredBlocks
      .map((block, idx) => {
        return `[Block ${idx + 1}/${filteredBlocks.length}]\nKind: ${block.meta.kind}\nPayload: ${JSON.stringify(block.payload, null, 2)}`;
      })
      .join('\n\n---\n\n');

    // Build instruction
    const instruction =
      opts.instruction ??
      'Summarize the following context blocks concisely. Focus on key information and maintain accuracy.';

    // Add forbidden fields note if specified
    const enhancedInstruction = opts.forbiddenFields
      ? `${instruction}\n\nIMPORTANT: Your summary MUST NOT include these fields: ${opts.forbiddenFields.join(', ')}`
      : instruction;

    // Execute summarization
    const executor = this.executor ?? this.defaultExecutor.bind(this);
    const result = await executor(enhancedInstruction, content, schema);

    // Validate output against schema
    const validatedOutput = schema.parse(result.output);

    // Check for forbidden fields
    if (opts.forbiddenFields && opts.forbiddenFields.length > 0) {
      const outputStr = JSON.stringify(validatedOutput);
      for (const field of opts.forbiddenFields) {
        if (outputStr.includes(field)) {
          throw new Error(
            `Summarization failed: Output contains forbidden field '${field}'`
          );
        }
      }
    }

    // Compute snapshot hash
    const snapshotHash = this.computeSnapshotHash(filteredBlocks);

    return {
      summary: validatedOutput,
      provenance: {
        derivedFrom: filteredBlocks.map((b) => b.blockHash),
        method: 'summarize',
        version: this.version,
        snapshotHash,
        createdAt: Math.floor(Date.now() / 1000),
      },
      usage: result.usage,
    };
  }
}

/**
 * Create a summarizer with custom model.
 *
 * @param modelRef - Model reference
 * @param executor - Executor function
 * @returns Summarizer instance
 */
export function createSummarizer(
  modelRef: ModelRef,
  executor: (
    instruction: string,
    content: string,
    schema: ZodSchema
  ) => Promise<{
    output: unknown;
    usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  }>
): Summarizer {
  return new DefaultSummarizer(modelRef, executor);
}
