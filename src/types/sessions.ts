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
  lastCheckpointAt?: Date;
  eventsSinceCheckpoint: number;

  // Progressive disclosure tracking
  injectedMemoryIds: string[];
  lastDisclosureAt?: Date;
  errorCount: number;
  disclosureLevel: 'minimal' | 'task' | 'deep';
  lastTopic?: string;
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
  last_checkpoint_at: string | null;
  events_since_checkpoint: number;

  // Progressive disclosure tracking
  injected_memory_ids: string;
  last_disclosure_at: string | null;
  error_count: number;
  disclosure_level: string;
  last_topic: string | null;
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
