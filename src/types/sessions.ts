/**
 * Session types for tracking agent sessions
 */

export interface Session {
  id: string;
  startedAt: Date;
  endedAt?: Date;
  workingDirectory?: string;
  workingFile?: string;
  workingTask?: string;
  summary?: string;
  eventsCount: number;
  objectsCreated: number;
  objectsAccessed: number;
}

export interface SessionRow {
  id: string;
  started_at: string;
  ended_at: string | null;
  working_directory: string | null;
  working_file: string | null;
  working_task: string | null;
  summary: string | null;
  events_count: number;
  objects_created: number;
  objects_accessed: number;
}

export interface CreateSessionInput {
  workingDirectory?: string;
  workingFile?: string;
  workingTask?: string;
}

export interface PreviousSessionContext {
  summary: string;
  workingFile?: string;
  workingTask?: string;
}
