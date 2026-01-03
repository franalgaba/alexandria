/**
 * Contradiction Detector - find conflicting memories
 *
 * Conflict types:
 * - direct: same topic, opposite statements
 * - implicit: incompatible approaches
 * - temporal: old vs new without supersedes link
 */

import type { ConfidenceTier, MemoryObject } from '../types/memory-objects.ts';

export type ConflictType = 'direct' | 'implicit' | 'temporal';
export type Resolution = 'keep_newer' | 'keep_grounded' | 'merge' | 'ask_user';

export interface Conflict {
  /** The two conflicting memories */
  memories: [MemoryObject, MemoryObject];
  /** Type of conflict */
  type: ConflictType;
  /** Human-readable description */
  description: string;
  /** Suggested resolution */
  suggestedResolution: Resolution;
  /** Confidence in conflict detection (0-1) */
  confidence: number;
}

/** Words that indicate negation */
const NEGATION_WORDS = [
  'not',
  'never',
  'dont',
  "don't",
  'avoid',
  'stop',
  'remove',
  'disable',
  'without',
  'no',
  'none',
  'exclude',
];

/** Word pairs that are opposites */
const ANTONYM_PAIRS: [string, string][] = [
  ['always', 'never'],
  ['use', 'avoid'],
  ['enable', 'disable'],
  ['add', 'remove'],
  ['include', 'exclude'],
  ['sync', 'async'],
  ['tabs', 'spaces'],
  ['true', 'false'],
  ['yes', 'no'],
  ['rest', 'graphql'],
  ['sql', 'nosql'],
  ['monolith', 'microservice'],
];

/** Mutually exclusive technology choices */
const EXCLUSIVE_CHOICES: string[][] = [
  ['react', 'vue', 'angular', 'svelte'],
  ['rest', 'graphql', 'grpc'],
  ['mysql', 'postgresql', 'sqlite', 'mongodb'],
  ['npm', 'yarn', 'pnpm', 'bun'],
  ['jest', 'vitest', 'mocha'],
  ['tabs', 'spaces'],
];

export class ContradictionDetector {
  /**
   * Find all conflicts in a set of memories
   */
  findConflicts(memories: MemoryObject[]): Conflict[] {
    const conflicts: Conflict[] = [];

    // Compare each pair
    for (let i = 0; i < memories.length; i++) {
      for (let j = i + 1; j < memories.length; j++) {
        const conflict = this.checkPair(memories[i], memories[j]);
        if (conflict) {
          conflicts.push(conflict);
        }
      }
    }

    // Sort by confidence descending
    return conflicts.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Check if a new memory conflicts with existing ones
   */
  checkNewMemory(candidate: MemoryObject, existing: MemoryObject[]): Conflict[] {
    const conflicts: Conflict[] = [];

    for (const memory of existing) {
      const conflict = this.checkPair(candidate, memory);
      if (conflict) {
        conflicts.push(conflict);
      }
    }

    return conflicts.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Check if two memories conflict
   */
  private checkPair(a: MemoryObject, b: MemoryObject): Conflict | null {
    // Skip if one supersedes the other (intentional replacement)
    if (a.supersededBy === b.id || b.supersededBy === a.id) {
      return null;
    }
    if (a.supersedes?.includes(b.id) || b.supersedes?.includes(a.id)) {
      return null;
    }

    // Skip retired memories
    if (a.status === 'retired' || b.status === 'retired') {
      return null;
    }

    // Check for direct contradiction
    const direct = this.checkDirectContradiction(a, b);
    if (direct) return direct;

    // Check for implicit contradiction
    const implicit = this.checkImplicitContradiction(a, b);
    if (implicit) return implicit;

    // Check for temporal contradiction
    const temporal = this.checkTemporalContradiction(a, b);
    if (temporal) return temporal;

    return null;
  }

  /**
   * Check for direct contradiction (negation, antonyms)
   */
  private checkDirectContradiction(a: MemoryObject, b: MemoryObject): Conflict | null {
    const aLower = a.content.toLowerCase();
    const bLower = b.content.toLowerCase();
    const aWords = this.tokenize(aLower);
    const bWords = this.tokenize(bLower);

    // Check for negation pattern
    // "Use X" vs "Don't use X" or "Never use X"
    const aNegated = NEGATION_WORDS.some((n) => aLower.includes(n));
    const bNegated = NEGATION_WORDS.some((n) => bLower.includes(n));

    if (aNegated !== bNegated) {
      // One is negated, one isn't - check if they're about the same thing
      const similarity = this.wordOverlap(aWords, bWords);
      if (similarity > 0.4) {
        return {
          memories: [a, b],
          type: 'direct',
          description: `Potential negation conflict: "${this.truncate(a.content)}" vs "${this.truncate(b.content)}"`,
          suggestedResolution: this.suggestResolution(a, b),
          confidence: similarity,
        };
      }
    }

    // Check for antonym pairs
    for (const [word1, word2] of ANTONYM_PAIRS) {
      const aHas1 = aWords.includes(word1);
      const aHas2 = aWords.includes(word2);
      const bHas1 = bWords.includes(word1);
      const bHas2 = bWords.includes(word2);

      if ((aHas1 && bHas2) || (aHas2 && bHas1)) {
        // Check if they're about the same topic
        const similarity = this.wordOverlap(
          aWords.filter((w) => w !== word1 && w !== word2),
          bWords.filter((w) => w !== word1 && w !== word2),
        );

        if (similarity > 0.3) {
          return {
            memories: [a, b],
            type: 'direct',
            description: `Antonym conflict (${word1}/${word2}): "${this.truncate(a.content)}" vs "${this.truncate(b.content)}"`,
            suggestedResolution: this.suggestResolution(a, b),
            confidence: 0.7 + similarity * 0.3,
          };
        }
      }
    }

    return null;
  }

  /**
   * Check for implicit contradiction (mutually exclusive choices)
   */
  private checkImplicitContradiction(a: MemoryObject, b: MemoryObject): Conflict | null {
    const aLower = a.content.toLowerCase();
    const bLower = b.content.toLowerCase();

    for (const choices of EXCLUSIVE_CHOICES) {
      const aChoices = choices.filter((c) => aLower.includes(c));
      const bChoices = choices.filter((c) => bLower.includes(c));

      // Both memories mention different items from same exclusive group
      if (aChoices.length > 0 && bChoices.length > 0) {
        const different =
          aChoices.some((ac) => !bChoices.includes(ac)) ||
          bChoices.some((bc) => !aChoices.includes(bc));

        if (different) {
          // Check context - are they both recommending/deciding?
          const aRecommends = /use|prefer|choose|decision|always/i.test(aLower);
          const bRecommends = /use|prefer|choose|decision|always/i.test(bLower);

          if (aRecommends && bRecommends) {
            return {
              memories: [a, b],
              type: 'implicit',
              description: `Exclusive choice conflict: ${aChoices.join(',')} vs ${bChoices.join(',')}`,
              suggestedResolution: this.suggestResolution(a, b),
              confidence: 0.8,
            };
          }
        }
      }
    }

    return null;
  }

  /**
   * Check for temporal contradiction (same topic, different times, no link)
   */
  private checkTemporalContradiction(a: MemoryObject, b: MemoryObject): Conflict | null {
    // Only check decisions and conventions
    const relevantTypes = ['decision', 'convention', 'preference'];
    if (!relevantTypes.includes(a.objectType) || !relevantTypes.includes(b.objectType)) {
      return null;
    }

    // Check if they're about the same topic
    const aWords = this.tokenize(a.content.toLowerCase());
    const bWords = this.tokenize(b.content.toLowerCase());
    const similarity = this.wordOverlap(aWords, bWords);

    if (similarity < 0.5) {
      return null; // Not similar enough
    }

    // Check if they have different creation times (>1 day apart)
    const aTime = new Date(a.createdAt).getTime();
    const bTime = new Date(b.createdAt).getTime();
    const dayMs = 24 * 60 * 60 * 1000;

    if (Math.abs(aTime - bTime) < dayMs) {
      return null; // Created at similar times
    }

    // They're similar, created at different times, no supersedes link
    return {
      memories: [a, b],
      type: 'temporal',
      description: `Possible outdated duplicate: similar content from different times`,
      suggestedResolution: 'keep_newer',
      confidence: similarity * 0.8,
    };
  }

  /**
   * Suggest how to resolve a conflict
   */
  private suggestResolution(a: MemoryObject, b: MemoryObject): Resolution {
    // If one is grounded and other isn't, keep grounded
    const tierOrder: ConfidenceTier[] = ['grounded', 'observed', 'inferred', 'hypothesis'];
    const aTier = tierOrder.indexOf(a.confidenceTier || 'inferred');
    const bTier = tierOrder.indexOf(b.confidenceTier || 'inferred');

    if (aTier !== bTier) {
      return 'keep_grounded';
    }

    // If same tier, prefer newer
    const aTime = new Date(a.createdAt).getTime();
    const bTime = new Date(b.createdAt).getTime();

    if (Math.abs(aTime - bTime) > 24 * 60 * 60 * 1000) {
      return 'keep_newer';
    }

    // Otherwise ask user
    return 'ask_user';
  }

  /**
   * Calculate word overlap between two word arrays
   */
  private wordOverlap(a: string[], b: string[]): number {
    if (a.length === 0 || b.length === 0) return 0;

    const setA = new Set(a);
    const setB = new Set(b);
    const intersection = [...setA].filter((w) => setB.has(w));
    const union = new Set([...a, ...b]);

    return intersection.length / union.size;
  }

  /**
   * Tokenize text into words
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2);
  }

  /**
   * Truncate text for display
   */
  private truncate(text: string, maxLen = 40): string {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen - 3) + '...';
  }
}

/**
 * Format conflict for display
 */
export function formatConflict(conflict: Conflict): string {
  const [a, b] = conflict.memories;
  const lines = [
    `⚠️  ${conflict.type.toUpperCase()} CONFLICT (${Math.round(conflict.confidence * 100)}% confidence)`,
    `   ${conflict.description}`,
    ``,
    `   Memory 1 [${a.confidenceTier}]: ${a.content.slice(0, 60)}${a.content.length > 60 ? '...' : ''}`,
    `   Memory 2 [${b.confidenceTier}]: ${b.content.slice(0, 60)}${b.content.length > 60 ? '...' : ''}`,
    ``,
    `   Suggested: ${conflict.suggestedResolution.replace(/_/g, ' ')}`,
  ];
  return lines.join('\n');
}
