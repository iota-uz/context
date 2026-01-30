/**
 * Attachment types for external content (images, PDFs, etc.).
 */

/**
 * Attachment MIME type.
 */
export type AttachmentMimeType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp'
  | 'image/gif'
  | 'application/pdf'
  | 'text/plain'
  | 'text/markdown'
  | 'application/json';

/**
 * Attachment storage backend.
 */
export type AttachmentStorage = 'local' | 's3' | 'gcs';

/**
 * Attachment metadata.
 */
export interface AttachmentMeta {
  /** Attachment ID (content-addressed hash) */
  attachmentId: string;

  /** MIME type */
  mimeType: AttachmentMimeType;

  /** File size (bytes) */
  sizeBytes: number;

  /** Original filename (if available) */
  filename?: string;

  /** Storage backend */
  storage: AttachmentStorage;

  /** Storage path (backend-specific) */
  storagePath: string;

  /** Created timestamp (Unix seconds) */
  createdAt: number;
}

/**
 * Attachment reference in context block.
 */
export interface AttachmentRef {
  /** Attachment ID */
  attachmentId: string;

  /** Optional description/caption */
  description?: string;
}

/**
 * Resolved attachment with content.
 */
export interface ResolvedAttachment extends AttachmentMeta {
  /** Base64-encoded content (for images, PDFs) */
  content?: string;

  /** Text content (for text/plain, text/markdown) */
  text?: string;

  /** Parsed JSON content (for application/json) */
  json?: unknown;
}

/**
 * Attachment selection result (for token budgeting).
 */
export interface AttachmentSelection {
  /** Selected attachments */
  selected: ResolvedAttachment[];

  /** Excluded attachments (over budget) */
  excluded: AttachmentRef[];

  /** Total tokens consumed */
  totalTokens: number;
}
