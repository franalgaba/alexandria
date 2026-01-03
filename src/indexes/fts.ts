/**
 * FTS5 lexical index for full-text search
 */

import type { Database } from 'bun:sqlite';
import type { CodeReference } from '../types/code-refs.ts';
import type { Event, EventRow } from '../types/events.ts';
import type { MemoryObject, MemoryObjectRow, Status } from '../types/memory-objects.ts';
import { calculateConfidenceTier } from '../utils/confidence.ts';

export interface FTSEventResult {
  event: Event;
  score: number;
  highlight?: string;
}

export interface FTSObjectResult {
  object: MemoryObject;
  score: number;
  highlight?: string;
}

export class FTSIndex {
  constructor(private db: Database) {}

  /**
   * Search events using FTS5
   */
  searchEvents(query: string, limit = 50): FTSEventResult[] {
    const escapedQuery = this.escapeQuery(query);
    if (!escapedQuery) return [];

    try {
      const rows = this.db
        .query(`
        SELECT 
          e.*,
          bm25(events_fts) as score,
          snippet(events_fts, 0, '<mark>', '</mark>', '...', 32) as highlight
        FROM events e
        JOIN events_fts ON e.rowid = events_fts.rowid
        WHERE events_fts MATCH $query
        ORDER BY bm25(events_fts)
        LIMIT $limit
      `)
        .all({ $query: escapedQuery, $limit: limit }) as (EventRow & {
        score: number;
        highlight: string;
      })[];

      return rows.map((row) => ({
        event: this.rowToEvent(row),
        score: Math.abs(row.score), // BM25 returns negative scores
        highlight: row.highlight,
      }));
    } catch (error) {
      // Handle FTS query errors gracefully
      console.debug('FTS event search error:', error);
      return [];
    }
  }

  /**
   * Search memory objects using FTS5
   */
  searchObjects(query: string, status: Status[] = ['active'], limit = 50): FTSObjectResult[] {
    const escapedQuery = this.escapeQuery(query);
    if (!escapedQuery) return [];

    // Build status filter
    const statusPlaceholders = status.map((_, i) => `$status${i}`).join(', ');
    const statusParams: Record<string, string> = {};
    status.forEach((s, i) => {
      statusParams[`$status${i}`] = s;
    });

    try {
      const rows = this.db
        .query(`
        SELECT 
          m.*,
          bm25(memory_objects_fts) as score,
          snippet(memory_objects_fts, 0, '<mark>', '</mark>', '...', 32) as highlight
        FROM memory_objects m
        JOIN memory_objects_fts ON m.rowid = memory_objects_fts.rowid
        WHERE memory_objects_fts MATCH $query
          AND m.status IN (${statusPlaceholders})
        ORDER BY bm25(memory_objects_fts)
        LIMIT $limit
      `)
        .all({
          $query: escapedQuery,
          $limit: limit,
          ...statusParams,
        }) as (MemoryObjectRow & { score: number; highlight: string })[];

      return rows.map((row) => ({
        object: this.rowToMemoryObject(row),
        score: Math.abs(row.score),
        highlight: row.highlight,
      }));
    } catch (error) {
      console.debug('FTS object search error:', error);
      return [];
    }
  }

  /**
   * Search by exact token match
   */
  searchByToken(token: string, limit = 20): MemoryObject[] {
    const rows = this.db
      .query(`
      SELECT DISTINCT m.* FROM memory_objects m
      JOIN object_tokens t ON m.id = t.object_id
      WHERE t.token = $token AND m.status = 'active'
      LIMIT $limit
    `)
      .all({ $token: token, $limit: limit }) as MemoryObjectRow[];

    return rows.map((row) => this.rowToMemoryObject(row));
  }

  /**
   * Search by token pattern (LIKE)
   */
  searchByTokenPattern(pattern: string, limit = 20): MemoryObject[] {
    const rows = this.db
      .query(`
      SELECT DISTINCT m.* FROM memory_objects m
      JOIN object_tokens t ON m.id = t.object_id
      WHERE t.token LIKE $pattern AND m.status = 'active'
      LIMIT $limit
    `)
      .all({ $pattern: `%${pattern}%`, $limit: limit }) as MemoryObjectRow[];

    return rows.map((row) => this.rowToMemoryObject(row));
  }

  /**
   * Escape FTS5 query to prevent syntax errors and improve recall
   */
  private escapeQuery(query: string): string {
    // Remove FTS5 special characters and normalize whitespace
    // FTS5 operators: AND, OR, NOT, NEAR
    // FTS5 special chars: * : ^ ~ " ( ) { } [ ] - ' + | < > = % @ # $
    // Also remove periods and other punctuation that can cause issues
    const escaped = query
      .replace(/[":*^~(){}[\].!?;,\-/\\'`+|<>=@#$%&]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Common stop words to filter out (they don't add search value)
    const stopWords = new Set([
      'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
      'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
      'into', 'through', 'during', 'before', 'after', 'above', 'below',
      'between', 'under', 'again', 'further', 'then', 'once', 'here',
      'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few',
      'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'only',
      'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'just',
      'don', 'now', 'i', 'me', 'my', 'myself', 'we', 'our', 'ours',
      'you', 'your', 'yours', 'he', 'him', 'his', 'she', 'her', 'hers',
      'it', 'its', 'they', 'them', 'their', 'what', 'which', 'who',
      'this', 'that', 'these', 'those', 'am', 'about', 'get',
    ]);

    // Remove reserved words and stop words
    const words = escaped.split(' ').filter((word) => {
      const lower = word.toLowerCase();
      const upper = word.toUpperCase();
      return (
        word.length >= 2 &&
        !stopWords.has(lower) &&
        upper !== 'AND' && upper !== 'OR' && upper !== 'NOT' && upper !== 'NEAR'
      );
    });

    if (words.length === 0) {
      return '';
    }

    // Use OR to improve recall - match any of the terms
    // This is better for natural language queries
    return words.join(' OR ');
  }

  private rowToEvent(row: EventRow & { score: number; highlight: string }): Event {
    return {
      id: row.id,
      sessionId: row.session_id,
      timestamp: new Date(row.timestamp),
      eventType: row.event_type as Event['eventType'],
      content: row.content ?? undefined,
      blobId: row.blob_id ?? undefined,
      toolName: row.tool_name ?? undefined,
      filePath: row.file_path ?? undefined,
      exitCode: row.exit_code ?? undefined,
      contentHash: row.content_hash ?? undefined,
      tokenCount: row.token_count ?? undefined,
    };
  }

  private rowToMemoryObject(row: MemoryObjectRow): MemoryObject {
    const codeRefs = JSON.parse(row.code_refs || '[]') as CodeReference[];
    const evidenceEventIds = JSON.parse(row.evidence_event_ids || '[]');
    const lastVerifiedAt = row.last_verified_at ? new Date(row.last_verified_at) : undefined;
    const reviewStatus = row.review_status as MemoryObject['reviewStatus'];
    const status = row.status as Status;

    const confidenceTier = calculateConfidenceTier({
      codeRefs,
      evidenceEventIds,
      reviewStatus,
      lastVerifiedAt,
    });

    return {
      id: row.id,
      content: row.content,
      objectType: row.object_type as MemoryObject['objectType'],
      scope: {
        type: row.scope_type as MemoryObject['scope']['type'],
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
      strength: row.strength ?? 1.0,
      lastReinforcedAt: row.last_reinforced_at ? new Date(row.last_reinforced_at) : undefined,
      outcomeScore: row.outcome_score ?? 0.5,
    };
  }
}
