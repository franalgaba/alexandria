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
import { estimateTokens, estimateTokensAsync } from '../utils/tokens.ts';
import { HybridSearch } from './hybrid-search.ts';
import { RetrievalRouter } from './router.ts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { calculateConfidenceTier } from '../utils/confidence.ts';
import { parseStructured } from '../types/structured.ts';

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

const CONSTRAINT_BUDGET_FRACTION: Record<ContextLevel, number> = {
  minimal: 1.0,
  task: 0.4,
  deep: 0.35,
};

const MAX_CONSTRAINTS_BY_LEVEL: Record<ContextLevel, number> = {
  minimal: 60,
  task: 25,
  deep: 35,
};

const DEFAULT_KEYWORDS = new Set([
  'alexandria',
  'memory',
  'memories',
  'context',
  'retrieval',
  'retriever',
  'benchmark',
  'locomo',
  'cli',
  'tui',
  'sdk',
  'hooks',
  'typescript',
  'bun',
  'node',
  'sqlite',
  'fts',
  'vector',
  'embedding',
  'judge',
  'hyde',
  'revalidation',
  'checkpoint',
  'ingest',
  'index',
  'session',
  'pack',
  'agent',
  'claude',
  'anthropic',
  'security',
  'token',
  'jwt',
  'xss',
  'sql',
  'cookie',
  'auth',
]);

export class ProgressiveRetriever {
  private db: Database;
  private searcher: HybridSearch;
  private router: RetrievalRouter;
  private projectKeywords: Set<string> | null = null;

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
    const constraintBudget = Math.floor(
      tokenBudget * (CONSTRAINT_BUDGET_FRACTION[level] ?? 1.0),
    );
    let constraintTokensUsed = 0;
    let constraintCount = 0;
    const projectKeywords = this.getProjectKeywords();
    const seenConstraintKeys = new Set<string>();

    const memories: MemoryObject[] = [];
    let tokensUsed = 0;
    const seenIds = new Set<string>();
    const seenContent = new Set<string>();

    const addMemory = (memory: MemoryObject): boolean => {
      if (seenIds.has(memory.id)) return false;
      const contentKey = normalizeContentKey(memory.content);
      if (contentKey && seenContent.has(contentKey)) return false;
      const tokens = estimateTokens(memory.content);

      const isConstraint = memory.objectType === 'constraint';
      let constraintKey = '';
      if (isConstraint) {
        if (isIncompleteConstraint(memory.content)) return false;
        if (!shouldIncludeConstraint(memory, projectKeywords)) return false;
        constraintKey = normalizeConstraintKey(memory.content);
        if (constraintKey && seenConstraintKeys.has(constraintKey)) return false;
        if (constraintCount >= (MAX_CONSTRAINTS_BY_LEVEL[level] ?? 0)) return false;
        if (constraintTokensUsed + tokens > constraintBudget) return false;
      } else if (!shouldIncludeMemory(memory, projectKeywords)) {
        return false;
      }

      if (tokensUsed + tokens > tokenBudget) return false;

      memories.push(memory);
      tokensUsed += tokens;
      seenIds.add(memory.id);
      if (contentKey) {
        seenContent.add(contentKey);
      }
      if (isConstraint) {
        constraintTokensUsed += tokens;
        constraintCount += 1;
        if (constraintKey) {
          seenConstraintKeys.add(constraintKey);
        }
      }
      return true;
    };

    // 1. Always include constraints (highest priority)
    if (config.includeConstraints) {
      const constraints = this.getConstraints();
      for (const c of constraints) {
        if (!addMemory(c)) {
          if (constraintCount >= (MAX_CONSTRAINTS_BY_LEVEL[level] ?? 0)) {
            break;
          }
        }
      }
    }

    // 2. Include warnings (stale memories needing attention)
    if (config.includeWarnings) {
      const warnings = this.getWarnings();
      for (const w of warnings) {
        addMemory(w);
      }
    }

    // 2.5. Include priority memories (hot memories from heatmap)
    if (options.priorityIds && options.priorityIds.length > 0) {
      const priorityMemories = this.getMemoriesByIds(options.priorityIds);
      for (const m of priorityMemories) {
        addMemory(m);
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
        memoriesToAdd = this.getRecentHighValueMemories().filter((memory) =>
          shouldIncludeMemory(memory, projectKeywords),
        );
      }

      for (const obj of memoriesToAdd) {
        addMemory(obj);
      }
    }

    // 4. Include related memories (semantic neighbors)
    if (config.includeRelated && options.query) {
      const related = await this.getRelatedMemories(memories, tokenBudget - tokensUsed);
      for (const memory of related) {
        addMemory(memory);
      }
    }

    // 5. Include historical decisions
    if (config.includeHistory && options.query) {
      const history = await this.getHistoricalDecisions(options.query, tokenBudget - tokensUsed);
      for (const h of history) {
        addMemory(h);
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
      const tokens = estimateTokens(c.content);
      if (tokensUsed + tokens <= config.tokenBudget) {
        memories.push(c);
        tokensUsed += tokens;
      }
    }

    const warnings = this.getWarnings();
    for (const w of warnings) {
      const tokens = estimateTokens(w.content);
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
        AND review_status = 'approved'
      ORDER BY created_at DESC
    `);
    return stmt.all().map((row) => this.rowToMemory(row));
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
    return stmt.all().map((row) => this.rowToMemory(row));
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
    return stmt.all().map((row) => this.rowToMemory(row));
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

        const tokens = await estimateTokensAsync(r.object.content);
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
  private async getHistoricalDecisions(query: string, tokenBudget: number): Promise<MemoryObject[]> {
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
      const tokens = await estimateTokensAsync(d.content);
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
    const codeRefs = safeJsonParse(row.code_refs, []);
    const evidenceEventIds = safeJsonParse(row.evidence_event_ids, []);
    const lastVerifiedAt = row.last_verified_at ? new Date(row.last_verified_at) : undefined;
    const reviewStatus = row.review_status as MemoryObject['reviewStatus'];
    const status = row.status as MemoryObject['status'];
    const createdAt = row.created_at ? new Date(row.created_at) : new Date();
    const updatedAt = row.updated_at ? new Date(row.updated_at) : createdAt;
    const lastAccessed = row.last_accessed ? new Date(row.last_accessed) : undefined;
    const lastReinforcedAt = row.last_reinforced_at
      ? new Date(row.last_reinforced_at)
      : undefined;
    const supersedes = row.supersedes ? safeJsonParse(row.supersedes, undefined) : undefined;

    let scopeType = row.scope_type ?? 'project';
    let scopePath = row.scope_path ?? undefined;
    if (!row.scope_type && row.scope) {
      const parsedScope = safeJsonParse(row.scope, {}) as { type?: string; path?: string } | null;
      if (parsedScope && typeof parsedScope === 'object') {
        scopeType = parsedScope.type ?? scopeType;
        scopePath = parsedScope.path ?? scopePath;
      }
    }

    const confidenceTier = calculateConfidenceTier({
      codeRefs,
      evidenceEventIds,
      reviewStatus,
      lastVerifiedAt,
    });

    return {
      id: row.id,
      content: row.content,
      objectType: row.object_type,
      scope: {
        type: scopeType,
        path: scopePath ?? undefined,
      },
      status,
      supersededBy: row.superseded_by ?? undefined,
      confidence: row.confidence ?? 'medium',
      confidenceTier,
      evidenceEventIds,
      evidenceExcerpt: row.evidence_excerpt ?? undefined,
      reviewStatus,
      reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : undefined,
      createdAt,
      updatedAt,
      accessCount: row.access_count ?? 0,
      lastAccessed,
      codeRefs,
      lastVerifiedAt,
      supersedes,
      structured: parseStructured(row.structured),
      strength: row.strength ?? 1.0,
      lastReinforcedAt,
      outcomeScore: row.outcome_score ?? 0.5,
    };
  }

  private getProjectKeywords(): Set<string> {
    if (this.projectKeywords) {
      return this.projectKeywords;
    }

    const keywords = new Set(DEFAULT_KEYWORDS);
    const root = process.cwd();
    const packagePath = join(root, 'package.json');
    if (existsSync(packagePath)) {
      try {
        const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as {
          name?: string;
          description?: string;
          keywords?: string[];
          bin?: Record<string, string>;
        };
        this.addTokens(keywords, pkg.name);
        this.addTokens(keywords, pkg.description);
        if (pkg.keywords) {
          for (const keyword of pkg.keywords) {
            this.addTokens(keywords, keyword);
          }
        }
        if (pkg.bin) {
          for (const name of Object.keys(pkg.bin)) {
            this.addTokens(keywords, name);
          }
        }
      } catch {
        // Ignore malformed package.json
      }
    }

    const readmePath = join(root, 'README.md');
    if (existsSync(readmePath)) {
      try {
        const readme = readFileSync(readmePath, 'utf8').slice(0, 4000);
        this.addTokens(keywords, readme);
      } catch {
        // Ignore missing/invalid README
      }
    }

    this.projectKeywords = keywords;
    return keywords;
  }

  private addTokens(target: Set<string>, text: string | undefined | null): void {
    if (!text) return;
    const tokens = extractKeywords(text);
    for (const token of tokens) {
      target.add(token);
    }
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

function normalizeContentKey(content: string): string {
  return content
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeConstraintKey(content: string): string {
  const tokens = Array.from(extractKeywords(content));
  tokens.sort();
  return tokens.join(' ');
}

function isIncompleteConstraint(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return true;
  if (trimmed.endsWith(':')) {
    return true;
  }
  return false;
}

function extractKeywords(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
  return new Set(tokens);
}

function shouldIncludeConstraint(
  constraint: MemoryObject,
  projectKeywords: Set<string>,
): boolean {
  if (projectKeywords.size === 0) return true;
  const tokens = extractKeywords(constraint.content);
  if (tokens.size === 0) return true;

  for (const token of tokens) {
    if (projectKeywords.has(token)) {
      return true;
    }
  }

  return false;
}

function shouldIncludeMemory(
  memory: MemoryObject,
  projectKeywords: Set<string>,
): boolean {
  if (projectKeywords.size === 0) return true;
  const tokens = extractKeywords(memory.content);
  if (tokens.size === 0) return true;

  for (const token of tokens) {
    if (projectKeywords.has(token)) {
      return true;
    }
  }

  return false;
}

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'these',
  'those',
  'use',
  'using',
  'used',
  'should',
  'must',
  'always',
  'never',
  'into',
  'over',
  'under',
  'when',
  'where',
  'what',
  'which',
  'who',
  'why',
  'how',
  'before',
  'after',
  'during',
  'while',
  'because',
  'while',
  'then',
  'than',
  'with',
  'without',
  'system',
  'project',
  'workflow',
  'process',
  'create',
  'creating',
  'implement',
  'implementation',
  'ensure',
  'ensure',
  'update',
  'updates',
  'requires',
  'require',
  'required',
  'avoid',
]);
