/**
 * Conflict Detector - Identifies contradictions between memories
 *
 * Tier 2 escalation triggers:
 * - New memory contradicts existing memory
 * - Multiple memories about same topic with different content
 * - Memory contradicts current code state
 *
 * Resolution: Human-in-the-loop via CLI review queue
 */

import type { Database } from 'bun:sqlite';
import { FTSIndex } from '../indexes/fts.ts';
import { MemoryObjectStore } from '../stores/memory-objects.ts';
import type {
  MemoryCandidate,
  MemoryObject,
  ObjectType,
  ReviewStatus,
} from '../types/memory-objects.ts';

export interface Conflict {
  id: string;
  type: ConflictType;
  severity: 'low' | 'medium' | 'high';
  newCandidate: MemoryCandidate;
  existingMemories: MemoryObject[];
  description: string;
  suggestedResolution: ResolutionOption;
  createdAt: Date;
  resolvedAt?: Date;
  resolution?: Resolution;
}

export type ConflictType =
  | 'contradiction' // New memory says opposite of existing
  | 'duplicate' // Same content, different memory
  | 'supersession' // New info updates old info
  | 'ambiguity'; // Multiple valid interpretations

export type ResolutionOption =
  | 'keep_existing' // Discard new candidate
  | 'replace' // Supersede existing with new
  | 'merge' // Combine into single memory
  | 'keep_both' // Both are valid (different contexts)
  | 'reject_both'; // Both are suspect

export interface Resolution {
  option: ResolutionOption;
  resolvedBy: 'human' | 'auto';
  reason?: string;
  resultingMemoryId?: string;
}

// Patterns that indicate contradiction
const CONTRADICTION_PATTERNS = [
  { positive: /always/i, negative: /never/i },
  { positive: /must/i, negative: /must\s+not|mustn't/i },
  { positive: /should/i, negative: /should\s+not|shouldn't/i },
  { positive: /use/i, negative: /don't\s+use|avoid/i },
  { positive: /enable/i, negative: /disable/i },
  { positive: /true/i, negative: /false/i },
  { positive: /yes/i, negative: /no/i },
];

// Similarity threshold for duplicate detection
const DUPLICATE_THRESHOLD = 0.85;
const RELATED_THRESHOLD = 0.5;

export class ConflictDetector {
  private store: MemoryObjectStore;
  private fts: FTSIndex;
  private pendingConflicts: Map<string, Conflict> = new Map();

  constructor(private db: Database) {
    this.store = new MemoryObjectStore(db);
    this.fts = new FTSIndex(db);
  }

  /**
   * Check a candidate for conflicts with existing memories
   */
  detectConflicts(candidate: MemoryCandidate): Conflict[] {
    const conflicts: Conflict[] = [];

    // Find related existing memories
    const related = this.findRelatedMemories(candidate);

    for (const existing of related) {
      // Check for duplicates
      const similarity = this.calculateSimilarity(candidate.content, existing.content);
      if (similarity > DUPLICATE_THRESHOLD) {
        conflicts.push(
          this.createConflict(
            'duplicate',
            candidate,
            [existing],
            'high',
            `Near-duplicate of existing memory (${(similarity * 100).toFixed(0)}% similar)`,
          ),
        );
        continue;
      }

      // Check for contradictions
      const contradiction = this.detectContradiction(candidate.content, existing.content);
      if (contradiction) {
        conflicts.push(
          this.createConflict(
            'contradiction',
            candidate,
            [existing],
            'high',
            `Contradicts existing memory: ${contradiction}`,
          ),
        );
        continue;
      }

      // Check for supersession (same topic, different info)
      if (
        similarity > RELATED_THRESHOLD &&
        this.isSameType(candidate.suggestedType, existing.objectType)
      ) {
        conflicts.push(
          this.createConflict(
            'supersession',
            candidate,
            [existing],
            'medium',
            `May update existing ${existing.objectType} memory`,
          ),
        );
      }
    }

    // Check for ambiguity (multiple related memories)
    if (related.length > 1 && conflicts.length === 0) {
      const ambiguous = this.detectAmbiguity(candidate, related);
      if (ambiguous) {
        conflicts.push(ambiguous);
      }
    }

    // Store pending conflicts
    for (const conflict of conflicts) {
      this.pendingConflicts.set(conflict.id, conflict);
    }

    return conflicts;
  }

  /**
   * Find memories related to a candidate
   */
  private findRelatedMemories(candidate: MemoryCandidate): MemoryObject[] {
    // Use FTS to find similar content
    try {
      const searchResults = this.fts.searchObjects(candidate.content, ['active'], 10);
      return searchResults
        .map((r) => r.object)
        .filter((obj): obj is MemoryObject => obj !== undefined);
    } catch {
      // FTS table might not exist or be empty
      return [];
    }
  }

  /**
   * Calculate content similarity (simple Jaccard-like)
   */
  private calculateSimilarity(a: string, b: string): number {
    const tokensA = new Set(this.tokenize(a));
    const tokensB = new Set(this.tokenize(b));

    const intersection = new Set([...tokensA].filter((x) => tokensB.has(x)));
    const union = new Set([...tokensA, ...tokensB]);

    return intersection.size / union.size;
  }

  /**
   * Tokenize text for comparison
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2);
  }

  /**
   * Detect if two texts contradict each other
   */
  private detectContradiction(newText: string, existingText: string): string | null {
    const newLower = newText.toLowerCase();
    const existingLower = existingText.toLowerCase();

    for (const pattern of CONTRADICTION_PATTERNS) {
      const newHasPositive = pattern.positive.test(newLower);
      const newHasNegative = pattern.negative.test(newLower);
      const existingHasPositive = pattern.positive.test(existingLower);
      const existingHasNegative = pattern.negative.test(existingLower);

      // Check for direct opposition
      if ((newHasPositive && existingHasNegative) || (newHasNegative && existingHasPositive)) {
        return `${pattern.positive.source} vs ${pattern.negative.source}`;
      }
    }

    return null;
  }

  /**
   * Check if types are compatible for supersession
   */
  private isSameType(a: ObjectType, b: ObjectType): boolean {
    // Direct match
    if (a === b) return true;

    // Related types
    const related: Record<ObjectType, ObjectType[]> = {
      decision: ['convention', 'preference'],
      convention: ['decision', 'preference'],
      preference: ['decision', 'convention'],
      constraint: ['decision'],
      known_fix: ['failed_attempt'],
      failed_attempt: ['known_fix'],
      environment: [],
    };

    return related[a]?.includes(b) ?? false;
  }

  /**
   * Detect ambiguity when multiple memories relate to same topic
   */
  private detectAmbiguity(candidate: MemoryCandidate, related: MemoryObject[]): Conflict | null {
    // Check if related memories themselves conflict
    for (let i = 0; i < related.length; i++) {
      for (let j = i + 1; j < related.length; j++) {
        const contradiction = this.detectContradiction(related[i].content, related[j].content);
        if (contradiction) {
          return this.createConflict(
            'ambiguity',
            candidate,
            related,
            'medium',
            `Existing memories have conflicting information`,
          );
        }
      }
    }
    return null;
  }

  /**
   * Create a conflict record
   */
  private createConflict(
    type: ConflictType,
    candidate: MemoryCandidate,
    existing: MemoryObject[],
    severity: 'low' | 'medium' | 'high',
    description: string,
  ): Conflict {
    return {
      id: `conflict_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      severity,
      newCandidate: candidate,
      existingMemories: existing,
      description,
      suggestedResolution: this.suggestResolution(type, candidate, existing),
      createdAt: new Date(),
    };
  }

  /**
   * Suggest a resolution based on conflict type
   */
  private suggestResolution(
    type: ConflictType,
    candidate: MemoryCandidate,
    existing: MemoryObject[],
  ): ResolutionOption {
    switch (type) {
      case 'duplicate':
        // Keep existing unless candidate has better evidence
        return candidate.evidenceEventIds.length > (existing[0]?.evidenceEventIds.length ?? 0)
          ? 'replace'
          : 'keep_existing';

      case 'contradiction':
        // Need human review
        return 'keep_existing'; // Safe default

      case 'supersession':
        // New info usually better
        return 'replace';

      case 'ambiguity':
        // Need human to clarify
        return 'keep_both';

      default:
        return 'keep_existing';
    }
  }

  /**
   * Get all pending conflicts
   */
  getPendingConflicts(): Conflict[] {
    return Array.from(this.pendingConflicts.values())
      .filter((c) => !c.resolvedAt)
      .sort((a, b) => {
        // Sort by severity (high first), then by date
        const severityOrder = { high: 0, medium: 1, low: 2 };
        const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
        if (severityDiff !== 0) return severityDiff;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
  }

  /**
   * Resolve a conflict with human decision
   */
  resolveConflict(conflictId: string, resolution: Resolution): MemoryObject | null {
    const conflict = this.pendingConflicts.get(conflictId);
    if (!conflict) return null;

    conflict.resolvedAt = new Date();
    conflict.resolution = resolution;

    switch (resolution.option) {
      case 'keep_existing':
        // Do nothing, candidate is discarded
        return conflict.existingMemories[0] ?? null;

      case 'replace': {
        // Supersede existing with new
        const reviewStatus = this.getReviewStatus(conflict.newCandidate, resolution);
        const newMemory = this.store.create({
          content: conflict.newCandidate.content,
          objectType: conflict.newCandidate.suggestedType,
          confidence: conflict.newCandidate.confidence,
          evidenceEventIds: conflict.newCandidate.evidenceEventIds,
          evidenceExcerpt: conflict.newCandidate.evidenceExcerpt,
          codeRefs: conflict.newCandidate.codeRefs,
          reviewStatus,
        });

        // Supersede existing
        for (const existing of conflict.existingMemories) {
          this.store.supersede(existing.id, newMemory.id);
        }

        return newMemory;
      }

      case 'merge': {
        // Combine content
        const mergedContent = this.mergeContent(
          conflict.newCandidate.content,
          conflict.existingMemories.map((m) => m.content),
        );
        const mergedEvidence = [
          ...conflict.newCandidate.evidenceEventIds,
          ...conflict.existingMemories.flatMap((m) => m.evidenceEventIds),
        ];
        const reviewStatus = this.getReviewStatus(
          {
            ...conflict.newCandidate,
            confidence: 'high',
            evidenceEventIds: mergedEvidence,
          },
          resolution,
        );

        const mergedMemory = this.store.create({
          content: mergedContent,
          objectType: conflict.newCandidate.suggestedType,
          confidence: 'high',
          evidenceEventIds: mergedEvidence,
          codeRefs: conflict.newCandidate.codeRefs,
          reviewStatus,
        });

        // Supersede all existing
        for (const existing of conflict.existingMemories) {
          this.store.supersede(existing.id, mergedMemory.id);
        }

        return mergedMemory;
      }

      case 'keep_both':
        // Add candidate as new memory
        const reviewStatus = this.getReviewStatus(conflict.newCandidate, resolution);
        return this.store.create({
          content: conflict.newCandidate.content,
          objectType: conflict.newCandidate.suggestedType,
          confidence: conflict.newCandidate.confidence,
          evidenceEventIds: conflict.newCandidate.evidenceEventIds,
          evidenceExcerpt: conflict.newCandidate.evidenceExcerpt,
          codeRefs: conflict.newCandidate.codeRefs,
          reviewStatus,
        });

      case 'reject_both':
        // Retire existing, don't add new
        for (const existing of conflict.existingMemories) {
          this.store.retire(existing.id);
        }
        return null;

      default:
        return null;
    }
  }

  /**
   * Merge multiple content strings
   */
  private mergeContent(newContent: string, existingContents: string[]): string {
    // Simple merge: use new content as base, note that it updates existing
    const existing = existingContents[0];
    if (!existing) return newContent;

    // If they're very similar, just use the new one
    if (this.calculateSimilarity(newContent, existing) > 0.7) {
      return newContent;
    }

    // Otherwise, create a combined statement
    return `${newContent}\n\n[Updated from: ${existing.slice(0, 100)}...]`;
  }

  /**
   * Determine review status for auto-resolved conflicts
   */
  private getReviewStatus(candidate: MemoryCandidate, resolution: Resolution): ReviewStatus {
    if (resolution.resolvedBy === 'human') {
      return 'approved';
    }

    const hasEvidence = candidate.evidenceEventIds.length > 0;
    const hasCodeRefs = candidate.codeRefs && candidate.codeRefs.length > 0;
    const isHighConfidence = candidate.confidence === 'high' || candidate.confidence === 'certain';

    return isHighConfidence && (hasEvidence || hasCodeRefs) ? 'approved' : 'pending';
  }

  /**
   * Auto-resolve low-severity conflicts
   */
  autoResolve(): number {
    let resolved = 0;

    for (const conflict of this.getPendingConflicts()) {
      // Only auto-resolve duplicates with clear winner
      if (conflict.type === 'duplicate' && conflict.severity !== 'high') {
        this.resolveConflict(conflict.id, {
          option: conflict.suggestedResolution,
          resolvedBy: 'auto',
          reason: 'Auto-resolved duplicate',
        });
        resolved++;
      }
    }

    return resolved;
  }

  /**
   * Clear resolved conflicts older than given days
   */
  clearOldConflicts(olderThanDays: number = 30): number {
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    let cleared = 0;

    for (const [id, conflict] of this.pendingConflicts) {
      if (conflict.resolvedAt && conflict.resolvedAt.getTime() < cutoff) {
        this.pendingConflicts.delete(id);
        cleared++;
      }
    }

    return cleared;
  }
}
