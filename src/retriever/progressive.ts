/**
 * Progressive Retriever - context at different disclosure levels
 *
 * Levels:
 * - minimal: constraints + warnings (~500 tokens)
 * - task: + query-relevant memories (~2000 tokens)
 * - deep: + evidence, history, related (~4000 tokens)
 */

import type { Database } from 'bun:sqlite';
import type { MemoryObject } from '../types/memory-objects.ts';
import type { ProgressiveContextPack, SearchResult } from '../types/retriever.ts';
// Note: formatContextPack expects the legacy pack format; we build a simpler ContextPack
import { HybridSearch } from './hybrid-search.ts';
import { RetrievalRouter } from './router.ts';

export type ContextLevel = 'minimal' | 'task' | 'deep';

export interface ProgressiveOptions {
  /** Query for task/deep levels */
  query?: string;
  /** Override token budget */
  tokenBudget?: number;
  /** Priority memory IDs to include first (e.g., from heatmap) */
  priorityIds?: string[];
}

interface LevelConfig {
  tokenBudget: number;
  includeConstraints: boolean;
  includeWarnings: boolean;
  includeQueryResults: boolean;
  includeRelated: boolean;
  includeHistory: boolean;
}

const LEVEL_CONFIGS: Record<ContextLevel, LevelConfig> = {
  minimal: {
    tokenBudget: 500,
    includeConstraints: true,
    includeWarnings: true,
    includeQueryResults: false,
    includeRelated: false,
    includeHistory: false,
  },
  task: {
    tokenBudget: 2000,
    includeConstraints: true,
    includeWarnings: true,
    includeQueryResults: true,
    includeRelated: false,
    includeHistory: false,
  },
  deep: {
    tokenBudget: 4000,
    includeConstraints: true,
    includeWarnings: true,
    includeQueryResults: true,
    includeRelated: true,
    includeHistory: true,
  },
};

export class ProgressiveRetriever {
  private db: Database;
  private searcher: HybridSearch;
  private router: RetrievalRouter;

  constructor(db: Database) {
    this.db = db;
    this.searcher = new HybridSearch(db);
    this.router = new RetrievalRouter();
  }

  /**
   * Get context at specified level
   */
  async getContext(
    level: ContextLevel,
    options: ProgressiveOptions = {},
  ): Promise<ProgressiveContextPack> {
    const config = LEVEL_CONFIGS[level];
    const tokenBudget = options.tokenBudget ?? config.tokenBudget;

    const memories: MemoryObject[] = [];
    let tokensUsed = 0;

    // 1. Always include constraints (highest priority)
    if (config.includeConstraints) {
      const constraints = this.getConstraints();
      for (const c of constraints) {
        const tokens = this.estimateTokens(c.content);
        if (tokensUsed + tokens <= tokenBudget) {
          memories.push(c);
          tokensUsed += tokens;
        }
      }
    }

    // 2. Include warnings (stale memories needing attention)
    if (config.includeWarnings) {
      const warnings = this.getWarnings();
      for (const w of warnings) {
        const tokens = this.estimateTokens(w.content);
        if (tokensUsed + tokens <= tokenBudget) {
          memories.push(w);
          tokensUsed += tokens;
        }
      }
    }

    // 2.5. Include priority memories (hot memories from heatmap)
    if (options.priorityIds && options.priorityIds.length > 0) {
      const priorityMemories = this.getMemoriesByIds(options.priorityIds);
      for (const m of priorityMemories) {
        // Skip if already included (e.g., it's a constraint)
        if (memories.some((existing) => existing.id === m.id)) continue;

        const tokens = this.estimateTokens(m.content);
        if (tokensUsed + tokens <= tokenBudget) {
          memories.push(m);
          tokensUsed += tokens;
        }
      }
    }

    // 3. Include query-relevant results OR recent high-value memories
    if (config.includeQueryResults) {
      let memoriesToAdd: MemoryObject[] = [];

      if (options.query) {
        // Query-based retrieval
        const plan = this.router.route(options.query);
        const results = await this.searcher.searchWithPlan(options.query, plan);
        memoriesToAdd = results.map((r) => r.object);
      } else {
        // No query: get recent high-value memories (decisions, known_fix, conventions)
        memoriesToAdd = this.getRecentHighValueMemories();
      }

      for (const obj of memoriesToAdd) {
        // Skip if already included
        if (memories.some((m) => m.id === obj.id)) continue;

        const tokens = this.estimateTokens(obj.content);
        if (tokensUsed + tokens <= tokenBudget) {
          memories.push(obj);
          tokensUsed += tokens;
        }
      }
    }

    // 4. Include related memories (semantic neighbors)
    if (config.includeRelated && options.query) {
      const related = await this.getRelatedMemories(memories, tokenBudget - tokensUsed);
      memories.push(...related);
      tokensUsed += related.reduce((sum, m) => sum + this.estimateTokens(m.content), 0);
    }

    // 5. Include historical decisions
    if (config.includeHistory && options.query) {
      const history = this.getHistoricalDecisions(options.query, tokenBudget - tokensUsed);
      for (const h of history) {
        if (memories.some((m) => m.id === h.id)) continue;
        memories.push(h);
      }
    }

    return this.buildContextPack(memories, level, tokensUsed, tokenBudget);
  }

  /**
   * Shortcut: Get minimal context
   */
  getMinimalContext(): ProgressiveContextPack {
    const config = LEVEL_CONFIGS.minimal;
    const memories: MemoryObject[] = [];
    let tokensUsed = 0;

    const constraints = this.getConstraints();
    for (const c of constraints) {
      const tokens = this.estimateTokens(c.content);
      if (tokensUsed + tokens <= config.tokenBudget) {
        memories.push(c);
        tokensUsed += tokens;
      }
    }

    const warnings = this.getWarnings();
    for (const w of warnings) {
      const tokens = this.estimateTokens(w.content);
      if (tokensUsed + tokens <= config.tokenBudget) {
        memories.push(w);
        tokensUsed += tokens;
      }
    }

    return this.buildContextPack(memories, 'minimal', tokensUsed, config.tokenBudget);
  }

  /**
   * Shortcut: Get task context
   */
  async getTaskContext(query: string): Promise<ProgressiveContextPack> {
    return this.getContext('task', { query });
  }

  /**
   * Shortcut: Get deep context
   */
  async getDeepContext(query: string): Promise<ProgressiveContextPack> {
    return this.getContext('deep', { query });
  }

  /**
   * Get all constraint memories
   */
  private getConstraints(): MemoryObject[] {
    const stmt = this.db.prepare(`
      SELECT * FROM memory_objects 
      WHERE object_type = 'constraint' 
        AND status = 'active'
      ORDER BY created_at DESC
    `);
    return stmt.all().map(this.rowToMemory);
  }

  /**
   * Get stale memories as warnings
   */
  private getWarnings(): MemoryObject[] {
    const stmt = this.db.prepare(`
      SELECT * FROM memory_objects
      WHERE status = 'stale'
      ORDER BY updated_at DESC
      LIMIT 5
    `);
    return stmt.all().map(this.rowToMemory);
  }

  /**
   * Get recent high-value memories when no query is provided
   * Prioritizes: decisions, known_fix, conventions by access count and recency
   */
  private getRecentHighValueMemories(): MemoryObject[] {
    const stmt = this.db.prepare(`
      SELECT * FROM memory_objects
      WHERE status = 'active'
        AND object_type IN ('decision', 'known_fix', 'convention', 'preference')
        AND object_type != 'constraint'
      ORDER BY
        access_count DESC,
        created_at DESC
      LIMIT 20
    `);
    return stmt.all().map(this.rowToMemory);
  }

  /**
   * Get semantically related memories
   */
  private async getRelatedMemories(
    baseMemories: MemoryObject[],
    tokenBudget: number,
  ): Promise<MemoryObject[]> {
    if (baseMemories.length === 0) return [];

    const related: MemoryObject[] = [];
    let tokensUsed = 0;
    const seenIds = new Set(baseMemories.map((m) => m.id));

    // Search for memories similar to each base memory
    for (const base of baseMemories.slice(0, 3)) {
      // Limit to first 3
      const results = await this.searcher.searchVector(base.content, { limit: 3 });

      for (const r of results) {
        if (seenIds.has(r.object.id)) continue;

        const tokens = this.estimateTokens(r.object.content);
        if (tokensUsed + tokens > tokenBudget) break;

        related.push(r.object);
        seenIds.add(r.object.id);
        tokensUsed += tokens;
      }
    }

    return related;
  }

  /**
   * Get historical decisions related to query
   */
  private getHistoricalDecisions(query: string, tokenBudget: number): MemoryObject[] {
    // Get decisions including stale ones for historical context
    const stmt = this.db.prepare(`
      SELECT * FROM memory_objects 
      WHERE object_type = 'decision'
      ORDER BY created_at DESC
      LIMIT 10
    `);

    const decisions = stmt.all().map(this.rowToMemory);
    const result: MemoryObject[] = [];
    let tokensUsed = 0;

    for (const d of decisions) {
      const tokens = this.estimateTokens(d.content);
      if (tokensUsed + tokens > tokenBudget) break;
      result.push(d);
      tokensUsed += tokens;
    }

    return result;
  }

  /**
   * Get memories by IDs (for priority/hot memories)
   */
  private getMemoriesByIds(ids: string[]): MemoryObject[] {
    if (ids.length === 0) return [];

    const placeholders = ids.map((_, i) => `$id${i}`).join(', ');
    const params: Record<string, string> = {};
    ids.forEach((id, i) => {
      params[`$id${i}`] = id;
    });

    const stmt = this.db.prepare(`
      SELECT * FROM memory_objects
      WHERE id IN (${placeholders})
        AND status = 'active'
    `);

    const rows = stmt.all(params);

    // Maintain the order of the input IDs
    const rowMap = new Map(rows.map((row: any) => [row.id, row]));
    return ids.filter((id) => rowMap.has(id)).map((id) => this.rowToMemory(rowMap.get(id)));
  }

  /**
   * Estimate token count (rough: ~4 chars per token)
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Build context pack from memories
   */
  private buildContextPack(
    memories: MemoryObject[],
    level: ContextLevel,
    tokensUsed: number,
    tokenBudget: number,
  ): ProgressiveContextPack {
    // Group by confidence tier
    const grouped = {
      grounded: memories.filter((m) => m.confidenceTier === 'grounded'),
      observed: memories.filter((m) => m.confidenceTier === 'observed'),
      inferred: memories.filter((m) => m.confidenceTier === 'inferred'),
      hypothesis: memories.filter((m) => m.confidenceTier === 'hypothesis'),
    };

    return {
      objects: memories,
      totalCount: memories.length,
      truncated: false,
      metadata: {
        level,
        tokensUsed,
        tokenBudget,
        breakdown: {
          grounded: grouped.grounded.length,
          observed: grouped.observed.length,
          inferred: grouped.inferred.length,
          hypothesis: grouped.hypothesis.length,
        },
      },
    };
  }

  /**
   * Convert database row to MemoryObject
   */
  private rowToMemory(row: any): MemoryObject {
    return {
      id: row.id,
      content: row.content,
      objectType: row.object_type,
      scope: {
        type: row.scope_type || 'project',
        path: row.scope_path ?? undefined,
      },
      status: row.status,
      confidence: row.confidence,
      confidenceTier: row.confidence_tier || 'inferred',
      evidenceEventIds: JSON.parse(row.evidence_event_ids || '[]'),
      reviewStatus: row.review_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      accessCount: row.access_count || 0,
      lastAccessed: row.last_accessed,
      codeRefs: JSON.parse(row.code_refs || '[]'),
      supersedes: row.supersedes ? JSON.parse(row.supersedes) : undefined,
      supersededBy: row.superseded_by,
    };
  }
}

/**
 * Get recommended context level based on query complexity
 */
export function recommendLevel(query: string): ContextLevel {
  const lowerQuery = query.toLowerCase();

  // Deep: complex architectural or historical questions
  if (
    /architect|design|structure|history|evolution|all|everything/i.test(lowerQuery) ||
    lowerQuery.length > 100
  ) {
    return 'deep';
  }

  // Minimal: simple status checks
  if (/status|check|valid|still/i.test(lowerQuery) || lowerQuery.length < 20) {
    return 'minimal';
  }

  // Default: task level
  return 'task';
}

/**
 * Get level configuration
 */
export function getLevelConfig(level: ContextLevel): LevelConfig {
  return { ...LEVEL_CONFIGS[level] };
}
