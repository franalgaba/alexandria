/**
 * Hybrid search - combines FTS5 and vector search with RRF fusion
 */

import type { Database } from 'bun:sqlite';
import { FTSIndex } from '../indexes/fts.ts';
import { VectorIndex } from '../indexes/vector.ts';
import { MemoryObjectStore } from '../stores/memory-objects.ts';
import type { SearchOptions } from '../types/common.ts';
import type { MemoryObject, Status } from '../types/memory-objects.ts';
import type { SearchResult } from '../types/retriever.ts';
import type { RetrievalPlan } from './router.ts';
import { codeRefsMatchScope, extractScope } from './scope.ts';

// RRF constant (standard value)
const RRF_K = 60;

export class HybridSearch {
  private fts: FTSIndex;
  private vector: VectorIndex;
  private store: MemoryObjectStore;

  constructor(db: Database) {
    this.fts = new FTSIndex(db);
    this.vector = new VectorIndex(db);
    this.store = new MemoryObjectStore(db);
  }

  /**
   * Perform hybrid search
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const { limit = 20, status = ['active'], alpha = 0.5 } = options;

    // 1. Lexical search (FTS5 + BM25)
    const ftsResults = this.fts.searchObjects(query, status as Status[], limit * 2);

    // 2. Vector search
    let vectorResults: { id: string; distance: number }[] = [];
    try {
      vectorResults = await this.vector.searchSimilarObjects(query, limit * 2);
    } catch (error) {
      console.debug('Vector search failed:', error);
    }

    // 3. Reciprocal Rank Fusion
    const fused = this.reciprocalRankFusion(
      ftsResults.map((r) => ({ id: r.object.id, object: r.object, highlight: r.highlight })),
      vectorResults,
      alpha,
      status as Status[],
    );

    // 4. Filter by type if specified
    let results = fused;
    if (options.objectType) {
      results = fused.filter((r) => r.object.objectType === options.objectType);
    }

    // 5. Return top results
    return results.slice(0, limit);
  }

  /**
   * Search with a retrieval plan (from router)
   */
  async searchWithPlan(query: string, plan: RetrievalPlan): Promise<SearchResult[]> {
    const status: Status[] = plan.includeStale ? ['active', 'stale'] : ['active'];
    
    // Base search
    let results = await this.search(query, {
      limit: 50, // Get more, we'll filter
      status,
    });
    
    // Filter by type if specified
    if (plan.typeFilters.length > 0) {
      results = results.filter(r => plan.typeFilters.includes(r.object.objectType));
    }
    
    // Filter by minimum confidence
    if (plan.minConfidence) {
      const tierOrder = ['grounded', 'observed', 'inferred', 'hypothesis'];
      const minIndex = tierOrder.indexOf(plan.minConfidence);
      results = results.filter(r => tierOrder.indexOf(r.object.confidenceTier) <= minIndex);
    }
    
    // Apply plan-specific boosts
    results = this.applyPlanBoosts(results, query, plan);
    
    // Sort by boosted score
    results.sort((a, b) => b.score - a.score);
    
    // Limit to token budget (rough estimate: 30 tokens per result)
    const maxResults = Math.floor(plan.tokenBudget / 30);
    return results.slice(0, maxResults);
  }

  /**
   * Apply retrieval plan boosts to results
   */
  private applyPlanBoosts(
    results: SearchResult[],
    query: string,
    plan: RetrievalPlan
  ): SearchResult[] {
    // Extract scope from query for scope matching
    const extractedScope = extractScope(query);
    
    return results.map(result => {
      let boostedScore = result.score;
      const obj = result.object;
      
      // Grounded boost
      if (plan.boosts.grounded && obj.confidenceTier === 'grounded') {
        boostedScore *= plan.boosts.grounded;
      }
      
      // Has code refs boost
      if (plan.boosts.hasCodeRefs && obj.codeRefs.length > 0) {
        boostedScore *= plan.boosts.hasCodeRefs;
      }
      
      // Recently verified boost
      if (plan.boosts.recentlyVerified && obj.lastVerifiedAt) {
        const daysSinceVerified = (Date.now() - obj.lastVerifiedAt.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceVerified < 7) {
          boostedScore *= plan.boosts.recentlyVerified;
        }
      }
      
      // Type-specific boosts
      if (plan.boosts.typeBoosts?.[obj.objectType]) {
        boostedScore += plan.boosts.typeBoosts[obj.objectType]! / 100;
      }
      
      // Scope matching boost
      if (extractedScope) {
        const codeRefPaths = (obj.codeRefs || []).map(r => r.path);
        const scopeScore = codeRefsMatchScope(codeRefPaths, extractedScope.scope);
        if (scopeScore > 0) {
          boostedScore *= (1 + scopeScore * 0.5); // Up to 50% boost for scope match
        }
      }
      
      return {
        ...result,
        score: boostedScore,
      };
    });
  }

  /**
   * Search with lexical only
   */
  searchLexical(query: string, options: SearchOptions = {}): SearchResult[] {
    const { limit = 20, status = ['active'] } = options;

    const ftsResults = this.fts.searchObjects(query, status as Status[], limit);

    return ftsResults.map((r) => ({
      object: r.object,
      score: r.score,
      matchType: 'lexical' as const,
      highlights: r.highlight ? [r.highlight] : undefined,
    }));
  }

  /**
   * Search with vector only
   */
  async searchVector(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const { limit = 20, status = ['active'] } = options;

    const vectorResults = await this.vector.searchSimilarObjects(query, limit * 2);
    const results: SearchResult[] = [];

    for (const vr of vectorResults) {
      const obj = this.store.get(vr.id);
      if (!obj) continue;
      if (!status.includes(obj.status)) continue;

      results.push({
        object: obj,
        score: 1 - vr.distance, // Convert distance to similarity
        matchType: 'vector',
      });
    }

    return results.slice(0, limit);
  }

  /**
   * Search by exact token
   */
  searchByToken(token: string, limit = 20): SearchResult[] {
    const objects = this.fts.searchByToken(token, limit);

    return objects.map((obj) => ({
      object: obj,
      score: 1, // Exact match
      matchType: 'lexical' as const,
    }));
  }

  /**
   * Reciprocal Rank Fusion algorithm
   */
  private reciprocalRankFusion(
    ftsResults: { id: string; object: MemoryObject; highlight?: string }[],
    vectorResults: { id: string; distance: number }[],
    alpha: number,
    status: Status[],
  ): SearchResult[] {
    const scores = new Map<
      string,
      {
        score: number;
        object: MemoryObject;
        matchType: 'lexical' | 'vector' | 'hybrid';
        highlights?: string[];
      }
    >();

    // Score FTS results
    ftsResults.forEach((r, rank) => {
      const rrfScore = alpha * (1 / (RRF_K + rank + 1));

      if (!scores.has(r.id)) {
        scores.set(r.id, {
          score: 0,
          object: r.object,
          matchType: 'lexical',
          highlights: r.highlight ? [r.highlight] : undefined,
        });
      }
      scores.get(r.id)!.score += rrfScore;
    });

    // Score vector results
    vectorResults.forEach((r, rank) => {
      const rrfScore = (1 - alpha) * (1 / (RRF_K + rank + 1));

      if (!scores.has(r.id)) {
        // Fetch full object
        const obj = this.store.get(r.id);
        if (obj && status.includes(obj.status)) {
          scores.set(r.id, {
            score: 0,
            object: obj,
            matchType: 'vector',
          });
        }
      }

      if (scores.has(r.id)) {
        const entry = scores.get(r.id)!;
        entry.score += rrfScore;
        if (entry.matchType === 'lexical') {
          entry.matchType = 'hybrid';
        }
      }
    });

    // Sort by score and convert to results
    return Array.from(scores.values())
      .sort((a, b) => b.score - a.score)
      .map(({ score, object, matchType, highlights }) => ({
        score,
        object,
        matchType,
        highlights,
      }));
  }

  /**
   * Check if a query has exact token matches
   */
  hasExactTokenMatch(query: string): boolean {
    const tokens = query.split(/\s+/);
    for (const token of tokens) {
      if (token.length >= 3) {
        const results = this.fts.searchByToken(token, 1);
        if (results.length > 0) return true;
      }
    }
    return false;
  }
}
