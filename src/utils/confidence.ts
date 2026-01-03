/**
 * Confidence tier calculation utilities
 *
 * Calculates evidence-based confidence tiers:
 * - grounded: Linked to code, recently verified
 * - observed: Has event evidence or user-approved
 * - inferred: Extracted by AI, not confirmed
 * - hypothesis: No evidence, suggested only
 */

import type { CodeReference } from '../types/code-refs.ts';
import type { ConfidenceTier, MemoryObject, ReviewStatus } from '../types/memory-objects.ts';

// How old (in days) a verification can be and still count as "recent"
const RECENT_VERIFICATION_DAYS = 7;

/**
 * Calculate the confidence tier for a memory object
 */
export function calculateConfidenceTier(obj: {
  codeRefs?: CodeReference[];
  lastVerifiedAt?: Date;
  reviewStatus?: ReviewStatus;
  evidenceEventIds?: string[];
}): ConfidenceTier {
  const hasCodeRefs = obj.codeRefs && obj.codeRefs.length > 0;
  const hasRecentVerification = obj.lastVerifiedAt && isRecent(obj.lastVerifiedAt);
  const isApproved = obj.reviewStatus === 'approved';
  const hasEvidence = obj.evidenceEventIds && obj.evidenceEventIds.length > 0;

  // Grounded: has code refs AND recently verified
  if (hasCodeRefs && hasRecentVerification) {
    return 'grounded';
  }

  // Observed: approved by user OR has evidence events
  if (isApproved || hasEvidence) {
    return 'observed';
  }

  // Inferred: has code refs but not verified, or pending review
  if (hasCodeRefs || obj.reviewStatus === 'pending') {
    return 'inferred';
  }

  // Hypothesis: no evidence at all
  return 'hypothesis';
}

/**
 * Check if a date is recent (within threshold)
 */
function isRecent(date: Date, thresholdDays: number = RECENT_VERIFICATION_DAYS): boolean {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays <= thresholdDays;
}

/**
 * Get confidence tier priority (higher = more trusted)
 */
export function getConfidenceTierPriority(tier: ConfidenceTier): number {
  switch (tier) {
    case 'grounded':
      return 4;
    case 'observed':
      return 3;
    case 'inferred':
      return 2;
    case 'hypothesis':
      return 1;
    default:
      return 0;
  }
}

/**
 * Compare two confidence tiers
 * Returns positive if a > b, negative if a < b, 0 if equal
 */
export function compareConfidenceTiers(a: ConfidenceTier, b: ConfidenceTier): number {
  return getConfidenceTierPriority(a) - getConfidenceTierPriority(b);
}

/**
 * Get human-readable description of confidence tier
 */
export function getConfidenceTierDescription(tier: ConfidenceTier): string {
  switch (tier) {
    case 'grounded':
      return 'Linked to code and recently verified';
    case 'observed':
      return 'Has evidence or user-approved';
    case 'inferred':
      return 'AI-extracted, not confirmed';
    case 'hypothesis':
      return 'No evidence, suggested only';
    default:
      return 'Unknown';
  }
}

/**
 * Get emoji for confidence tier
 */
export function getConfidenceTierEmoji(tier: ConfidenceTier): string {
  switch (tier) {
    case 'grounded':
      return '✅';
    case 'observed':
      return '👁️';
    case 'inferred':
      return '🤖';
    case 'hypothesis':
      return '💭';
    default:
      return '•';
  }
}

// Aliases for backward compatibility
export const getConfidenceEmoji = getConfidenceTierEmoji;
export const getConfidenceLabel = getConfidenceTierDescription;

/**
 * Get retrieval boost multiplier for confidence tier
 */
export function getConfidenceBoost(tier: ConfidenceTier): number {
  switch (tier) {
    case 'grounded':
      return 2.0;
    case 'observed':
      return 1.5;
    case 'inferred':
      return 1.0;
    case 'hypothesis':
      return 0.5;
    default:
      return 1.0;
  }
}

/**
 * Should this tier be included in retrieval by default?
 */
export function shouldIncludeInRetrieval(tier: ConfidenceTier): boolean {
  // Exclude hypothesis by default - too unreliable
  return tier !== 'hypothesis';
}

/**
 * Upgrade confidence tier based on new evidence
 */
export function upgradeConfidenceTier(
  currentTier: ConfidenceTier,
  evidence: {
    codeRefsAdded?: boolean;
    verified?: boolean;
    approved?: boolean;
    evidenceAdded?: boolean;
  },
): ConfidenceTier {
  // Can always upgrade to grounded if code refs + verified
  if (evidence.codeRefsAdded && evidence.verified) {
    return 'grounded';
  }

  // Can upgrade to observed if approved or evidence added
  if (evidence.approved || evidence.evidenceAdded) {
    return currentTier === 'grounded' ? 'grounded' : 'observed';
  }

  // Code refs alone upgrade to inferred
  if (evidence.codeRefsAdded && currentTier === 'hypothesis') {
    return 'inferred';
  }

  return currentTier;
}

/**
 * Downgrade confidence tier based on staleness
 */
export function downgradeConfidenceTier(
  currentTier: ConfidenceTier,
  reason: 'file_changed' | 'file_deleted' | 'time_decay' | 'conflict',
): ConfidenceTier {
  switch (reason) {
    case 'file_deleted':
      // File gone - can't be grounded anymore
      return currentTier === 'grounded' ? 'observed' : currentTier;

    case 'file_changed':
      // File changed - needs re-verification
      return currentTier === 'grounded' ? 'inferred' : currentTier;

    case 'time_decay':
      // Old verification - downgrade one level
      if (currentTier === 'grounded') return 'observed';
      if (currentTier === 'observed') return 'inferred';
      return currentTier;

    case 'conflict':
      // Conflicting information - downgrade significantly
      if (currentTier === 'grounded') return 'inferred';
      if (currentTier === 'observed') return 'hypothesis';
      return currentTier;

    default:
      return currentTier;
  }
}
