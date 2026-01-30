/**
 * Unit tests for AttachmentSelector: budget enforcement and ranking.
 *
 * Tests:
 * - Budget enforcement (token limit)
 * - Ranking by purpose, user mention, recency
 * - Deterministic ordering (same input → same selection)
 * - Token estimation for different attachment types
 */

import { describe, it, expect } from 'vitest';
import { AttachmentSelector } from '../adapters/attachment-selector.js';
import type { RankedAttachment } from '../adapters/attachment-selector.js';
import type { AttachmentPolicy } from '../types/policy.js';
import type { ResolvedAttachment } from '../types/attachment.js';

// Mock TokenEstimator
const mockEstimator = {
  estimateTokens: async () => ({ tokens: 100 }),
} as any;

describe('AttachmentSelector', () => {
  describe('Budget Enforcement', () => {
    it('should select attachments within budget', async () => {
      const policy: AttachmentPolicy = {
        maxTokensTotal: 1000, // Budget for ~10 text attachments (100 tokens each)
        selectionStrategy: {
          rankBy: ['purpose'],
        },
      };

      const selector = new AttachmentSelector(policy, mockEstimator);

      const attachments: RankedAttachment[] = [
        createRankedAttachment('att1', 'evidence', false, 'Short text', 400), // ~100 tokens
        createRankedAttachment('att2', 'evidence', false, 'Short text', 400), // ~100 tokens
        createRankedAttachment('att3', 'evidence', false, 'Short text', 400), // ~100 tokens
      ];

      const result = await selector.selectAttachments(attachments);

      expect(result.selected).toHaveLength(3);
      expect(result.tokensUsed).toBeLessThanOrEqual(1000);
    });

    it('should exclude attachments over budget', async () => {
      const policy: AttachmentPolicy = {
        maxTokensTotal: 500, // Small budget
        selectionStrategy: {
          rankBy: ['purpose'],
        },
      };

      const selector = new AttachmentSelector(policy, mockEstimator);

      const largeText = 'x'.repeat(2000); // ~500 tokens
      const attachments: RankedAttachment[] = [
        createRankedAttachment('att1', 'evidence', false, largeText, 500), // ~500 tokens
        createRankedAttachment('att2', 'evidence', false, largeText, 500), // ~500 tokens (over budget)
      ];

      const result = await selector.selectAttachments(attachments);

      expect(result.selected).toHaveLength(1);
      expect(result.excluded).toHaveLength(1);
      expect(result.excluded[0].attachmentId).toBe('att2');
    });

    it('should track total tokens used', async () => {
      const policy: AttachmentPolicy = {
        maxTokensTotal: 2000,
        selectionStrategy: {
          rankBy: ['purpose'],
        },
      };

      const selector = new AttachmentSelector(policy, mockEstimator);

      const attachments: RankedAttachment[] = [
        createRankedAttachment('att1', 'evidence', false, 'Short text', 400), // ~100 tokens
        createRankedAttachment('att2', 'evidence', false, 'Short text', 400), // ~100 tokens
      ];

      const result = await selector.selectAttachments(attachments);

      expect(result.tokensUsed).toBeGreaterThan(0);
      expect(result.tokensUsed).toBeLessThanOrEqual(2000);
    });

    it('should handle zero budget gracefully', async () => {
      const policy: AttachmentPolicy = {
        maxTokensTotal: 0,
        selectionStrategy: {
          rankBy: ['purpose'],
        },
      };

      const selector = new AttachmentSelector(policy, mockEstimator);

      const attachments: RankedAttachment[] = [
        createRankedAttachment('att1', 'evidence', false, 'text', 100),
      ];

      const result = await selector.selectAttachments(attachments);

      expect(result.selected).toHaveLength(0);
      expect(result.excluded).toHaveLength(1);
      expect(result.tokensUsed).toBe(0);
    });
  });

  describe('Purpose Ranking', () => {
    it('should prioritize evidence > input > context > artifact', async () => {
      const policy: AttachmentPolicy = {
        maxTokensTotal: 200, // Only 2 attachments fit (100 tokens each)
        selectionStrategy: {
          rankBy: ['purpose'],
        },
      };

      const selector = new AttachmentSelector(policy, mockEstimator);

      // Each attachment: 400 chars = ~100 tokens (text.length / 4)
      const largeText = 'x'.repeat(400);
      const attachments: RankedAttachment[] = [
        createRankedAttachment('att1', 'artifact', false, largeText, 100), // Lowest priority
        createRankedAttachment('att2', 'evidence', false, largeText, 100), // Highest priority
        createRankedAttachment('att3', 'context', false, largeText, 100), // Medium priority
        createRankedAttachment('att4', 'input', false, largeText, 100), // High priority
      ];

      const result = await selector.selectAttachments(attachments);

      // Should select evidence and input (highest priority)
      expect(result.selected).toHaveLength(2);
      const selectedIds = result.selected.map((a) => a.attachmentId);
      expect(selectedIds).toContain('att2'); // evidence
      expect(selectedIds).toContain('att4'); // input
    });

    it('should use custom purpose priority if provided', async () => {
      const policy: AttachmentPolicy = {
        maxTokensTotal: 200,
        selectionStrategy: {
          rankBy: ['purpose'],
          purposePriority: {
            artifact: 1, // Highest
            context: 2,
            input: 3,
            evidence: 4, // Lowest
          },
        },
      };

      const selector = new AttachmentSelector(policy, mockEstimator);

      const attachments: RankedAttachment[] = [
        createRankedAttachment('att1', 'artifact', false, 'text', 100),
        createRankedAttachment('att2', 'evidence', false, 'text', 100),
      ];

      const result = await selector.selectAttachments(attachments);

      // Should prioritize artifact over evidence
      expect(result.selected).toHaveLength(2);
      expect(result.selected[0].attachmentId).toBe('att1'); // artifact first
    });
  });

  describe('User Mention Ranking', () => {
    it('should prioritize user-mentioned attachments', async () => {
      const policy: AttachmentPolicy = {
        maxTokensTotal: 200,
        selectionStrategy: {
          rankBy: ['user_mention'],
        },
      };

      const selector = new AttachmentSelector(policy, mockEstimator);

      // Each attachment: 400 chars = ~100 tokens
      const largeText = 'x'.repeat(400);
      const attachments: RankedAttachment[] = [
        createRankedAttachment('att1', 'context', false, largeText, 100), // Not mentioned
        createRankedAttachment('att2', 'context', true, largeText, 100), // User mentioned
        createRankedAttachment('att3', 'context', true, largeText, 100), // User mentioned
      ];

      const result = await selector.selectAttachments(attachments);

      // Should select mentioned attachments first
      expect(result.selected).toHaveLength(2);
      const selectedIds = result.selected.map((a) => a.attachmentId);
      expect(selectedIds).toContain('att2');
      expect(selectedIds).toContain('att3');
    });
  });

  describe('Recency Ranking', () => {
    it('should prioritize recent attachments', async () => {
      const now = Date.now() / 1000;

      const policy: AttachmentPolicy = {
        maxTokensTotal: 200,
        selectionStrategy: {
          rankBy: ['recency'],
        },
      };

      const selector = new AttachmentSelector(policy, mockEstimator);

      // Each attachment: 400 chars = ~100 tokens
      const largeText = 'x'.repeat(400);
      const attachments: RankedAttachment[] = [
        createRankedAttachment('att1', 'context', false, largeText, now - 1000), // Older
        createRankedAttachment('att2', 'context', false, largeText, now - 100), // Recent
        createRankedAttachment('att3', 'context', false, largeText, now - 10), // Most recent
      ];

      const result = await selector.selectAttachments(attachments);

      // Should select most recent
      expect(result.selected).toHaveLength(2);
      const selectedIds = result.selected.map((a) => a.attachmentId);
      expect(selectedIds).toContain('att3'); // Most recent
      expect(selectedIds).toContain('att2'); // Second most recent
    });
  });

  describe('Multi-Criterion Ranking', () => {
    it('should rank by multiple criteria in priority order', async () => {
      const policy: AttachmentPolicy = {
        maxTokensTotal: 200,
        selectionStrategy: {
          rankBy: ['user_mention', 'purpose'], // Mention first, then purpose
        },
      };

      const selector = new AttachmentSelector(policy, mockEstimator);

      // Each attachment: 400 chars = ~100 tokens
      const largeText = 'x'.repeat(400);
      const attachments: RankedAttachment[] = [
        createRankedAttachment('att1', 'evidence', false, largeText, 100), // Not mentioned, high purpose
        createRankedAttachment('att2', 'artifact', true, largeText, 100), // Mentioned, low purpose
        createRankedAttachment('att3', 'input', true, largeText, 100), // Mentioned, medium purpose
      ];

      const result = await selector.selectAttachments(attachments);

      // Should select mentioned attachments (att2, att3), prioritize input over artifact
      expect(result.selected).toHaveLength(2);
      const selectedIds = result.selected.map((a) => a.attachmentId);
      expect(selectedIds).toContain('att2');
      expect(selectedIds).toContain('att3');
    });
  });

  describe('Deterministic Ordering', () => {
    it('should produce same selection for same input', async () => {
      const policy: AttachmentPolicy = {
        maxTokensTotal: 500,
        selectionStrategy: {
          rankBy: ['purpose', 'recency'],
        },
      };

      const selector = new AttachmentSelector(policy, mockEstimator);

      const attachments: RankedAttachment[] = [
        createRankedAttachment('att1', 'evidence', false, 'text', 100),
        createRankedAttachment('att2', 'context', false, 'text', 200),
        createRankedAttachment('att3', 'input', false, 'text', 150),
      ];

      const result1 = await selector.selectAttachments([...attachments]);
      const result2 = await selector.selectAttachments([...attachments]);

      expect(result1.selected.map((a) => a.attachmentId)).toEqual(
        result2.selected.map((a) => a.attachmentId)
      );
    });

    it('should use attachmentId as tiebreaker', async () => {
      const policy: AttachmentPolicy = {
        maxTokensTotal: 200,
        selectionStrategy: {
          rankBy: ['purpose'], // Same purpose = tie
        },
      };

      const selector = new AttachmentSelector(policy, mockEstimator);

      // Each attachment: 400 chars = ~100 tokens
      const largeText = 'x'.repeat(400);
      const attachments: RankedAttachment[] = [
        createRankedAttachment('bbb', 'evidence', false, largeText, 100),
        createRankedAttachment('aaa', 'evidence', false, largeText, 100),
        createRankedAttachment('ccc', 'evidence', false, largeText, 100),
      ];

      const result = await selector.selectAttachments(attachments);

      // Should select in alphabetical order (tiebreaker)
      expect(result.selected).toHaveLength(2);
      expect(result.selected[0].attachmentId).toBe('aaa');
      expect(result.selected[1].attachmentId).toBe('bbb');
    });
  });

  describe('Token Estimation', () => {
    it('should estimate tokens for text attachments', async () => {
      const policy: AttachmentPolicy = {
        maxTokensTotal: 200,
        selectionStrategy: {
          rankBy: ['purpose'],
        },
      };

      const selector = new AttachmentSelector(policy, mockEstimator);

      // ~400 chars = ~100 tokens
      const text = 'x'.repeat(400);
      const attachments: RankedAttachment[] = [
        createRankedAttachment('att1', 'evidence', false, text, 100),
      ];

      const result = await selector.selectAttachments(attachments);

      expect(result.tokensUsed).toBeGreaterThan(0);
      expect(result.tokensUsed).toBeLessThanOrEqual(200);
    });

    it('should estimate tokens for image attachments', async () => {
      const policy: AttachmentPolicy = {
        maxTokensTotal: 1000,
        selectionStrategy: {
          rankBy: ['purpose'],
        },
      };

      const selector = new AttachmentSelector(policy, mockEstimator);

      const imageAttachment: RankedAttachment = {
        attachmentId: 'img1',
        purpose: 'evidence',
        userMention: false,
        rankScore: 0,
        filename: 'test.png',
        mimeType: 'image/png',
        sizeBytes: 1024,
        storage: 'local',
        storagePath: '/test/test.png',
        createdAt: Date.now() / 1000,
        content: 'base64data',
      };

      const result = await selector.selectAttachments([imageAttachment]);

      // Image should have conservative token estimate (~340 tokens)
      expect(result.tokensUsed).toBeGreaterThan(0);
    });

    it('should estimate tokens for PDF attachments', async () => {
      const policy: AttachmentPolicy = {
        maxTokensTotal: 1000,
        selectionStrategy: {
          rankBy: ['purpose'],
        },
      };

      const selector = new AttachmentSelector(policy, mockEstimator);

      const pdfAttachment: RankedAttachment = {
        attachmentId: 'pdf1',
        purpose: 'evidence',
        userMention: false,
        rankScore: 0,
        filename: 'doc.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        storage: 'local',
        storagePath: '/test/doc.pdf',
        createdAt: Date.now() / 1000,
        content: 'base64pdfdata',
      };

      const result = await selector.selectAttachments([pdfAttachment]);

      expect(result.tokensUsed).toBeGreaterThan(0);
    });
  });

  describe('selectFromList convenience method', () => {
    it('should build ranked attachments from list and metadata', async () => {
      const policy: AttachmentPolicy = {
        maxTokensTotal: 500,
        selectionStrategy: {
          rankBy: ['purpose'],
        },
      };

      const selector = new AttachmentSelector(policy, mockEstimator);

      const attachments: ResolvedAttachment[] = [
        {
          attachmentId: 'att1',
          filename: 'test.txt',
          mimeType: 'text/plain',
          sizeBytes: 12,
          storage: 'local',
          storagePath: '/test/test.txt',
          createdAt: Date.now() / 1000,
          text: 'Test content',
        },
        {
          attachmentId: 'att2',
          filename: 'test2.txt',
          mimeType: 'text/plain',
          sizeBytes: 14,
          storage: 'local',
          storagePath: '/test/test2.txt',
          createdAt: Date.now() / 1000,
          text: 'Test content 2',
        },
      ];

      const metadata = new Map([
        ['att1', { purpose: 'evidence' as const, userMention: true }],
        ['att2', { purpose: 'context' as const, userMention: false }],
      ]);

      const result = await selector.selectFromList(attachments, metadata);

      expect(result.selected).toHaveLength(2);
    });

    it('should use default metadata when not provided', async () => {
      const policy: AttachmentPolicy = {
        maxTokensTotal: 500,
        selectionStrategy: {
          rankBy: ['purpose'],
        },
      };

      const selector = new AttachmentSelector(policy, mockEstimator);

      const attachments: ResolvedAttachment[] = [
        {
          attachmentId: 'att1',
          filename: 'test.txt',
          mimeType: 'text/plain',
          sizeBytes: 12,
          storage: 'local',
          storagePath: '/test/test.txt',
          createdAt: Date.now() / 1000,
          text: 'Test content',
        },
      ];

      const metadata = new Map(); // Empty metadata

      const result = await selector.selectFromList(attachments, metadata);

      // Should use default: purpose = 'context', userMention = false
      expect(result.selected).toHaveLength(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty attachment list', async () => {
      const policy: AttachmentPolicy = {
        maxTokensTotal: 1000,
        selectionStrategy: {
          rankBy: ['purpose'],
        },
      };

      const selector = new AttachmentSelector(policy, mockEstimator);

      const result = await selector.selectAttachments([]);

      expect(result.selected).toHaveLength(0);
      expect(result.excluded).toHaveLength(0);
      expect(result.tokensUsed).toBe(0);
    });

    it('should handle single attachment', async () => {
      const policy: AttachmentPolicy = {
        maxTokensTotal: 1000,
        selectionStrategy: {
          rankBy: ['purpose'],
        },
      };

      const selector = new AttachmentSelector(policy, mockEstimator);

      const attachments: RankedAttachment[] = [
        createRankedAttachment('att1', 'evidence', false, 'text', 100),
      ];

      const result = await selector.selectAttachments(attachments);

      expect(result.selected).toHaveLength(1);
      expect(result.excluded).toHaveLength(0);
    });

    it('should handle all attachments over budget', async () => {
      const policy: AttachmentPolicy = {
        maxTokensTotal: 50, // Very small budget
        selectionStrategy: {
          rankBy: ['purpose'],
        },
      };

      const selector = new AttachmentSelector(policy, mockEstimator);

      const largeText = 'x'.repeat(1000);
      const attachments: RankedAttachment[] = [
        createRankedAttachment('att1', 'evidence', false, largeText, 100),
        createRankedAttachment('att2', 'evidence', false, largeText, 100),
      ];

      const result = await selector.selectAttachments(attachments);

      expect(result.selected).toHaveLength(0);
      expect(result.excluded).toHaveLength(2);
      expect(result.tokensUsed).toBe(0);
    });
  });
});

// Test helpers

function createRankedAttachment(
  id: string,
  purpose: 'evidence' | 'input' | 'context' | 'artifact',
  userMention: boolean,
  text: string,
  createdAt: number
): RankedAttachment {
  // If createdAt looks like a character count (small number), assume it's meant as a timestamp offset
  // Otherwise, treat it as Unix timestamp in seconds
  const normalizedCreatedAt = createdAt < 10000 ? Date.now() / 1000 - createdAt : createdAt;

  return {
    attachmentId: id,
    purpose,
    userMention,
    rankScore: 0, // Will be computed
    filename: `${id}.txt`,
    mimeType: 'text/plain',
    sizeBytes: text.length,
    storage: 'local',
    storagePath: `/test/${id}.txt`,
    createdAt: normalizedCreatedAt,
    text,
  };
}
