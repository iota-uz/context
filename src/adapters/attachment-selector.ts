/**
 * AttachmentSelector: Token budget-aware attachment selection.
 *
 * Selects attachments based on policy-driven ranking with deterministic ordering.
 */

import type { ResolvedAttachment, AttachmentRef } from '../types/attachment.js';
import type { AttachmentPolicy, AttachmentPurpose, RankingCriterion } from '../types/policy.js';
import type { TokenEstimator } from './token-estimator.js';

/**
 * Attachment with selection metadata.
 */
export interface RankedAttachment extends ResolvedAttachment {
  /** Attachment purpose (for ranking) */
  purpose: AttachmentPurpose;

  /** User explicitly mentioned this attachment */
  userMention: boolean;

  /** Ranking score (lower = higher priority) */
  rankScore: number;
}

/**
 * Selected attachments result.
 */
export interface SelectedAttachments {
  /** Selected attachments (within budget) */
  selected: ResolvedAttachment[];

  /** Excluded attachments (over budget) */
  excluded: AttachmentRef[];

  /** Total tokens used by selected attachments */
  tokensUsed: number;
}

/**
 * Compute rank score based on selection strategy.
 *
 * @param attachment - Ranked attachment
 * @param rankBy - Ranking criteria in priority order
 * @param purposePriority - Purpose priority mapping
 * @returns Rank score (lower = higher priority)
 */
function computeRankScore(
  attachment: RankedAttachment,
  rankBy: RankingCriterion[],
  purposePriority: Record<AttachmentPurpose, number>
): number {
  let score = 0;
  let multiplier = 1000; // High multiplier for primary criterion

  for (const criterion of rankBy) {
    switch (criterion) {
      case 'purpose':
        score += purposePriority[attachment.purpose] * multiplier;
        break;
      case 'user_mention':
        // User mention: 0 if mentioned, 1 if not
        score += (attachment.userMention ? 0 : 1) * multiplier;
        break;
      case 'recency':
        // More recent = lower score (inverted createdAt)
        score += (Date.now() / 1000 - attachment.createdAt) * multiplier * 0.01;
        break;
    }

    multiplier /= 100; // Reduce multiplier for next criterion
  }

  return score;
}

/**
 * Estimate tokens for an attachment.
 *
 * @param attachment - Resolved attachment
 * @returns Estimated tokens
 */
function estimateAttachmentTokens(attachment: ResolvedAttachment): number {
  // For text attachments, estimate from text content
  if (attachment.text) {
    // Rough estimate: 1 token per 4 characters
    return Math.ceil(attachment.text.length / 4);
  }

  // For images, use a heuristic based on size
  // (actual token count depends on image dimensions and provider)
  if (attachment.mimeType.startsWith('image/')) {
    // Rough estimate: ~85 tokens per 512x512 tile
    // Assume average image is ~4 tiles
    return 340;
  }

  // For PDFs and JSON, use a conservative estimate
  if (attachment.mimeType === 'application/pdf' || attachment.mimeType === 'application/json') {
    // Estimate based on content length if available
    if (attachment.content) {
      // Base64 content: approximate text length
      const textLength = Math.floor(attachment.content.length * 0.75);
      return Math.ceil(textLength / 4); // Rough token estimate
    }
    // Fallback: 500 tokens per attachment
    return 500;
  }

  // Default fallback
  return 100;
}

/**
 * AttachmentSelector: Select attachments with policy enforcement.
 */
export class AttachmentSelector {
  constructor(
    private readonly policy: AttachmentPolicy,
    private readonly estimator: TokenEstimator
  ) {}

  /**
   * Select attachments within token budget.
   * Deterministic: same inputs → same selection order.
   *
   * @param attachments - Ranked attachments to select from
   * @returns Selected attachments result
   */
  async selectAttachments(
    attachments: RankedAttachment[]
  ): Promise<SelectedAttachments> {
    const { maxTokensTotal, selectionStrategy } = this.policy;
    const { rankBy, purposePriority } = selectionStrategy;

    // Use default purpose priority if not provided
    const effectivePurposePriority = purposePriority ?? {
      evidence: 1,
      input: 2,
      context: 3,
      artifact: 4,
    };

    // Compute rank scores for all attachments
    const scoredAttachments = attachments.map((attachment) => ({
      ...attachment,
      rankScore: computeRankScore(attachment, rankBy, effectivePurposePriority),
    }));

    // Sort by rank score (ascending - lower score = higher priority)
    // Use attachmentId as tiebreaker for deterministic ordering
    scoredAttachments.sort((a, b) => {
      if (a.rankScore !== b.rankScore) {
        return a.rankScore - b.rankScore;
      }
      return a.attachmentId.localeCompare(b.attachmentId);
    });

    // Select attachments within budget
    const selected: ResolvedAttachment[] = [];
    const excluded: AttachmentRef[] = [];
    let tokensUsed = 0;

    for (const attachment of scoredAttachments) {
      // Estimate tokens for this attachment
      const attachmentTokens = estimateAttachmentTokens(attachment);

      // Check if adding this attachment would exceed budget
      if (tokensUsed + attachmentTokens > maxTokensTotal) {
        // Budget exceeded - exclude this attachment
        excluded.push({
          attachmentId: attachment.attachmentId,
          description: attachment.filename,
        });
        continue;
      }

      // Include attachment
      selected.push(attachment);
      tokensUsed += attachmentTokens;
    }

    return {
      selected,
      excluded,
      tokensUsed,
    };
  }

  /**
   * Select attachments from raw list with purpose/mention metadata.
   * Convenience method that wraps selectAttachments.
   *
   * @param attachments - Resolved attachments
   * @param metadata - Per-attachment metadata
   * @returns Selected attachments result
   */
  async selectFromList(
    attachments: ResolvedAttachment[],
    metadata: Map<string, { purpose: AttachmentPurpose; userMention: boolean }>
  ): Promise<SelectedAttachments> {
    // Build ranked attachments
    const ranked: RankedAttachment[] = attachments.map((attachment) => {
      const meta = metadata.get(attachment.attachmentId) ?? {
        purpose: 'context' as const,
        userMention: false,
      };

      return {
        ...attachment,
        purpose: meta.purpose,
        userMention: meta.userMention,
        rankScore: 0, // Will be computed in selectAttachments
      };
    });

    return this.selectAttachments(ranked);
  }
}
