/**
 * Block codec interface for rendering and validation.
 */

import { z } from 'zod';
import type { ContextBlock } from './block.js';

/**
 * Provider-specific rendered content.
 */
export interface RenderedContent {
  /** Anthropic Claude format */
  anthropic?: unknown;

  /** OpenAI GPT format */
  openai?: unknown;

  /** Google Gemini format */
  gemini?: unknown;
}

/**
 * Block codec for content rendering and validation.
 */
export interface BlockCodec<TPayload = unknown> {
  /** Unique codec identifier */
  codecId: string;

  /** Codec version (semver) */
  version: string;

  /** Payload schema for validation */
  payloadSchema: z.ZodSchema<TPayload>;

  /**
   * Canonicalize payload for deterministic hashing.
   * Must produce identical output for semantically equivalent inputs.
   *
   * @param payload - Raw payload
   * @returns Canonicalized payload (serializable)
   */
  canonicalize(payload: TPayload): unknown;

  /**
   * Compute stable hash from canonicalized payload.
   * Default: SHA-256 of JSON.stringify(canonicalized).
   *
   * @param canonicalized - Canonicalized payload
   * @returns Hex-encoded hash
   */
  hash(canonicalized: unknown): string;

  /**
   * Render block content for provider-specific formats.
   *
   * @param block - Context block
   * @returns Rendered content for each provider
   */
  render(block: ContextBlock<TPayload>): RenderedContent;

  /**
   * Validate payload against schema.
   * Throws on validation failure.
   *
   * @param payload - Payload to validate
   */
  validate(payload: unknown): TPayload;
}
