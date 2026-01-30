/**
 * ContextBuilder: Fluent API for composing context graphs.
 *
 * Provides a declarative interface for building context from various sources:
 * - System rules (pinned)
 * - References (tool schemas, docs)
 * - State (current workflow/session)
 * - Memory (long-term, RAG results)
 * - History (conversation turns)
 * - Attachments (images, PDFs)
 * - Current turn (user message)
 */

import type { ContextBlock, BlockKind, SensitivityLevel } from '../types/block.js';
import type { BlockCodec } from '../types/codec.js';
import type { ContextPolicy, Provider } from '../types/policy.js';
import type { AttachmentRef } from '../types/attachment.js';
import type { CompiledContext } from '../types/compiled.js';
import { ContextGraph } from '../graph/context-graph.js';
import { SystemRulesCodec, type SystemRulesPayload } from '../codecs/system-rules.codec.js';
import { ConversationHistoryCodec, type ConversationHistoryPayload, type ConversationMessage } from '../codecs/conversation-history.codec.js';
import { computeBlockHash } from '../types/hash.js';

/**
 * Fork options for creating specialized contexts.
 */
export interface ForkOptions {
  /** Maximum sensitivity level to include */
  maxSensitivity?: SensitivityLevel;

  /** Block kinds to include (omit = include all) */
  includeKinds?: BlockKind[];

  /** Block kinds to exclude */
  excludeKinds?: BlockKind[];

  /** Optional tag filter */
  tags?: string[];
}

/**
 * ContextBuilder: Fluent API for composing context.
 *
 * Usage:
 * ```ts
 * const builder = new ContextBuilder();
 * builder
 *   .system({ text: 'You are a helpful assistant.' })
 *   .history(previousMessages)
 *   .turn('What is the capital of France?');
 *
 * const compiled = await builder.compile(policy, 'anthropic');
 * ```
 */
export class ContextBuilder {
  private readonly graph: ContextGraph;
  private blockCounter: number;

  constructor() {
    this.graph = new ContextGraph();
    this.blockCounter = 0;
  }

  /**
   * Add a pinned system rules block.
   *
   * @param rules - System rules payload
   * @param options - Optional block metadata overrides
   * @returns This builder (for chaining)
   */
  system(
    rules: SystemRulesPayload,
    options?: {
      sensitivity?: SensitivityLevel;
      source?: string;
      tags?: string[];
    }
  ): this {
    const block = this.createBlock(
      'pinned',
      SystemRulesCodec,
      rules,
      options
    );

    this.graph.addBlock(block);
    return this;
  }

  /**
   * Add a reference block (tool schema, external doc, etc.).
   *
   * @param codec - Block codec for the reference type
   * @param data - Reference payload
   * @param options - Optional block metadata overrides
   * @returns This builder (for chaining)
   */
  reference<TPayload>(
    codec: BlockCodec<TPayload>,
    data: TPayload,
    options?: {
      sensitivity?: SensitivityLevel;
      source?: string;
      tags?: string[];
    }
  ): this {
    const block = this.createBlock(
      'reference',
      codec,
      data,
      options
    );

    this.graph.addBlock(block);
    return this;
  }

  /**
   * Add a state block (current workflow/session state).
   *
   * @param codec - Block codec for the state type
   * @param data - State payload
   * @param options - Optional block metadata overrides
   * @returns This builder (for chaining)
   */
  state<TPayload>(
    codec: BlockCodec<TPayload>,
    data: TPayload,
    options?: {
      sensitivity?: SensitivityLevel;
      source?: string;
      tags?: string[];
    }
  ): this {
    const block = this.createBlock(
      'state',
      codec,
      data,
      options
    );

    this.graph.addBlock(block);
    return this;
  }

  /**
   * Add a memory block (long-term memory, RAG results).
   *
   * @param codec - Block codec for the memory type
   * @param data - Memory payload
   * @param options - Optional block metadata overrides
   * @returns This builder (for chaining)
   */
  memory<TPayload>(
    codec: BlockCodec<TPayload>,
    data: TPayload,
    options?: {
      sensitivity?: SensitivityLevel;
      source?: string;
      tags?: string[];
    }
  ): this {
    const block = this.createBlock(
      'memory',
      codec,
      data,
      options
    );

    this.graph.addBlock(block);
    return this;
  }

  /**
   * Add a conversation history block.
   *
   * @param messages - Array of conversation messages
   * @param summary - Optional summary of earlier messages
   * @param options - Optional block metadata overrides
   * @returns This builder (for chaining)
   */
  history(
    messages: ConversationMessage[],
    summary?: string,
    options?: {
      sensitivity?: SensitivityLevel;
      source?: string;
      tags?: string[];
    }
  ): this {
    const payload: ConversationHistoryPayload = {
      messages,
      summary,
    };

    const block = this.createBlock(
      'history',
      ConversationHistoryCodec,
      payload,
      options
    );

    this.graph.addBlock(block);
    return this;
  }

  /**
   * Add attachment blocks (images, PDFs, etc.).
   * Note: Attachments need to be resolved via AttachmentResolver before compilation.
   *
   * @param attachments - Array of attachments
   * @param codec - Block codec for attachment type
   * @param options - Optional block metadata overrides
   * @returns This builder (for chaining)
   */
  attachments<TPayload>(
    attachments: AttachmentRef[],
    codec: BlockCodec<TPayload>,
    options?: {
      sensitivity?: SensitivityLevel;
      source?: string;
      tags?: string[];
    }
  ): this {
    // For each attachment, create a reference block
    // The actual resolution happens via AttachmentResolver
    for (const attachment of attachments) {
      const block = this.createBlock(
        'reference',
        codec,
        attachment as unknown as TPayload,
        options
      );

      this.graph.addBlock(block);
    }

    return this;
  }

  /**
   * Add a user turn block (current user message).
   *
   * @param text - User message text
   * @param options - Optional block metadata overrides
   * @returns This builder (for chaining)
   */
  turn(
    text: string,
    options?: {
      sensitivity?: SensitivityLevel;
      source?: string;
      tags?: string[];
    }
  ): this {
    // Use a simple text payload for turn blocks
    const payload = { text };

    const block = this.createBlock(
      'turn',
      {
        codecId: 'user-turn',
        version: '1.0.0',
        payloadSchema: {} as any,
        canonicalize: (p: any) => ({ text: p.text.trim() }),
        hash: (c: any) => {
          return computeBlockHash(
            { kind: 'turn', sensitivity: 'public', codecId: 'user-turn', codecVersion: '1.0.0' },
            c
          );
        },
        render: (block: any) => ({
          anthropic: { role: 'user', content: block.payload.text },
          openai: { role: 'user', content: block.payload.text },
          gemini: { role: 'user', parts: [{ text: block.payload.text }] },
        }),
        validate: (p: any) => p,
      },
      payload,
      options
    );

    this.graph.addBlock(block);
    return this;
  }

  /**
   * Create a forked context with filtering.
   * Useful for creating specialized contexts (e.g., public-only for external models).
   *
   * @param options - Fork filtering options
   * @returns New ContextBuilder with filtered blocks
   */
  fork(options: ForkOptions): ContextBuilder {
    const forked = new ContextBuilder();

    // Filter blocks based on options
    const allBlocks = this.graph.getAllBlocks();

    for (const block of allBlocks) {
      let include = true;

      // Sensitivity filter
      if (options.maxSensitivity !== undefined) {
        const sensitivityOrder: Record<SensitivityLevel, number> = {
          public: 0,
          internal: 1,
          restricted: 2,
        };

        if (sensitivityOrder[block.meta.sensitivity] > sensitivityOrder[options.maxSensitivity]) {
          include = false;
        }
      }

      // Kind filter (include)
      if (options.includeKinds !== undefined) {
        if (!options.includeKinds.includes(block.meta.kind)) {
          include = false;
        }
      }

      // Kind filter (exclude)
      if (options.excludeKinds !== undefined) {
        if (options.excludeKinds.includes(block.meta.kind)) {
          include = false;
        }
      }

      // Tag filter
      if (options.tags !== undefined && options.tags.length > 0) {
        const blockTags = block.meta.tags ?? [];
        const hasMatchingTag = options.tags.some((tag) => blockTags.includes(tag));
        if (!hasMatchingTag) {
          include = false;
        }
      }

      if (include) {
        forked.graph.addBlock(
          block,
          this.graph.getDerivedFrom(block.blockHash),
          this.graph.getReferences(block.blockHash)
        );
      }
    }

    return forked;
  }

  /**
   * Compile the context for a specific provider.
   * This is a placeholder - actual compilation happens in provider compilers.
   *
   * @param policy - Context policy configuration
   * @param provider - Target provider
   * @returns Compiled context
   */
  async compile(policy: ContextPolicy, provider: Provider): Promise<CompiledContext> {
    // This is a placeholder - the actual implementation will be in provider compilers
    // For now, we'll just create a view and return basic structure
    // Create a simple stub estimator (would use provider-specific estimator in production)
    const stubEstimator = {
      estimate: async (blocks: ContextBlock<unknown>[]) => ({
        tokens: blocks.length * 100,
        confidence: 'low' as const,
      }),
      estimateBlock: async (block: ContextBlock<unknown>) => ({
        tokens: 100,
        confidence: 'low' as const,
      }),
    };

    const view = await this.graph.createView({
      tokenEstimator: stubEstimator,
      maxTokens: policy.contextWindow - policy.completionReserve,
    });

    return {
      provider,
      modelId: policy.modelId,
      messages: [],
      estimatedTokens: 0,
      blocks: [...view.blocks],
      meta: {
        compiledAt: Math.floor(Date.now() / 1000),
        contextWindow: policy.contextWindow,
        completionReserve: policy.completionReserve,
        availableTokens: policy.contextWindow - policy.completionReserve,
        overflowed: false,
        compacted: false,
        truncated: false,
        tokensByKind: {},
      },
    };
  }

  /**
   * Get the underlying context graph.
   *
   * @returns Context graph
   */
  getGraph(): ContextGraph {
    return this.graph;
  }

  /**
   * Get the number of blocks in the builder.
   *
   * @returns Block count
   */
  getBlockCount(): number {
    return this.graph.getBlockCount();
  }

  /**
   * Clear all blocks from the builder.
   */
  clear(): void {
    this.graph.clear();
    this.blockCounter = 0;
  }

  /**
   * Create a block with generated hash and metadata.
   *
   * @param kind - Block kind
   * @param codec - Block codec
   * @param payload - Block payload
   * @param options - Optional metadata overrides
   * @returns Context block
   */
  private createBlock<TPayload>(
    kind: BlockKind,
    codec: BlockCodec<TPayload>,
    payload: TPayload,
    options?: {
      sensitivity?: SensitivityLevel;
      source?: string;
      tags?: string[];
    }
  ): ContextBlock<TPayload> {
    // Validate payload
    codec.validate(payload);

    // Canonicalize and compute hash
    const canonicalized = codec.canonicalize(payload);
    const blockHash = codec.hash(canonicalized);

    // Generate unique ID for this block instance
    this.blockCounter++;

    return {
      blockHash,
      meta: {
        kind,
        sensitivity: options?.sensitivity ?? 'public',
        codecId: codec.codecId,
        codecVersion: codec.version,
        createdAt: Math.floor(Date.now() / 1000),
        source: options?.source,
        tags: options?.tags,
      },
      payload,
    };
  }
}
