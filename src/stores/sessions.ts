/**
 * Session store - track agent sessions
 */

import type { Database } from 'bun:sqlite';
import type {
  CreateSessionInput,
  PreviousSessionContext,
  Session,
  SessionRow,
} from '../types/sessions.ts';
import { generateId } from '../utils/id.ts';

export class SessionStore {
  constructor(private db: Database) {}

  /**
   * Start a new session
   */
  start(input: CreateSessionInput = {}): Session {
    const id = generateId();
    const now = new Date();

    this.db
      .query(`
      INSERT INTO sessions (
        id, started_at, working_directory, working_file, working_task
      )
      VALUES (
        $id, $startedAt, $workingDirectory, $workingFile, $workingTask
      )
    `)
      .run({
        $id: id,
        $startedAt: now.toISOString(),
        $workingDirectory: input.workingDirectory ?? null,
        $workingFile: input.workingFile ?? null,
        $workingTask: input.workingTask ?? null,
      });

    return {
      id,
      startedAt: now,
      workingDirectory: input.workingDirectory,
      workingFile: input.workingFile,
      workingTask: input.workingTask,
      eventsCount: 0,
      objectsCreated: 0,
      objectsAccessed: 0,
      eventsSinceCheckpoint: 0,
      // Progressive disclosure defaults
      injectedMemoryIds: [],
      errorCount: 0,
      disclosureLevel: 'task',
    };
  }

  /**
   * End a session
   */
  end(id: string, summary?: string): boolean {
    const result = this.db
      .query(`
      UPDATE sessions 
      SET ended_at = $endedAt, summary = $summary
      WHERE id = $id
    `)
      .run({
        $id: id,
        $endedAt: new Date().toISOString(),
        $summary: summary ?? null,
      });

    return result.changes > 0;
  }

  /**
   * Get a session by ID
   */
  get(id: string): Session | null {
    const row = this.db
      .query(`
      SELECT * FROM sessions WHERE id = $id
    `)
      .get({ $id: id }) as SessionRow | null;

    if (!row) return null;

    return this.rowToSession(row);
  }

  /**
   * Get the most recent session
   */
  getLatest(): Session | null {
    const row = this.db
      .query(`
      SELECT * FROM sessions ORDER BY started_at DESC LIMIT 1
    `)
      .get() as SessionRow | null;

    if (!row) return null;

    return this.rowToSession(row);
  }

  /**
   * Get the current (active, not ended) session
   */
  getCurrent(): Session | null {
    const row = this.db
      .query(`
      SELECT * FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1
    `)
      .get() as SessionRow | null;

    if (!row) return null;

    return this.rowToSession(row);
  }

  /**
   * Get the previous session (the one before the current/latest)
   */
  getPrevious(): Session | null {
    const row = this.db
      .query(`
      SELECT * FROM sessions ORDER BY started_at DESC LIMIT 1 OFFSET 1
    `)
      .get() as SessionRow | null;

    if (!row) return null;

    return this.rowToSession(row);
  }

  /**
   * Get previous session context for injection
   */
  getPreviousContext(): PreviousSessionContext | null {
    const prev = this.getPrevious();
    if (!prev || !prev.summary) return null;

    return {
      summary: prev.summary,
      workingFile: prev.workingFile,
      workingTask: prev.workingTask,
    };
  }

  /**
   * Update session task
   */
  updateTask(id: string, task: string): boolean {
    const result = this.db
      .query(`
      UPDATE sessions SET working_task = $task WHERE id = $id
    `)
      .run({ $id: id, $task: task });

    return result.changes > 0;
  }

  /**
   * Update session working file
   */
  updateWorkingFile(id: string, file: string): boolean {
    const result = this.db
      .query(`
      UPDATE sessions SET working_file = $file WHERE id = $id
    `)
      .run({ $id: id, $file: file });

    return result.changes > 0;
  }

  /**
   * Increment objects created count
   */
  incrementObjectsCreated(id: string): void {
    this.db
      .query(`
      UPDATE sessions SET objects_created = objects_created + 1 WHERE id = $id
    `)
      .run({ $id: id });
  }

  /**
   * Increment objects accessed count
   */
  incrementObjectsAccessed(id: string): void {
    this.db
      .query(`
      UPDATE sessions SET objects_accessed = objects_accessed + 1 WHERE id = $id
    `)
      .run({ $id: id });
  }

  /**
   * Increment events since last checkpoint
   * Returns the new count (for auto-checkpoint triggering)
   */
  incrementEventsSinceCheckpoint(id: string): number {
    this.db
      .query(`
      UPDATE sessions SET events_since_checkpoint = events_since_checkpoint + 1 WHERE id = $id
    `)
      .run({ $id: id });

    const row = this.db
      .query(`SELECT events_since_checkpoint FROM sessions WHERE id = $id`)
      .get({ $id: id }) as { events_since_checkpoint: number } | null;

    return row?.events_since_checkpoint ?? 0;
  }

  /**
   * Mark checkpoint completed - reset counter and update timestamp
   */
  markCheckpointCompleted(id: string): void {
    this.db
      .query(`
      UPDATE sessions 
      SET events_since_checkpoint = 0, last_checkpoint_at = $now 
      WHERE id = $id
    `)
      .run({ $id: id, $now: new Date().toISOString() });
  }

  /**
   * Get events since last checkpoint for a session
   */
  getEventsSinceCheckpoint(id: string): number {
    const row = this.db
      .query(`SELECT events_since_checkpoint FROM sessions WHERE id = $id`)
      .get({ $id: id }) as { events_since_checkpoint: number } | null;

    return row?.events_since_checkpoint ?? 0;
  }

  /**
   * List recent sessions
   */
  list(limit = 20): Session[] {
    const rows = this.db
      .query(`
      SELECT * FROM sessions ORDER BY started_at DESC LIMIT $limit
    `)
      .all({ $limit: limit }) as SessionRow[];

    return rows.map((row) => this.rowToSession(row));
  }

  /**
   * Count total sessions
   */
  count(): number {
    const row = this.db
      .query(`
      SELECT COUNT(*) as count FROM sessions
    `)
      .get() as { count: number };

    return row.count;
  }

  // ============================================================================
  // Progressive Disclosure Methods
  // ============================================================================

  /**
   * Get injected memory IDs for session
   */
  getInjectedMemoryIds(id: string): string[] {
    const row = this.db
      .query(`SELECT injected_memory_ids FROM sessions WHERE id = $id`)
      .get({ $id: id }) as { injected_memory_ids: string } | null;

    if (!row || !row.injected_memory_ids) return [];

    try {
      return JSON.parse(row.injected_memory_ids);
    } catch {
      return [];
    }
  }

  /**
   * Add memory IDs to injected list (dedupes automatically)
   */
  addInjectedMemoryIds(id: string, memoryIds: string[]): void {
    const existing = this.getInjectedMemoryIds(id);
    const combined = [...new Set([...existing, ...memoryIds])];

    this.db
      .query(`
        UPDATE sessions
        SET injected_memory_ids = $ids, last_disclosure_at = $now
        WHERE id = $id
      `)
      .run({
        $id: id,
        $ids: JSON.stringify(combined),
        $now: new Date().toISOString(),
      });
  }

  /**
   * Increment error count
   */
  incrementErrorCount(id: string): number {
    this.db
      .query(`UPDATE sessions SET error_count = error_count + 1 WHERE id = $id`)
      .run({ $id: id });

    const row = this.db
      .query(`SELECT error_count FROM sessions WHERE id = $id`)
      .get({ $id: id }) as { error_count: number } | null;

    return row?.error_count ?? 0;
  }

  /**
   * Reset error count (after successful disclosure)
   */
  resetErrorCount(id: string): void {
    this.db.query(`UPDATE sessions SET error_count = 0 WHERE id = $id`).run({ $id: id });
  }

  /**
   * Update current topic/file
   */
  updateTopic(id: string, topic: string): { shifted: boolean; previousTopic?: string } {
    const row = this.db.query(`SELECT last_topic FROM sessions WHERE id = $id`).get({ $id: id }) as {
      last_topic: string | null;
    } | null;

    const previousTopic = row?.last_topic;
    const shifted = previousTopic !== null && previousTopic !== topic;

    this.db
      .query(`UPDATE sessions SET last_topic = $topic WHERE id = $id`)
      .run({ $id: id, $topic: topic });

    return { shifted, previousTopic: previousTopic ?? undefined };
  }

  /**
   * Update disclosure level
   */
  updateDisclosureLevel(id: string, level: 'minimal' | 'task' | 'deep'): void {
    this.db
      .query(`UPDATE sessions SET disclosure_level = $level WHERE id = $id`)
      .run({ $id: id, $level: level });
  }

  /**
   * Get error count for a session
   */
  getErrorCount(id: string): number {
    const row = this.db
      .query(`SELECT error_count FROM sessions WHERE id = $id`)
      .get({ $id: id }) as { error_count: number } | null;

    return row?.error_count ?? 0;
  }

  private rowToSession(row: SessionRow): Session {
    let injectedMemoryIds: string[] = [];
    try {
      injectedMemoryIds = row.injected_memory_ids ? JSON.parse(row.injected_memory_ids) : [];
    } catch {
      injectedMemoryIds = [];
    }

    return {
      id: row.id,
      startedAt: new Date(row.started_at),
      endedAt: row.ended_at ? new Date(row.ended_at) : undefined,
      workingDirectory: row.working_directory ?? undefined,
      workingFile: row.working_file ?? undefined,
      workingTask: row.working_task ?? undefined,
      summary: row.summary ?? undefined,
      eventsCount: row.events_count,
      objectsCreated: row.objects_created,
      objectsAccessed: row.objects_accessed,
      lastCheckpointAt: row.last_checkpoint_at ? new Date(row.last_checkpoint_at) : undefined,
      eventsSinceCheckpoint: row.events_since_checkpoint ?? 0,

      // Progressive disclosure fields
      injectedMemoryIds,
      lastDisclosureAt: row.last_disclosure_at ? new Date(row.last_disclosure_at) : undefined,
      errorCount: row.error_count ?? 0,
      disclosureLevel: (row.disclosure_level as 'minimal' | 'task' | 'deep') ?? 'task',
      lastTopic: row.last_topic ?? undefined,
    };
  }
}
