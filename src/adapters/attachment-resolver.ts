/**
 * AttachmentResolver: Versioned resolution of attachments with provenance.
 *
 * Responsibilities:
 * - Resolve attachment references to actual content
 * - Support different resolution levels (metadata_only, extract, full)
 * - Generate derived blocks with provenance tracking
 * - Compute snapshot hashes for reproducibility
 */

import type { ContextBlock, BlockKind } from '../types/block.js';
import type { AttachmentRef, AttachmentMeta, AttachmentMimeType } from '../types/attachment.js';
import { computeBlockHash } from '../types/hash.js';

/**
 * Resolution level for attachments.
 */
export type AttachmentResolutionLevel =
  | 'metadata_only'  // Only metadata (filename, size, type)
  | 'extract'        // Extract text/structured data (PDFs -> text, images -> OCR)
  | 'full';          // Full content (base64-encoded for images)

/**
 * Resolved attachment part (for multi-part content).
 */
export interface AttachmentPart {
  /** Part type */
  type: 'text' | 'image' | 'json';

  /** Text content (for text parts) */
  text?: string;

  /** Image content (base64-encoded, for image parts) */
  image?: {
    data: string;
    mimeType: AttachmentMimeType;
  };

  /** JSON content (for json parts) */
  json?: unknown;

  /** Optional description */
  description?: string;
}

/**
 * Resolved attachment with content and derived blocks.
 * Extended version with provenance tracking.
 */
export interface ResolvedAttachmentWithProvenance extends AttachmentMeta {
  /** Resolution level used */
  level: AttachmentResolutionLevel;

  /** Resolved content parts */
  parts: AttachmentPart[];

  /** Derived blocks (generated from attachment content) */
  derivedBlocks: ContextBlock[];

  /** Snapshot hash (for reproducibility) */
  snapshotHash: string;

  /** Resolver version (for debugging) */
  resolverVersion: string;
}

/**
 * Attachment resolver interface.
 */
export interface AttachmentResolver {
  /** Resolver identifier */
  resolverId: string;

  /** Resolver version */
  version: string;

  /**
   * Resolve an attachment reference to actual content.
   *
   * @param ref - Attachment reference
   * @param level - Resolution level
   * @returns Resolved attachment with derived blocks
   */
  resolve(
    ref: AttachmentRef,
    level: AttachmentResolutionLevel
  ): Promise<ResolvedAttachmentWithProvenance>;
}

/**
 * Create a snapshot hash for a resolved attachment.
 * Used for reproducibility and change detection.
 *
 * @param attachmentId - Attachment ID
 * @param level - Resolution level
 * @param parts - Resolved parts
 * @param resolverVersion - Resolver version
 * @returns Snapshot hash
 */
export function createSnapshotHash(
  attachmentId: string,
  level: AttachmentResolutionLevel,
  parts: AttachmentPart[],
  resolverVersion: string
): string {
  const snapshot = {
    attachmentId,
    level,
    parts: parts.map((part) => ({
      type: part.type,
      // Hash content without including full data
      textHash: part.text ? computeBlockHash({ kind: 'reference' as BlockKind, sensitivity: 'public', codecId: 'text', codecVersion: '1.0.0' }, { text: part.text }) : undefined,
      imageHash: part.image ? computeBlockHash({ kind: 'reference' as BlockKind, sensitivity: 'public', codecId: 'image', codecVersion: '1.0.0' }, { data: part.image.data, mimeType: part.image.mimeType }) : undefined,
      jsonHash: part.json ? computeBlockHash({ kind: 'reference' as BlockKind, sensitivity: 'public', codecId: 'json', codecVersion: '1.0.0' }, part.json) : undefined,
    })),
    resolverVersion,
  };

  return computeBlockHash(
    { kind: 'reference' as BlockKind, sensitivity: 'public', codecId: 'attachment-snapshot', codecVersion: '1.0.0' },
    snapshot
  );
}

/**
 * Create derived blocks from resolved attachment parts.
 *
 * @param attachmentId - Attachment ID
 * @param parts - Resolved parts
 * @param parentHash - Parent block hash (for provenance)
 * @returns Array of derived blocks
 */
export function createDerivedBlocks(
  attachmentId: string,
  parts: AttachmentPart[],
  parentHash: string
): ContextBlock[] {
  const blocks: ContextBlock[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (part.type === 'text' && part.text) {
      const payload = {
        text: part.text,
        source: attachmentId,
        partIndex: i,
        description: part.description,
      };

      const blockHash = computeBlockHash(
        { kind: 'reference', sensitivity: 'public', codecId: 'attachment-text', codecVersion: '1.0.0' },
        payload
      );

      blocks.push({
        blockHash,
        meta: {
          kind: 'reference',
          sensitivity: 'public',
          codecId: 'attachment-text',
          codecVersion: '1.0.0',
          createdAt: Math.floor(Date.now() / 1000),
          source: attachmentId,
        },
        payload,
      });
    } else if (part.type === 'image' && part.image) {
      const payload = {
        data: part.image.data,
        mimeType: part.image.mimeType,
        source: attachmentId,
        partIndex: i,
        description: part.description,
      };

      const blockHash = computeBlockHash(
        { kind: 'reference', sensitivity: 'public', codecId: 'attachment-image', codecVersion: '1.0.0' },
        payload
      );

      blocks.push({
        blockHash,
        meta: {
          kind: 'reference',
          sensitivity: 'public',
          codecId: 'attachment-image',
          codecVersion: '1.0.0',
          createdAt: Math.floor(Date.now() / 1000),
          source: attachmentId,
        },
        payload,
      });
    } else if (part.type === 'json' && part.json) {
      const payload = {
        data: part.json,
        source: attachmentId,
        partIndex: i,
        description: part.description,
      };

      const blockHash = computeBlockHash(
        { kind: 'reference', sensitivity: 'public', codecId: 'attachment-json', codecVersion: '1.0.0' },
        payload
      );

      blocks.push({
        blockHash,
        meta: {
          kind: 'reference',
          sensitivity: 'public',
          codecId: 'attachment-json',
          codecVersion: '1.0.0',
          createdAt: Math.floor(Date.now() / 1000),
          source: attachmentId,
        },
        payload,
      });
    }
  }

  return blocks;
}

/**
 * Default attachment resolver (stub implementation).
 * In production, this would integrate with actual storage backends (S3, GCS, etc.).
 */
export class DefaultAttachmentResolver implements AttachmentResolver {
  resolverId = 'default-resolver';
  version = '1.0.0';

  async resolve(
    ref: AttachmentRef,
    level: AttachmentResolutionLevel
  ): Promise<ResolvedAttachmentWithProvenance> {
    // Stub implementation - in production, this would:
    // 1. Fetch attachment metadata from storage
    // 2. Fetch content based on resolution level
    // 3. Process content (extract text, OCR images, etc.)
    // 4. Generate derived blocks

    // For now, return a minimal resolved attachment
    const parts: AttachmentPart[] = [];

    if (level === 'metadata_only') {
      // No content parts for metadata_only
    } else if (level === 'extract') {
      // Extract text/structured data
      parts.push({
        type: 'text',
        text: `Extracted content from ${ref.attachmentId}`,
        description: ref.description,
      });
    } else if (level === 'full') {
      // Full content (would be base64-encoded image data in production)
      parts.push({
        type: 'text',
        text: `Full content of ${ref.attachmentId}`,
        description: ref.description,
      });
    }

    const snapshotHash = createSnapshotHash(
      ref.attachmentId,
      level,
      parts,
      this.version
    );

    const derivedBlocks = createDerivedBlocks(
      ref.attachmentId,
      parts,
      ref.attachmentId // Parent hash (would be actual block hash in production)
    );

    return {
      // Metadata (would be fetched from storage in production)
      attachmentId: ref.attachmentId,
      mimeType: 'text/plain',
      sizeBytes: 0,
      filename: ref.attachmentId,
      storage: 'local',
      storagePath: '',
      createdAt: Math.floor(Date.now() / 1000),

      // Resolution results
      level,
      parts,
      derivedBlocks,
      snapshotHash,
      resolverVersion: this.version,
    };
  }
}
