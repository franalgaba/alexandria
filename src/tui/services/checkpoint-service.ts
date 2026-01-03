/**
 * Checkpoint Status Service
 *
 * Provides checkpoint progress data for the TUI.
 */

import type { Database } from 'bun:sqlite';
import { EventStore } from '../../stores/events.ts';
import { SessionStore } from '../../stores/sessions.ts';
import type { CheckpointStatus } from '../state/types.ts';
import { DEFAULT_CHECKPOINT_THRESHOLD } from '../utils/constants.ts';

export class CheckpointService {
  private db: Database | null = null;
  private sessionStore: SessionStore | null = null;
  private eventStore: EventStore | null = null;
  private pollingInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Initialize with database connection
   */
  initialize(db: Database): void {
    this.db = db;
    this.sessionStore = new SessionStore(db);
    this.eventStore = new EventStore(db);
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return this.sessionStore !== null;
  }

  /**
   * Get current session
   */
  getCurrentSession() {
    if (!this.sessionStore) return null;
    try {
      return this.sessionStore.getCurrent();
    } catch {
      return null;
    }
  }

  /**
   * Get checkpoint threshold from environment
   */
  getThreshold(): number {
    return parseInt(
      process.env.ALEXANDRIA_AUTO_CHECKPOINT_THRESHOLD || String(DEFAULT_CHECKPOINT_THRESHOLD),
    );
  }

  /**
   * Get checkpoint progress
   */
  getProgress(): { current: number; threshold: number } {
    const session = this.getCurrentSession();
    return {
      current: session?.eventsSinceCheckpoint || 0,
      threshold: this.getThreshold(),
    };
  }

  /**
   * Get full checkpoint status
   */
  getStatus(): CheckpointStatus | null {
    const session = this.getCurrentSession();
    if (!session) return null;

    const threshold = this.getThreshold();
    const lastCheckpoint = session.lastCheckpointAt ? new Date(session.lastCheckpointAt) : null;

    const timeSince = lastCheckpoint ? Date.now() - lastCheckpoint.getTime() : 0;

    return {
      eventsSinceCheckpoint: session.eventsSinceCheckpoint || 0,
      checkpointThreshold: threshold,
      timeSinceLastCheckpoint: timeSince,
      isExtracting: false, // TODO: Track extraction state
      lastCheckpointAt: lastCheckpoint,
    };
  }

  /**
   * Get recent events count
   */
  getRecentEventsCount(): number {
    if (!this.eventStore) return 0;
    const session = this.getCurrentSession();
    if (!session) return 0;

    try {
      return this.eventStore.countBySession(session.id);
    } catch {
      return 0;
    }
  }

  /**
   * Start polling for updates
   */
  startPolling(onUpdate: () => void, intervalMs: number = 1000): void {
    this.stopPolling();
    this.pollingInterval = setInterval(onUpdate, intervalMs);
  }

  /**
   * Stop polling
   */
  stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  /**
   * Cleanup
   */
  cleanup(): void {
    this.stopPolling();
    this.sessionStore = null;
    this.eventStore = null;
    this.db = null;
  }
}

// Singleton instance
export const checkpointService = new CheckpointService();
