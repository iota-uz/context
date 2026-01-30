/**
 * ContextFork: Create sub-agent contexts with sensitivity enforcement.
 *
 * Enables forking contexts for sub-agents with automatic sensitivity redaction,
 * budget overrides, and schema-enforced output validation.
 */

import { createHash } from 'crypto';
import { z, type ZodSchema } from 'zod';
import type { ContextGraph } from '../graph/context-graph.js';
import type { ContextView } from '../graph/views.js';
import type { ContextBlock, SensitivityLevel, BlockRef } from '../types/block.js';
import type { ModelRef } from '../types/policy.js';
import { RedactedStubCodec, type RedactedStubPayload } from '../codecs/redacted-stub.codec.js';
import { computeBlockHash } from '../types/hash.js';

/**
 * Sub-agent task definition with schema-enforced output.
 */
export interface SubAgentTask<TOutput = unknown> {
  /** Task instruction for the sub-agent */
  instruction: string;

  /** Expected output schema (Zod schema, required) */
  expectedOutputSchema: ZodSchema<TOutput>;

  /** Maximum output tokens (optional) */
  maxOutputTokens?: number;

  /** Forbidden fields that must not appear in output */
  forbiddenFields?: string[];
}

/**
 * Fork options for creating sub-agent contexts.
 */
export interface ContextForkOptions {
  /** Unique agent identifier */
  agentId: string;

  /** Human-readable fork name */
  name: string;

  /** Model to use for this fork */
  model: ModelRef;

  /** Inherit query from parent context */
  inheritQuery?: boolean;

  /** Include conversation history in fork */
  includeHistory?: boolean;

  /** Include state blocks in fork */
  includeState?: boolean;

  /** Maximum sensitivity level to include (default: 'public') */
  maxSensitivity?: SensitivityLevel;

  /** Token budget override (optional) */
  budgetOverride?: number;
}

/**
 * LLM usage statistics.
 */
export interface UsageStats {
  /** Input tokens */
  inputTokens: number;

  /** Output tokens */
  outputTokens: number;

  /** Total tokens */
  totalTokens: number;
}

/**
 * Provenance information for fork result.
 */
export interface ForkProvenance {
  /** Source view hash */
  sourceViewHash: string;

  /** Execution hash (deterministic) */
  executionHash: string;

  /** Fork creation timestamp */
  forkedAt: number;

  /** Fork completion timestamp */
  completedAt: number;
}

/**
 * Fork execution result.
 */
export interface ForkResult<TOutput = unknown> {
  /** Agent ID */
  agentId: string;

  /** Model used */
  model: ModelRef;

  /** Task summary */
  summary: string;

  /** Structured output (validated against schema) */
  output: TOutput;

  /** Generated artifacts (optional) */
  artifacts?: Array<{
    name: string;
    type: string;
    content: string;
  }>;

  /** Citations to source blocks (block hashes) */
  citations?: string[];

  /** Usage statistics */
  usage: UsageStats;

  /** Provenance information */
  provenance: ForkProvenance;
}

/**
 * Sensitivity level ordering (for comparison).
 */
const SENSITIVITY_ORDER: Record<SensitivityLevel, number> = {
  public: 0,
  internal: 1,
  restricted: 2,
};

/**
 * Check if a sensitivity level exceeds the maximum allowed level.
 *
 * @param level - Sensitivity level to check
 * @param maxLevel - Maximum allowed level
 * @returns True if level exceeds maxLevel
 */
function exceedsSensitivityLevel(
  level: SensitivityLevel,
  maxLevel: SensitivityLevel
): boolean {
  return SENSITIVITY_ORDER[level] > SENSITIVITY_ORDER[maxLevel];
}

/**
 * Create a redacted stub block for sensitive content.
 *
 * @param originalBlock - Original block to redact
 * @param reason - Redaction reason
 * @returns Redacted stub block
 */
function createRedactedStub(
  originalBlock: ContextBlock<unknown>,
  reason: string
): ContextBlock<RedactedStubPayload> {
  const payload: RedactedStubPayload = {
    originalBlockHash: originalBlock.blockHash,
    reason,
    placeholder: '[REDACTED - Sensitive content removed]',
  };

  const meta = {
    kind: originalBlock.meta.kind,
    sensitivity: 'public' as const,
    codecId: RedactedStubCodec.codecId,
    codecVersion: RedactedStubCodec.version,
    createdAt: Math.floor(Date.now() / 1000),
    source: originalBlock.meta.source,
    tags: originalBlock.meta.tags,
  };

  const blockHash = computeBlockHash(meta, payload, RedactedStubCodec);

  return {
    blockHash,
    meta,
    payload,
  };
}

/**
 * Filter view blocks by sensitivity level.
 * Blocks exceeding maxSensitivity are replaced with redacted stubs.
 *
 * @param view - Source context view
 * @param maxSensitivity - Maximum allowed sensitivity level
 * @returns Filtered blocks with redacted stubs
 */
export function filterBySensitivity(
  view: ContextView,
  maxSensitivity: SensitivityLevel
): ContextBlock<unknown>[] {
  return view.blocks.map((block) => {
    if (exceedsSensitivityLevel(block.meta.sensitivity, maxSensitivity)) {
      return createRedactedStub(
        block,
        `Sensitivity level '${block.meta.sensitivity}' exceeds maximum '${maxSensitivity}'`
      );
    }
    return block;
  });
}

/**
 * Compute deterministic execution hash.
 * Hash includes: model + compiledViewHash + instruction + schemaHash + toolsetVersion
 *
 * @param model - Model reference
 * @param viewHash - Compiled view hash
 * @param instruction - Task instruction
 * @param schemaHash - Output schema hash
 * @param toolsetVersion - Toolset version (optional)
 * @returns Hex-encoded SHA-256 hash
 */
export function computeExecutionHash(
  model: ModelRef,
  viewHash: string,
  instruction: string,
  schemaHash: string,
  toolsetVersion?: string
): string {
  const combined = {
    model: `${model.provider}:${model.model}`,
    viewHash,
    instruction,
    schemaHash,
    toolsetVersion: toolsetVersion ?? 'none',
  };

  return createHash('sha256')
    .update(JSON.stringify(combined))
    .digest('hex');
}

/**
 * Compute schema hash for deterministic execution tracking.
 *
 * @param schema - Zod schema
 * @returns Hex-encoded SHA-256 hash
 */
export function computeSchemaHash(schema: ZodSchema): string {
  // Use schema description for hashing (simplified approach)
  // In production, you'd want to serialize the schema structure
  const schemaDesc = schema.description ?? JSON.stringify(schema._def);

  return createHash('sha256')
    .update(schemaDesc)
    .digest('hex');
}

/**
 * ContextFork: Create sub-agent contexts with sensitivity enforcement.
 */
export class ContextFork {
  constructor(
    private readonly graph: ContextGraph,
    private readonly parentView: ContextView
  ) {}

  /**
   * Create a fork with sensitivity filtering and budget override.
   *
   * @param options - Fork options
   * @returns Filtered context view for sub-agent
   */
  async createFork(options: ContextForkOptions): Promise<ContextView> {
    const maxSensitivity = options.maxSensitivity ?? 'public';

    // Filter blocks by sensitivity
    const filteredBlocks = filterBySensitivity(this.parentView, maxSensitivity);

    // Apply additional filters based on options
    let finalBlocks = filteredBlocks;

    if (!options.includeHistory) {
      finalBlocks = finalBlocks.filter((block) => block.meta.kind !== 'history');
    }

    if (!options.includeState) {
      finalBlocks = finalBlocks.filter((block) => block.meta.kind !== 'state');
    }

    // Create new view with filtered blocks
    // Re-compute stable prefix hash
    const stablePrefixHash = createHash('sha256')
      .update(finalBlocks.map((b) => b.blockHash).join('|'))
      .digest('hex');

    const forkedView: ContextView = {
      blocks: finalBlocks,
      stablePrefixHash,
      createdAt: Math.floor(Date.now() / 1000),
      tokenEstimate: options.budgetOverride
        ? { tokens: options.budgetOverride, confidence: 'high', truncated: false }
        : this.parentView.tokenEstimate,
    };

    return forkedView;
  }

  /**
   * Execute a sub-agent task with schema validation.
   *
   * @param task - Sub-agent task definition
   * @param options - Fork options
   * @param executor - Async executor function (calls LLM)
   * @returns Fork result with validated output
   */
  async executeFork<TOutput>(
    task: SubAgentTask<TOutput>,
    options: ContextForkOptions,
    executor: (instruction: string, view: ContextView) => Promise<{
      output: unknown;
      summary: string;
      artifacts?: Array<{ name: string; type: string; content: string }>;
      citations?: string[];
      usage: UsageStats;
    }>
  ): Promise<ForkResult<TOutput>> {
    const forkedAt = Math.floor(Date.now() / 1000);

    // Create fork
    const forkedView = await this.createFork(options);

    // Validate forbidden fields
    if (task.forbiddenFields && task.forbiddenFields.length > 0) {
      // Add validation to instruction
      const forbiddenFieldsNote = `\n\nIMPORTANT: Your output MUST NOT include these fields: ${task.forbiddenFields.join(', ')}`;
      const enhancedInstruction = task.instruction + forbiddenFieldsNote;

      // Execute with enhanced instruction
      const executionResult = await executor(enhancedInstruction, forkedView);

      // Validate output against schema
      const validatedOutput = task.expectedOutputSchema.parse(executionResult.output);

      // Check for forbidden fields in output
      const outputStr = JSON.stringify(validatedOutput);
      for (const field of task.forbiddenFields) {
        if (outputStr.includes(field)) {
          throw new Error(
            `Fork execution failed: Output contains forbidden field '${field}'`
          );
        }
      }

      const completedAt = Math.floor(Date.now() / 1000);

      // Compute execution hash
      const schemaHash = computeSchemaHash(task.expectedOutputSchema);
      const executionHash = computeExecutionHash(
        options.model,
        forkedView.stablePrefixHash,
        task.instruction,
        schemaHash
      );

      return {
        agentId: options.agentId,
        model: options.model,
        summary: executionResult.summary,
        output: validatedOutput,
        artifacts: executionResult.artifacts,
        citations: executionResult.citations,
        usage: executionResult.usage,
        provenance: {
          sourceViewHash: this.parentView.stablePrefixHash,
          executionHash,
          forkedAt,
          completedAt,
        },
      };
    } else {
      // Execute without forbidden field validation
      const executionResult = await executor(task.instruction, forkedView);

      // Validate output against schema
      const validatedOutput = task.expectedOutputSchema.parse(executionResult.output);

      const completedAt = Math.floor(Date.now() / 1000);

      // Compute execution hash
      const schemaHash = computeSchemaHash(task.expectedOutputSchema);
      const executionHash = computeExecutionHash(
        options.model,
        forkedView.stablePrefixHash,
        task.instruction,
        schemaHash
      );

      return {
        agentId: options.agentId,
        model: options.model,
        summary: executionResult.summary,
        output: validatedOutput,
        artifacts: executionResult.artifacts,
        citations: executionResult.citations,
        usage: executionResult.usage,
        provenance: {
          sourceViewHash: this.parentView.stablePrefixHash,
          executionHash,
          forkedAt,
          completedAt,
        },
      };
    }
  }

  /**
   * Ingest fork result back into parent graph.
   * Adds result as a memory block with provenance tracking.
   *
   * @param result - Fork result to ingest
   * @param asMemory - Add as memory block (default: true)
   * @returns Block hash of ingested result
   */
  ingestForkResult<TOutput>(
    result: ForkResult<TOutput>,
    asMemory = true
  ): string {
    // Create a structured reference block for the fork result
    // This would use a codec designed for fork results
    // For now, we'll use a simplified approach

    const payload = {
      agentId: result.agentId,
      model: result.model,
      summary: result.summary,
      output: result.output,
      artifacts: result.artifacts,
      citations: result.citations,
      usage: result.usage,
      provenance: result.provenance,
    };

    const meta = {
      kind: asMemory ? ('memory' as const) : ('reference' as const),
      sensitivity: 'public' as const,
      codecId: 'fork-result',
      codecVersion: '1.0.0',
      createdAt: Math.floor(Date.now() / 1000),
      source: result.agentId,
      tags: ['fork-result', result.model.provider],
    };

    // Compute block hash (without codec for now)
    const blockHash = createHash('sha256')
      .update(JSON.stringify({ meta, payload }))
      .digest('hex');

    const block: ContextBlock<unknown> = {
      blockHash,
      meta,
      payload,
    };

    // Add to graph with provenance
    const derivedFrom: BlockRef[] = result.citations
      ? result.citations.map((hash) => ({ blockHash: hash }))
      : [];

    this.graph.addBlock(block, derivedFrom);

    return blockHash;
  }
}
