/**
 * Confidence tier calculation based on evidence
 */

import type { CodeReference } from '../types/code-refs.ts';
import type { ConfidenceTier, ReviewStatus } from '../types/memory-objects.ts';

export interface ConfidenceInput {
  codeRefs?: CodeReference[];
  evidenceEventIds?: string[];
  reviewStatus?: ReviewStatus;
  lastVerifiedAt?: Date;
  status?: string;
}

/**
 * Calculate confidence tier based on evidence
 * 
 * Tiers (highest to lowest):
 * - grounded: Has code refs AND recently verified AND approved
 * - observed: Has event evidence OR approved (no code refs)
 * - inferred: Pending review (extracted by AI)
 * - hypothesis: No evidence, rejected, or stale
 */
export function calculateConfidenceTier(input: ConfidenceInput): ConfidenceTier {
  const hasCodeRefs = input.codeRefs && input.codeRefs.length > 0;
  const hasVerifiedCodeRefs = hasCodeRefs && input.codeRefs!.some(ref => ref.verifiedAtCommit);
  const hasEvents = input.evidenceEventIds && input.evidenceEventIds.length > 0;
  const isApproved = input.reviewStatus === 'approved';
  const isPending = input.reviewStatus === 'pending';
  const isVerified = input.lastVerifiedAt !== undefined;
  const isStale = input.status === 'stale';
  
  // Stale memories downgrade to hypothesis
  if (isStale) {
    return 'hypothesis';
  }
  
  // Grounded: code refs + verified + approved
  if (hasVerifiedCodeRefs && isVerified && isApproved) {
    return 'grounded';
  }
  
  // Also grounded if has code refs and is approved (even without lastVerifiedAt)
  if (hasCodeRefs && isApproved) {
    return 'grounded';
  }
  
  // Observed: has event evidence or is approved
  if (hasEvents || isApproved) {
    return 'observed';
  }
  
  // Inferred: pending review (AI-extracted, not confirmed)
  if (isPending) {
    return 'inferred';
  }
  
  // Hypothesis: no evidence
  return 'hypothesis';
}

/**
 * Get boost factor for retrieval based on confidence tier
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
  }
}

/**
 * Get display emoji for confidence tier
 */
export function getConfidenceEmoji(tier: ConfidenceTier): string {
  switch (tier) {
    case 'grounded':
      return '✅';
    case 'observed':
      return '👁️';
    case 'inferred':
      return '🤖';
    case 'hypothesis':
      return '💭';
  }
}

/**
 * Get display label for confidence tier
 */
export function getConfidenceLabel(tier: ConfidenceTier): string {
  switch (tier) {
    case 'grounded':
      return 'Verified (code-linked)';
    case 'observed':
      return 'Observed (from conversation)';
    case 'inferred':
      return 'Inferred (AI-extracted)';
    case 'hypothesis':
      return 'Hypothesis (unverified)';
  }
}
