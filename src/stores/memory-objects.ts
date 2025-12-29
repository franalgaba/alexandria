/**
 * Memory object store - curated knowledge storage
 */

import type { Database } from 'bun:sqlite';
import type { Scope, ScopeType } from '../types/common.ts';
import type { CodeReference } from '../types/code-refs.ts';
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
        review_status, created_at, updated_at, code_refs, last_verified_at, structured
      )
      VALUES (
        $id, $content, $objectType, $scopeType, $scopePath,
        $confidence, $evidenceEventIds, $evidenceExcerpt,
        $reviewStatus, $createdAt, $updatedAt, $codeRefs, $lastVerifiedAt, $structured
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
      });

    // Index tokens for exact matching
    this.indexTokens(id, input.content);

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

    this.db
      .query(`
      UPDATE memory_objects SET ${updates.join(', ')} WHERE id = $id
    `)
      .run(params);

    return this.get(id);
  }

  /**
   * Delete a memory object
   */
  delete(id: string): boolean {
    this.deleteTokens(id);
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
      status: 'active',  // Reset to active if it was stale
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
      .all(params) as MemoryObjectRow[];

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

  private rowToMemoryObject(row: MemoryObjectRow): MemoryObject {
    const codeRefs = JSON.parse(row.code_refs || '[]') as CodeReference[];
    const evidenceEventIds = JSON.parse(row.evidence_event_ids || '[]');
    const lastVerifiedAt = row.last_verified_at ? new Date(row.last_verified_at) : undefined;
    const reviewStatus = row.review_status as MemoryObject['reviewStatus'];
    const status = row.status as Status;
    
    // Calculate confidence tier based on current evidence
    const confidenceTier = calculateConfidenceTier({
      codeRefs,
      evidenceEventIds,
      reviewStatus,
      lastVerifiedAt,
      status,
    });
    
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
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      accessCount: row.access_count,
      lastAccessed: row.last_accessed ? new Date(row.last_accessed) : undefined,
      codeRefs,
      lastVerifiedAt,
      supersedes: row.supersedes ? JSON.parse(row.supersedes) : undefined,
      structured: parseStructured(row.structured),
    };
  }
}
