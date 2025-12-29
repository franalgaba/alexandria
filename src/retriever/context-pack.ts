/**
 * Context pack compiler - generates token-budgeted context for injection
 */

import type { Database } from 'bun:sqlite';
import { StalenessChecker } from '../reviewer/staleness.ts';
import { MemoryObjectStore } from '../stores/memory-objects.ts';
import { SessionStore } from '../stores/sessions.ts';
import type { PackOptions } from '../types/common.ts';
import type { MemoryObject } from '../types/memory-objects.ts';
import type { ContextPack, SearchResult, LegacyContextPack } from '../types/retriever.ts';
import type { PreviousSessionContext } from '../types/sessions.ts';
import { generatePrompts, type RevalidationPrompt } from '../utils/revalidation.ts';
import { estimateTokens } from '../utils/tokens.ts';
import { HybridSearch } from './hybrid-search.ts';
import { Reranker } from './reranker.ts';

// Token overhead per object (type label, formatting, etc.)
const TOKEN_OVERHEAD_PER_OBJECT = 20;

// Reserve tokens for previous session context
const PREVIOUS_SESSION_RESERVE = 200;

export class ContextPackCompiler {
  private store: MemoryObjectStore;
  private sessions: SessionStore;
  private searcher: HybridSearch;
  private stalenessChecker: StalenessChecker;

  constructor(db: Database) {
    this.store = new MemoryObjectStore(db);
    this.sessions = new SessionStore(db);
    this.searcher = new HybridSearch(db);
    this.stalenessChecker = new StalenessChecker(db);
  }

  /**
   * Compile a context pack for session injection
   */
  async compile(options: PackOptions = {}): Promise<ContextPack> {
    const budget = options.tokenBudget ?? 1500;
    let remaining = budget;

    // 1. Get previous session context
    const previousSession = this.sessions.getPreviousContext();
    if (previousSession) {
      const sessionTokens = this.countSessionTokens(previousSession);
      remaining -= Math.min(sessionTokens, PREVIOUS_SESSION_RESERVE);
    }

    // 2. Get all active constraints (always included)
    const constraints = this.store.getActiveConstraints();
    for (const c of constraints) {
      const tokens = estimateTokens(c.content) + TOKEN_OVERHEAD_PER_OBJECT;
      remaining -= tokens;
      this.store.recordAccess(c.id);
    }

    // 3. Search for relevant objects based on task
    const taskContext = options.taskDescription ?? '';
    let searchResults: SearchResult[] = [];

    if (taskContext) {
      searchResults = await this.searcher.search(taskContext, {
        status: ['active'],
        limit: 50,
      });
    } else {
      // If no task context, get recent high-priority objects
      searchResults = await this.getRecentHighPriority(50);
    }

    // 4. Rerank based on task type
    const reranker = this.detectTaskType(taskContext);
    const ranked = reranker.rerank(searchResults);

    // 5. Greedy packing within budget
    const included: MemoryObject[] = [];
    let overflowCount = 0;

    for (const result of ranked) {
      // Skip constraints (already included)
      if (result.object.objectType === 'constraint') continue;

      const tokens = estimateTokens(result.object.content) + TOKEN_OVERHEAD_PER_OBJECT;

      if (tokens <= remaining) {
        included.push(result.object);
        remaining -= tokens;
        this.store.recordAccess(result.object.id);
      } else {
        overflowCount++;
      }
    }

    // 6. Check for stale memories and generate revalidation prompts
    const allIncluded = [...constraints, ...included];
    const stalenessResults = new Map(
      allIncluded.map(m => [m.id, this.stalenessChecker.check(m)])
    );
    const revalidationPrompts = generatePrompts(allIncluded, stalenessResults);

    return {
      tokenCount: budget - remaining,
      tokenBudget: budget,
      previousSession: previousSession ?? undefined,
      constraints,
      relevantObjects: included,
      overflowCount,
      revalidationPrompts,
    };
  }

  /**
   * Compile a minimal pack (constraints only)
   */
  compileMinimal(): ContextPack {
    const constraints = this.store.getActiveConstraints();
    let tokenCount = 0;

    for (const c of constraints) {
      tokenCount += estimateTokens(c.content) + TOKEN_OVERHEAD_PER_OBJECT;
    }

    return {
      tokenCount,
      tokenBudget: tokenCount,
      constraints,
      relevantObjects: [],
      overflowCount: 0,
    };
  }

  /**
   * Get recent high-priority objects
   */
  private async getRecentHighPriority(limit: number): Promise<SearchResult[]> {
    // Get all active objects, sorted by type priority and recency
    const objects = this.store.list({ status: ['active'], limit: limit * 2 });

    // Convert to search results with mock scores
    const results: SearchResult[] = objects.map((obj) => ({
      object: obj,
      score: 0.5, // Base score
      matchType: 'lexical' as const,
    }));

    return results;
  }

  /**
   * Detect task type from context for reranker selection
   */
  private detectTaskType(taskContext: string): Reranker {
    const lower = taskContext.toLowerCase();

    if (
      lower.includes('error') ||
      lower.includes('bug') ||
      lower.includes('fix') ||
      lower.includes('debug')
    ) {
      return Reranker.forTask('debugging');
    }

    if (
      lower.includes('implement') ||
      lower.includes('add') ||
      lower.includes('create') ||
      lower.includes('build')
    ) {
      return Reranker.forTask('implementing');
    }

    if (
      lower.includes('refactor') ||
      lower.includes('clean') ||
      lower.includes('reorganize') ||
      lower.includes('improve')
    ) {
      return Reranker.forTask('refactoring');
    }

    return Reranker.forTask('general');
  }

  /**
   * Count tokens in previous session context
   */
  private countSessionTokens(session: PreviousSessionContext): number {
    let tokens = estimateTokens(session.summary);
    if (session.workingFile) {
      tokens += estimateTokens(session.workingFile) + 10;
    }
    if (session.workingTask) {
      tokens += estimateTokens(session.workingTask) + 10;
    }
    return tokens;
  }

  /**
   * Refresh access counts for objects in a pack
   */
  refreshAccessCounts(pack: ContextPack): void {
    for (const obj of pack.constraints) {
      this.store.recordAccess(obj.id);
    }
    for (const obj of pack.relevantObjects) {
      this.store.recordAccess(obj.id);
    }
  }
}
