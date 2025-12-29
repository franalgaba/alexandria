/**
 * Reranker - rerank search results based on various signals
 */

import type { ConfidenceTier, MemoryObject, ObjectType } from '../types/memory-objects.ts';
import type { SearchResult } from '../types/retriever.ts';
import { getConfidenceBoost } from '../utils/confidence.ts';

// Priority weights by object type
const TYPE_PRIORITY: Record<ObjectType, number> = {
  failed_attempt: 100, // Highest - avoid repeating mistakes
  known_fix: 90, // High - known solutions
  constraint: 85, // High - must not violate
  decision: 80, // Important context
  convention: 60, // Pattern to follow
  preference: 40, // Nice to know
  environment: 30, // Lowest priority
};

// Legacy confidence boosts (for backwards compatibility)
const LEGACY_CONFIDENCE_BOOST: Record<string, number> = {
  certain: 25,
  high: 20,
  medium: 10,
  low: 5,
};

// Recency boost (decays over time)
const RECENCY_DECAY_DAYS = 30;
const _MAX_RECENCY_BOOST = 15;

// Access count boost (diminishing returns)
const ACCESS_BOOST_FACTOR = 2;
const MAX_ACCESS_BOOST = 10;

export interface RerankerOptions {
  /** Weight for search score (0-1) */
  searchScoreWeight?: number;
  /** Weight for type priority (0-1) */
  typePriorityWeight?: number;
  /** Weight for confidence (0-1) */
  confidenceWeight?: number;
  /** Weight for recency (0-1) */
  recencyWeight?: number;
  /** Weight for access count (0-1) */
  accessWeight?: number;
  /** Boost specific types */
  typeBoosts?: Partial<Record<ObjectType, number>>;
  /** Current task context for contextual boosting */
  taskContext?: string;
}

export class Reranker {
  private options: Required<RerankerOptions>;

  constructor(options: RerankerOptions = {}) {
    this.options = {
      searchScoreWeight: options.searchScoreWeight ?? 0.4,
      typePriorityWeight: options.typePriorityWeight ?? 0.25,
      confidenceWeight: options.confidenceWeight ?? 0.15,
      recencyWeight: options.recencyWeight ?? 0.1,
      accessWeight: options.accessWeight ?? 0.1,
      typeBoosts: options.typeBoosts ?? {},
      taskContext: options.taskContext ?? '',
    };
  }

  /**
   * Rerank search results
   */
  rerank(results: SearchResult[]): SearchResult[] {
    if (results.length === 0) return results;

    // Calculate composite scores
    const scored = results.map((result) => ({
      result,
      compositeScore: this.calculateCompositeScore(result),
    }));

    // Sort by composite score
    scored.sort((a, b) => b.compositeScore - a.compositeScore);

    // Return reranked results with updated scores
    return scored.map(({ result, compositeScore }) => ({
      ...result,
      score: compositeScore,
    }));
  }

  /**
   * Calculate composite score for a result
   */
  private calculateCompositeScore(result: SearchResult): number {
    const obj = result.object;

    // Normalize search score (assuming max is 1)
    const searchScore = Math.min(result.score, 1);

    // Type priority (normalized to 0-1)
    const basePriority = TYPE_PRIORITY[obj.objectType] || 50;
    const typeBoost = this.options.typeBoosts[obj.objectType] || 0;
    const typePriority = (basePriority + typeBoost) / 100;

    // Confidence score based on tier (normalized to 0-1)
    // Use new tier-based boost, with legacy fallback
    const tierBoost = getConfidenceBoost(obj.confidenceTier);
    const legacyBoost = (LEGACY_CONFIDENCE_BOOST[obj.confidence] || 10) / 25;
    const confidenceScore = Math.max(tierBoost / 2, legacyBoost); // Tier is 0.5-2.0, normalize

    // Recency score (normalized to 0-1)
    const recencyScore = this.calculateRecencyScore(obj);

    // Access score (normalized to 0-1)
    const accessScore = this.calculateAccessScore(obj);

    // Weighted combination
    const compositeScore =
      this.options.searchScoreWeight * searchScore +
      this.options.typePriorityWeight * typePriority +
      this.options.confidenceWeight * confidenceScore +
      this.options.recencyWeight * recencyScore +
      this.options.accessWeight * accessScore;

    return compositeScore;
  }

  /**
   * Calculate recency score with exponential decay
   */
  private calculateRecencyScore(obj: MemoryObject): number {
    const now = Date.now();
    const createdTime = obj.createdAt.getTime();
    const daysSinceCreation = (now - createdTime) / (1000 * 60 * 60 * 24);

    // Exponential decay
    const decay = Math.exp(-daysSinceCreation / RECENCY_DECAY_DAYS);
    return decay;
  }

  /**
   * Calculate access score with diminishing returns
   */
  private calculateAccessScore(obj: MemoryObject): number {
    // Logarithmic scaling with diminishing returns
    const accessBoost = Math.log1p(obj.accessCount * ACCESS_BOOST_FACTOR);
    return Math.min(accessBoost / Math.log1p(MAX_ACCESS_BOOST * ACCESS_BOOST_FACTOR), 1);
  }

  /**
   * Create a reranker with task-specific configuration
   */
  static forTask(taskType: 'debugging' | 'implementing' | 'refactoring' | 'general'): Reranker {
    const configs: Record<typeof taskType, RerankerOptions> = {
      debugging: {
        typeBoosts: {
          failed_attempt: 30,
          known_fix: 30,
          constraint: 20,
        },
        typePriorityWeight: 0.35,
        searchScoreWeight: 0.35,
      },
      implementing: {
        typeBoosts: {
          decision: 20,
          convention: 20,
          preference: 15,
        },
        typePriorityWeight: 0.3,
        searchScoreWeight: 0.4,
      },
      refactoring: {
        typeBoosts: {
          convention: 25,
          constraint: 20,
          decision: 15,
        },
        typePriorityWeight: 0.3,
        searchScoreWeight: 0.35,
      },
      general: {},
    };

    return new Reranker(configs[taskType]);
  }
}
