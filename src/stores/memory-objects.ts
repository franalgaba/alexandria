/**
 * Memory object store - curated knowledge storage
 */

import type { Database } from 'bun:sqlite';
import type { CodeReference } from '../types/code-refs.ts';
import type { Scope, ScopeType } from '../types/common.ts';
import type {
  ConfidenceTier,
  CreateMemoryObjectInput,
  MemoryObject,
  MemoryObjectRow,
  ObjectType,
  Status,
  UpdateMemoryObjectInput,
} from '../types/memory-objects.ts';
import { parseStructured, serializeStructured } from '../types/structured.ts';
import { calculateConfidenceTier } from '../utils/confidence.ts';
import { calculateDecayedStrength, calculateReinforcedStrength } from '../utils/decay.ts';
import { generateId } from '../utils/id.ts';
import { extractTokens } from '../utils/tokens.ts';

export interface ListOptions {
  status?: Status[];
  objectType?: ObjectType;
  scopeType?: ScopeType;
  scopePath?: string;
  reviewStatus?: string;
  limit?: number;
  offset?: number;
}

export class MemoryObjectStore {
  constructor(private db: Database) {}

  /**
   * Create a new memory object
   */
  create(input: CreateMemoryObjectInput): MemoryObject {
    const id = generateId();
    const now = new Date();

    const scope: Scope = input.scope ?? { type: 'project' };
    const evidenceEventIds = input.evidenceEventIds ?? [];

    const codeRefs = input.codeRefs ?? [];
    const lastVerifiedAt = codeRefs.length > 0 ? now : null;
    const reviewStatus = input.reviewStatus ?? 'pending';

    // Calculate confidence tier based on evidence
    const confidenceTier = calculateConfidenceTier({
      codeRefs,
      evidenceEventIds: evidenceEventIds,
      reviewStatus,
      lastVerifiedAt: lastVerifiedAt ?? undefined,
    });

    this.db
      .query(`
      INSERT INTO memory_objects (
        id, content, object_type, scope_type, scope_path,
        confidence, evidence_event_ids, evidence_excerpt,
        review_status, created_at, updated_at, code_refs, last_verified_at, structured,
        supersedes,
        strength, outcome_score
      )
      VALUES (
        $id, $content, $objectType, $scopeType, $scopePath,
        $confidence, $evidenceEventIds, $evidenceExcerpt,
        $reviewStatus, $createdAt, $updatedAt, $codeRefs, $lastVerifiedAt, $structured,
        $supersedes,
        $strength, $outcomeScore
      )
    `)
      .run({
        $id: id,
        $content: input.content,
        $objectType: input.objectType,
        $scopeType: scope.type,
        $scopePath: scope.path ?? null,
        $confidence: input.confidence ?? 'medium',
        $evidenceEventIds: JSON.stringify(evidenceEventIds),
        $evidenceExcerpt: input.evidenceExcerpt ?? null,
        $reviewStatus: input.reviewStatus ?? 'pending',
        $createdAt: now.toISOString(),
        $updatedAt: now.toISOString(),
        $codeRefs: JSON.stringify(codeRefs),
        $lastVerifiedAt: lastVerifiedAt?.toISOString() ?? null,
        $structured: serializeStructured(input.structured),
        $supersedes: null,
        $strength: 1.0,
        $outcomeScore: 0.5,
      });

    // Index tokens for exact matching
    this.indexTokens(id, input.content);
    this.insertCodeRefs(id, codeRefs);

    return {
      id,
      content: input.content,
      objectType: input.objectType,
      scope,
      status: 'active',
      confidence: input.confidence ?? 'medium',
      confidenceTier,
      evidenceEventIds,
      evidenceExcerpt: input.evidenceExcerpt,
      reviewStatus,
      createdAt: now,
      updatedAt: now,
      accessCount: 0,
      codeRefs,
      lastVerifiedAt: lastVerifiedAt ?? undefined,
      structured: input.structured,
      strength: 1.0,
      outcomeScore: 0.5,
    };
  }

  /**
   * Get a memory object by ID
   */
  get(id: string): MemoryObject | null {
    const row = this.db
      .query(`
      SELECT * FROM memory_objects WHERE id = $id
    `)
      .get({ $id: id }) as MemoryObjectRow | null;

    if (!row) return null;

    return this.rowToMemoryObject(row);
  }

  /**
   * Update a memory object
   */
  update(id: string, input: UpdateMemoryObjectInput): MemoryObject | null {
    const existing = this.get(id);
    if (!existing) return null;

    const updates: string[] = ['updated_at = $updatedAt'];
    const params: Record<string, unknown> = {
      $id: id,
      $updatedAt: new Date().toISOString(),
    };

    if (input.content !== undefined) {
      updates.push('content = $content');
      params.$content = input.content;
      // Re-index tokens
      this.deleteTokens(id);
      this.indexTokens(id, input.content);
    }
    if (input.status !== undefined) {
      updates.push('status = $status');
      params.$status = input.status;
    }
    if (input.supersededBy !== undefined) {
      updates.push('superseded_by = $supersededBy');
      params.$supersededBy = input.supersededBy;
    }
    if (input.confidence !== undefined) {
      updates.push('confidence = $confidence');
      params.$confidence = input.confidence;
    }
    if (input.reviewStatus !== undefined) {
      updates.push('review_status = $reviewStatus');
      params.$reviewStatus = input.reviewStatus;
    }
    if (input.reviewedAt !== undefined) {
      updates.push('reviewed_at = $reviewedAt');
      params.$reviewedAt = input.reviewedAt.toISOString();
    }
    if (input.codeRefs !== undefined) {
      updates.push('code_refs = $codeRefs');
      params.$codeRefs = JSON.stringify(input.codeRefs);
    }
    if (input.lastVerifiedAt !== undefined) {
      updates.push('last_verified_at = $lastVerifiedAt');
      params.$lastVerifiedAt = input.lastVerifiedAt.toISOString();
    }
    if (input.structured !== undefined) {
      updates.push('structured = $structured');
      params.$structured = serializeStructured(input.structured);
    }
    if (input.evidenceEventIds !== undefined) {
      updates.push('evidence_event_ids = $evidenceEventIds');
      params.$evidenceEventIds = JSON.stringify(input.evidenceEventIds);
    }
    if (input.strength !== undefined) {
      updates.push('strength = $strength');
      params.$strength = Math.max(0, Math.min(1, input.strength));
    }
    if (input.outcomeScore !== undefined) {
      updates.push('outcome_score = $outcomeScore');
      params.$outcomeScore = Math.max(0, Math.min(1, input.outcomeScore));
    }

    this.db
      .query(`
      UPDATE memory_objects SET ${updates.join(', ')} WHERE id = $id
    `)
      .run(params as Record<string, string | number | null>);

    if (input.codeRefs !== undefined) {
      this.replaceCodeRefs(id, input.codeRefs);
    }

    return this.get(id);
  }

  /**
   * Delete a memory object
   */
  delete(id: string): boolean {
    this.deleteTokens(id);
    this.deleteCodeRefs(id);
    const result = this.db
      .query(`
      DELETE FROM memory_objects WHERE id = $id
    `)
      .run({ $id: id });

    return result.changes > 0;
  }

  /**
   * Supersede an object with a new one
   */
  supersede(oldId: string, newId: string): boolean {
    const result = this.db
      .query(`
      UPDATE memory_objects 
      SET status = 'superseded', superseded_by = $newId, updated_at = $now
      WHERE id = $oldId
    `)
      .run({
        $oldId: oldId,
        $newId: newId,
        $now: new Date().toISOString(),
      });

    return result.changes > 0;
  }

  /**
   * Mark an object as stale
   */
  markStale(id: string): boolean {
    return this.update(id, { status: 'stale' }) !== null;
  }

  /**
   * Retire an object
   */
  retire(id: string): boolean {
    return this.update(id, { status: 'retired' }) !== null;
  }

  /**
   * Approve a pending object
   */
  approve(id: string): boolean {
    return this.update(id, { reviewStatus: 'approved', reviewedAt: new Date() }) !== null;
  }

  /**
   * Reject a pending object (marks as retired)
   */
  reject(id: string): boolean {
    const updated = this.update(id, {
      reviewStatus: 'rejected',
      reviewedAt: new Date(),
      status: 'retired',
    });
    return updated !== null;
  }

  /**
   * Add code references to a memory
   */
  addCodeRefs(id: string, refs: CodeReference[]): MemoryObject | null {
    const existing = this.get(id);
    if (!existing) return null;

    const allRefs = [...existing.codeRefs, ...refs];
    return this.update(id, {
      codeRefs: allRefs,
      lastVerifiedAt: new Date(),
    });
  }

  /**
   * Mark a memory as verified (still accurate)
   */
  verify(id: string): MemoryObject | null {
    return this.update(id, {
      lastVerifiedAt: new Date(),
      status: 'active', // Reset to active if it was stale
    });
  }

  /**
   * Get memories with code refs (for staleness checking)
   */
  getWithCodeRefs(): MemoryObject[] {
    const rows = this.db
      .query(`
      SELECT * FROM memory_objects 
      WHERE code_refs != '[]' AND status IN ('active', 'stale')
      ORDER BY last_verified_at ASC
    `)
      .all() as MemoryObjectRow[];

    return rows.map((row) => this.rowToMemoryObject(row));
  }

  /**
   * Increment access count
   */
  recordAccess(id: string): void {
    this.db
      .query(`
      UPDATE memory_objects
      SET access_count = access_count + 1, last_accessed = $now
      WHERE id = $id
    `)
      .run({ $id: id, $now: new Date().toISOString() });
  }

  /**
   * Reinforce a memory (boost strength on access)
   * This implements the brain-inspired reconsolidation mechanism.
   */
  reinforceMemory(id: string): MemoryObject | null {
    const existing = this.get(id);
    if (!existing) return null;

    const now = new Date();
    const newStrength = calculateReinforcedStrength(existing.strength);

    this.db
      .query(`
      UPDATE memory_objects
      SET strength = $strength, last_reinforced_at = $now, last_accessed = $now,
          access_count = access_count + 1
      WHERE id = $id
    `)
      .run({
        $id: id,
        $strength: newStrength,
        $now: now.toISOString(),
      });

    return this.get(id);
  }

  /**
   * Update outcome score for a memory
   */
  updateOutcomeScore(id: string, newScore: number): boolean {
    const result = this.db
      .query(`
      UPDATE memory_objects
      SET outcome_score = $outcomeScore, updated_at = $now
      WHERE id = $id
    `)
      .run({
        $id: id,
        $outcomeScore: Math.max(0, Math.min(1, newScore)),
        $now: new Date().toISOString(),
      });

    return result.changes > 0;
  }

  /**
   * Get memories sorted by effective score (strength * outcome)
   */
  getByEffectiveScore(limit = 20): MemoryObject[] {
    const rows = this.db
      .query(`
      SELECT * FROM memory_objects
      WHERE status = 'active'
      ORDER BY (COALESCE(strength, 1.0) * (0.5 + COALESCE(outcome_score, 0.5))) DESC
      LIMIT $limit
    `)
      .all({ $limit: limit }) as MemoryObjectRow[];

    return rows.map((row) => this.rowToMemoryObject(row));
  }

  /**
   * List memory objects with filters
   */
  list(options: ListOptions = {}): MemoryObject[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (options.status && options.status.length > 0) {
      const placeholders = options.status.map((_, i) => `$status${i}`);
      conditions.push(`status IN (${placeholders.join(', ')})`);
      options.status.forEach((s, i) => {
        params[`$status${i}`] = s;
      });
    }

    if (options.objectType) {
      conditions.push('object_type = $objectType');
      params.$objectType = options.objectType;
    }

    if (options.scopeType) {
      conditions.push('scope_type = $scopeType');
      params.$scopeType = options.scopeType;
    }

    if (options.scopePath) {
      conditions.push('scope_path = $scopePath');
      params.$scopePath = options.scopePath;
    }

    if (options.reviewStatus) {
      conditions.push('review_status = $reviewStatus');
      params.$reviewStatus = options.reviewStatus;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;

    params.$limit = limit;
    params.$offset = offset;

    const rows = this.db
      .query(`
      SELECT * FROM memory_objects
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $limit OFFSET $offset
    `)
      .all(params as Record<string, string | number | null>) as MemoryObjectRow[];

    return rows.map((row) => this.rowToMemoryObject(row));
  }

  /**
   * Get all active constraints
   */
  getActiveConstraints(): MemoryObject[] {
    return this.list({ status: ['active'], objectType: 'constraint' });
  }

  /**
   * Get pending review items
   */
  getPendingReview(limit = 10): MemoryObject[] {
    return this.list({ reviewStatus: 'pending', limit });
  }

  /**
   * Count memory objects by status
   */
  countByStatus(): Record<Status, number> {
    const rows = this.db
      .query(`
      SELECT status, COUNT(*) as count FROM memory_objects GROUP BY status
    `)
      .all() as { status: string; count: number }[];

    const counts: Record<Status, number> = {
      active: 0,
      stale: 0,
      superseded: 0,
      retired: 0,
    };

    for (const row of rows) {
      counts[row.status as Status] = row.count;
    }

    return counts;
  }

  /**
   * Index tokens from content for exact matching
   */
  private indexTokens(objectId: string, content: string): void {
    const tokens = extractTokens(content);

    for (const { token, type } of tokens) {
      try {
        this.db
          .query(`
          INSERT OR IGNORE INTO object_tokens (object_id, token, token_type)
          VALUES ($objectId, $token, $tokenType)
        `)
          .run({
            $objectId: objectId,
            $token: token,
            $tokenType: type,
          });
      } catch {
        // Ignore duplicate key errors
      }
    }
  }

  /**
   * Delete tokens for an object
   */
  private deleteTokens(objectId: string): void {
    this.db
      .query(`
      DELETE FROM object_tokens WHERE object_id = $objectId
    `)
      .run({ $objectId: objectId });
  }

  /**
   * Insert normalized code refs for a memory
   */
  private insertCodeRefs(memoryId: string, refs: CodeReference[]): void {
    if (refs.length === 0) return;

    for (const ref of refs) {
      const lineStart = ref.lineRange ? ref.lineRange[0] : null;
      const lineEnd = ref.lineRange ? ref.lineRange[1] : null;
      const refId = generateId();

      this.db
        .query(`
        INSERT INTO memory_code_refs (
          id, memory_id, path, ref_type, symbol, line_start, line_end, verified_at_commit, content_hash
        )
        VALUES (
          $id, $memoryId, $path, $refType, $symbol, $lineStart, $lineEnd, $verifiedAtCommit, $contentHash
        )
      `)
        .run({
          $id: refId,
          $memoryId: memoryId,
          $path: ref.path,
          $refType: ref.type,
          $symbol: ref.symbol ?? null,
          $lineStart: lineStart,
          $lineEnd: lineEnd,
          $verifiedAtCommit: ref.verifiedAtCommit ?? null,
          $contentHash: ref.contentHash ?? null,
        });
    }
  }

  /**
   * Replace normalized code refs for a memory
   */
  private replaceCodeRefs(memoryId: string, refs: CodeReference[]): void {
    this.deleteCodeRefs(memoryId);
    this.insertCodeRefs(memoryId, refs);
  }

  /**
   * Delete normalized code refs for a memory
   */
  private deleteCodeRefs(memoryId: string): void {
    this.db
      .query(`
      DELETE FROM memory_code_refs WHERE memory_id = $memoryId
    `)
      .run({ $memoryId: memoryId });
  }

  private rowToMemoryObject(row: MemoryObjectRow): MemoryObject {
    const codeRefs = JSON.parse(row.code_refs || '[]') as CodeReference[];
    const evidenceEventIds = JSON.parse(row.evidence_event_ids || '[]');
    const lastVerifiedAt = row.last_verified_at ? new Date(row.last_verified_at) : undefined;
    const reviewStatus = row.review_status as MemoryObject['reviewStatus'];
    const status = row.status as Status;
    const createdAt = new Date(row.created_at);
    const lastAccessed = row.last_accessed ? new Date(row.last_accessed) : undefined;
    const lastReinforcedAt = row.last_reinforced_at
      ? new Date(row.last_reinforced_at)
      : undefined;

    // Calculate confidence tier based on current evidence
    const confidenceTier = calculateConfidenceTier({
      codeRefs,
      evidenceEventIds,
      reviewStatus,
      lastVerifiedAt,
    });

    // Calculate current strength with decay
    const baseStrength = row.strength ?? 1.0;
    const strength = calculateDecayedStrength(baseStrength, lastAccessed, createdAt);

    return {
      id: row.id,
      content: row.content,
      objectType: row.object_type as ObjectType,
      scope: {
        type: row.scope_type as ScopeType,
        path: row.scope_path ?? undefined,
      },
      status,
      supersededBy: row.superseded_by ?? undefined,
      confidence: row.confidence as MemoryObject['confidence'],
      confidenceTier,
      evidenceEventIds,
      evidenceExcerpt: row.evidence_excerpt ?? undefined,
      reviewStatus,
      reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : undefined,
      createdAt,
      updatedAt: new Date(row.updated_at),
      accessCount: row.access_count,
      lastAccessed,
      codeRefs,
      lastVerifiedAt,
      supersedes: row.supersedes ? JSON.parse(row.supersedes) : undefined,
      structured: parseStructured(row.structured),
      strength,
      lastReinforcedAt,
      outcomeScore: row.outcome_score ?? 0.5,
    };
  }
}
