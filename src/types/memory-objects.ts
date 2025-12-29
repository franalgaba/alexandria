/**
 * Memory object types for curated knowledge storage
 */

import type { Scope } from './common.ts';
import type { CodeReference } from './code-refs.ts';
import type { StructuredData } from './structured.ts';

export type ObjectType =
  | 'decision'
  | 'preference'
  | 'convention'
  | 'known_fix'
  | 'constraint'
  | 'failed_attempt'
  | 'environment';

export type Status = 'active' | 'stale' | 'superseded' | 'retired';

/** @deprecated Use ConfidenceTier instead */
export type Confidence = 'certain' | 'high' | 'medium' | 'low';

/**
 * Evidence-based confidence tiers
 * - grounded: Linked to code, recently verified
 * - observed: Has event evidence or user-approved
 * - inferred: Extracted by AI, not confirmed
 * - hypothesis: No evidence, suggested only
 */
export type ConfidenceTier = 'grounded' | 'observed' | 'inferred' | 'hypothesis';

export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export interface MemoryObject {
  id: string;
  content: string;
  objectType: ObjectType;
  scope: Scope;
  status: Status;
  supersededBy?: string;
  /** @deprecated Use confidenceTier instead */
  confidence: Confidence;
  /** Evidence-based confidence tier (auto-calculated) */
  confidenceTier: ConfidenceTier;
  evidenceEventIds: string[];
  evidenceExcerpt?: string;
  reviewStatus: ReviewStatus;
  reviewedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  accessCount: number;
  lastAccessed?: Date;
  /** Code references linking this memory to source files */
  codeRefs: CodeReference[];
  /** When this memory was last verified as still accurate */
  lastVerifiedAt?: Date;
  /** IDs of memories this one supersedes */
  supersedes?: string[];
  /** Structured data for enhanced memory types */
  structured?: StructuredData;
}

export interface MemoryObjectRow {
  id: string;
  content: string;
  object_type: string;
  scope_type: string;
  scope_path: string | null;
  status: string;
  superseded_by: string | null;
  confidence: string;
  evidence_event_ids: string;
  evidence_excerpt: string | null;
  review_status: string;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  access_count: number;
  last_accessed: string | null;
  code_refs: string | null;
  last_verified_at: string | null;
  supersedes: string | null;
  structured: string | null;
}

export interface CreateMemoryObjectInput {
  content: string;
  objectType: ObjectType;
  scope?: Scope;
  confidence?: Confidence;
  evidenceEventIds?: string[];
  evidenceExcerpt?: string;
  reviewStatus?: ReviewStatus;
  codeRefs?: CodeReference[];
  structured?: StructuredData;
}

export interface UpdateMemoryObjectInput {
  content?: string;
  status?: Status;
  supersededBy?: string;
  confidence?: Confidence;
  reviewStatus?: ReviewStatus;
  reviewedAt?: Date;
  codeRefs?: CodeReference[];
  lastVerifiedAt?: Date;
  structured?: StructuredData;
}

export interface MemoryCandidate {
  content: string;
  suggestedType: ObjectType;
  evidenceEventIds: string[];
  evidenceExcerpt?: string;
  confidence: Confidence;
  codeRefs?: CodeReference[];
}
