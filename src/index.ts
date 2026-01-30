/**
 * @foundry/context - Context management library for LLM conversations
 *
 * Phase 1: Core Types & Codecs
 * Phase 2: Context Graph & Token Estimation
 * Phase 3: Builder & Compilation Pipeline
 */

// Core types
export * from './types/index.js';

// Graph utilities (KIND_ORDER, ContextGraph, queries, views)
export * from './graph/index.js';

// Built-in codecs
export * from './codecs/index.js';

// Token estimators
export * from './adapters/index.js';

// Context builder (Phase 3)
export * from './builder/index.js';

// Pipeline utilities (compaction, fork)
export * from './pipeline/index.js';

// Provider compilers
export * from './providers/index.js';

// Policy configurations
export * from './policies/index.js';
