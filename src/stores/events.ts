/**
 * Event log store - append-only event storage
 */

import type { Database } from 'bun:sqlite';
import type { Event, EventRow, EventType } from '../types/events.ts';
import { generateId } from '../utils/id.ts';
import { estimateTokens, hashContent } from '../utils/tokens.ts';
import { BlobStore } from './blobs.ts';

// Threshold for storing content in blob storage (in tokens)
const BLOB_THRESHOLD_TOKENS = 1000;

export class EventStore {
  private blobStore: BlobStore;

  constructor(private db: Database) {
    this.blobStore = new BlobStore(db);
  }

  /**
   * Append an event to the log (the only way to add events)
   */
  append(event: Omit<Event, 'id'>): Event {
    const id = generateId();
    const contentHash = event.content ? hashContent(event.content) : null;
    const tokenCount = event.content ? estimateTokens(event.content) : 0;

    // Check if content should go to blob storage
    let blobId: string | null = null;
    let inlineContent: string | null = event.content ?? null;

    if (tokenCount > BLOB_THRESHOLD_TOKENS && event.content) {
      blobId = this.blobStore.store(event.content);
      inlineContent = null;
    }

    this.db
      .query(`
      INSERT INTO events (
        id, session_id, timestamp, event_type, content, blob_id,
        tool_name, file_path, exit_code, content_hash, token_count
      )
      VALUES (
        $id, $sessionId, $timestamp, $eventType, $content, $blobId,
        $toolName, $filePath, $exitCode, $contentHash, $tokenCount
      )
    `)
      .run({
        $id: id,
        $sessionId: event.sessionId,
        $timestamp: event.timestamp.toISOString(),
        $eventType: event.eventType,
        $content: inlineContent,
        $blobId: blobId,
        $toolName: event.toolName ?? null,
        $filePath: event.filePath ?? null,
        $exitCode: event.exitCode ?? null,
        $contentHash: contentHash,
        $tokenCount: tokenCount,
      });

    // Update session events count
    this.db
      .query(`
      UPDATE sessions SET events_count = events_count + 1 WHERE id = $sessionId
    `)
      .run({ $sessionId: event.sessionId });

    return {
      ...event,
      id,
      blobId: blobId ?? undefined,
      contentHash: contentHash ?? undefined,
      tokenCount,
    };
  }

  /**
   * Get an event by ID
   */
  get(id: string): Event | null {
    const row = this.db
      .query(`
      SELECT * FROM events WHERE id = $id
    `)
      .get({ $id: id }) as EventRow | null;

    if (!row) return null;

    return this.rowToEvent(row);
  }

  /**
   * Get events by session ID
   */
  getBySession(sessionId: string): Event[] {
    const rows = this.db
      .query(`
      SELECT * FROM events WHERE session_id = $sessionId ORDER BY timestamp
    `)
      .all({ $sessionId: sessionId }) as EventRow[];

    return rows.map((row) => this.rowToEvent(row));
  }

  /**
   * Get events by session ID since a specific timestamp
   * Used to get only events that haven't been checkpointed yet
   */
  getBySessionSince(sessionId: string, since: Date): Event[] {
    const rows = this.db
      .query(`
      SELECT * FROM events 
      WHERE session_id = $sessionId AND timestamp > $since 
      ORDER BY timestamp
    `)
      .all({ $sessionId: sessionId, $since: since.toISOString() }) as EventRow[];

    return rows.map((row) => this.rowToEvent(row));
  }

  /**
   * Get recent events across all sessions
   */
  getRecent(limit = 50): Event[] {
    const rows = this.db
      .query(`
      SELECT * FROM events ORDER BY timestamp DESC LIMIT $limit
    `)
      .all({ $limit: limit }) as EventRow[];

    return rows.map((row) => this.rowToEvent(row));
  }

  /**
   * Get events by type
   */
  getByType(eventType: EventType, limit = 50): Event[] {
    const rows = this.db
      .query(`
      SELECT * FROM events WHERE event_type = $eventType ORDER BY timestamp DESC LIMIT $limit
    `)
      .all({ $eventType: eventType, $limit: limit }) as EventRow[];

    return rows.map((row) => this.rowToEvent(row));
  }

  /**
   * Get full content (resolving blob if needed)
   */
  getContent(event: Event): string | null {
    if (event.content) {
      return event.content;
    }
    if (event.blobId) {
      return this.blobStore.getContent(event.blobId);
    }
    return null;
  }

  /**
   * Check if content already exists (by hash)
   */
  existsByHash(contentHash: string): boolean {
    const row = this.db
      .query(`
      SELECT 1 FROM events WHERE content_hash = $hash LIMIT 1
    `)
      .get({ $hash: contentHash });

    return row !== null;
  }

  /**
   * Count events by session
   */
  countBySession(sessionId: string): number {
    const row = this.db
      .query(`
      SELECT COUNT(*) as count FROM events WHERE session_id = $sessionId
    `)
      .get({ $sessionId: sessionId }) as { count: number };

    return row.count;
  }

  /**
   * Get total event count
   */
  count(): number {
    const row = this.db
      .query(`
      SELECT COUNT(*) as count FROM events
    `)
      .get() as { count: number };

    return row.count;
  }

  private rowToEvent(row: EventRow): Event {
    return {
      id: row.id,
      sessionId: row.session_id,
      timestamp: new Date(row.timestamp),
      eventType: row.event_type as EventType,
      content: row.content ?? undefined,
      blobId: row.blob_id ?? undefined,
      toolName: row.tool_name ?? undefined,
      filePath: row.file_path ?? undefined,
      exitCode: row.exit_code ?? undefined,
      contentHash: row.content_hash ?? undefined,
      tokenCount: row.token_count ?? undefined,
    };
  }
}
