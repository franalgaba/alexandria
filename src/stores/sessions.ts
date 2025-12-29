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

  private rowToSession(row: SessionRow): Session {
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
    };
  }
}
