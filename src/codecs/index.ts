/**
 * Built-in codecs for @foundry/context
 */

export * from './base.js';
export * from './system-rules.codec.js';
export * from './tool-schema.codec.js';
export * from './structured-reference.codec.js';
export * from './conversation-history.codec.js';
export * from './tool-output.codec.js';
export * from './redacted-stub.codec.js';
export * from './unsafe-text.codec.js';
export * from './user-turn.codec.js';

import type { BlockCodec } from '../types/codec.js';
import { SystemRulesCodec } from './system-rules.codec.js';
import { ToolSchemaCodec } from './tool-schema.codec.js';
import { StructuredReferenceCodec } from './structured-reference.codec.js';
import { ConversationHistoryCodec } from './conversation-history.codec.js';
import { ToolOutputCodec } from './tool-output.codec.js';
import { RedactedStubCodec } from './redacted-stub.codec.js';
import { UnsafeTextCodec } from './unsafe-text.codec.js';
import { UserTurnCodec } from './user-turn.codec.js';

/**
 * Built-in codec registry.
 * Maps codecId -> codec implementation.
 */
export const BUILT_IN_CODECS: Record<string, BlockCodec> = {
  'system-rules': SystemRulesCodec,
  'tool-schema': ToolSchemaCodec,
  'structured-reference': StructuredReferenceCodec,
  'conversation-history': ConversationHistoryCodec,
  'tool-output': ToolOutputCodec,
  'redacted-stub': RedactedStubCodec,
  'unsafe-text': UnsafeTextCodec,
  'user-turn': UserTurnCodec,
};

/**
 * Get codec by ID.
 *
 * @param codecId - Codec identifier
 * @returns Codec implementation, or undefined if not found
 */
export function getCodec(codecId: string): BlockCodec | undefined {
  return BUILT_IN_CODECS[codecId];
}

/**
 * Register custom codec.
 *
 * @param codec - Custom codec implementation
 */
export function registerCodec(codec: BlockCodec): void {
  if (BUILT_IN_CODECS[codec.codecId]) {
    throw new Error(`Codec already registered: ${codec.codecId}`);
  }
  BUILT_IN_CODECS[codec.codecId] = codec;
}
