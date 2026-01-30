/**
 * Block types for @foundry/context
 *
 * Core data structures for context blocks with stable hashing and ordering.
 */

/**
 * Block kind determines ordering in compiled context.
 * Must follow KIND_ORDER for deterministic compilation.
 */
export type BlockKind =
  | 'pinned'          // System rules, always first
  | 'reference'       // Tool schemas, external docs
  | 'memory'          // Long-term memory, RAG results
  | 'state'           // Current workflow/session state
  | 'tool_output'     // Tool execution results
  | 'history'         // Conversation history
  | 'turn';           // Current turn (user message)

/**
 * Sensitivity level for content filtering and forking.
 */
export type SensitivityLevel =
  | 'public'          // Safe to fork to any model
  | 'internal'        // Contains business logic/PII
  | 'restricted';     // Contains credentials/secrets

/**
 * Block metadata (stable subset used for hashing).
 */
export interface BlockMeta {
  /** Block kind (determines ordering) */
  kind: BlockKind;

  /** Content sensitivity level */
  sensitivity: SensitivityLevel;

  /** Codec identifier for rendering */
  codecId: string;

  /** Codec version for rendering */
  codecVersion: string;

  /** Unix timestamp (seconds) */
  createdAt: number;

  /** Optional source identifier (workflow ID, session ID, etc.) */
  source?: string;

  /** Optional tags for filtering */
  tags?: string[];
}

/**
 * Subset of BlockMeta used for stable hashing.
 * Excludes volatile fields like createdAt, source, tags.
 */
export interface StableMetaSubset {
  kind: BlockKind;
  sensitivity: SensitivityLevel;
  codecId: string;
  codecVersion: string;
}

/**
 * Context block with content-addressed hash.
 */
export interface ContextBlock<TPayload = unknown> {
  /** Content-addressed hash (computed from meta + payload) */
  blockHash: string;

  /** Block metadata */
  meta: BlockMeta;

  /** Block payload (codec-specific) */
  payload: TPayload;
}

/**
 * Block reference (hash only, used in compiled context).
 */
export interface BlockRef {
  blockHash: string;
}
