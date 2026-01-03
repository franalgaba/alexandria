/**
 * Memory outcomes store - tracks whether memories were helpful
 */

import type { Database } from 'bun:sqlite';
import { generateId } from '../utils/id.ts';
import { MemoryObjectStore } from './memory-objects.ts';

export type OutcomeType = 'helpful' | 'unhelpful' | 'neutral';

export interface MemoryOutcome {
  id: string;
  memoryId: string;
  sessionId: string;
  timestamp: Date;
  outcome: OutcomeType;
  context?: string;
}

interface OutcomeRow {
  id: string;
  memory_id: string;
  session_id: string;
  timestamp: string;
  outcome: string;
  context: string | null;
}

export class OutcomeStore {
  private memoryStore: MemoryObjectStore;

  constructor(private db: Database) {
    this.memoryStore = new MemoryObjectStore(db);
  }

  /**
   * Record an outcome for a memory
   */
  record(
    memoryId: string,
    sessionId: string,
    outcome: OutcomeType,
    context?: string,
  ): MemoryOutcome {
    const id = generateId();
    const now = new Date();

    this.db
      .query(`
      INSERT INTO memory_outcomes (id, memory_id, session_id, timestamp, outcome, context)
      VALUES ($id, $memoryId, $sessionId, $timestamp, $outcome, $context)
    `)
      .run({
        $id: id,
        $memoryId: memoryId,
        $sessionId: sessionId,
        $timestamp: now.toISOString(),
        $outcome: outcome,
        $context: context ?? null,
      });

    // Update the memory's outcome score
    this.updateMemoryOutcomeScore(memoryId);

    return {
      id,
      memoryId,
      sessionId,
      timestamp: now,
      outcome,
      context,
    };
  }

  /**
   * Get all outcomes for a memory
   */
  getForMemory(memoryId: string): MemoryOutcome[] {
    const rows = this.db
      .query(`
      SELECT * FROM memory_outcomes
      WHERE memory_id = $memoryId
      ORDER BY timestamp DESC
    `)
      .all({ $memoryId: memoryId }) as OutcomeRow[];

    return rows.map((row) => this.rowToOutcome(row));
  }

  /**
   * Get outcomes for a session
   */
  getForSession(sessionId: string): MemoryOutcome[] {
    const rows = this.db
      .query(`
      SELECT * FROM memory_outcomes
      WHERE session_id = $sessionId
      ORDER BY timestamp DESC
    `)
      .all({ $sessionId: sessionId }) as OutcomeRow[];

    return rows.map((row) => this.rowToOutcome(row));
  }

  /**
   * Calculate and update outcome score for a memory
   */
  updateMemoryOutcomeScore(memoryId: string): number {
    const outcomes = this.db
      .query(`
      SELECT outcome, COUNT(*) as count
      FROM memory_outcomes
      WHERE memory_id = $memoryId
      GROUP BY outcome
    `)
      .all({ $memoryId: memoryId }) as { outcome: string; count: number }[];

    const weights: Record<OutcomeType, number> = {
      helpful: 1.0,
      neutral: 0.5,
      unhelpful: 0.0,
    };

    let total = 0;
    let weighted = 0;

    for (const { outcome, count } of outcomes) {
      total += count;
      weighted += count * (weights[outcome as OutcomeType] ?? 0.5);
    }

    const newScore = total > 0 ? weighted / total : 0.5;

    this.memoryStore.updateOutcomeScore(memoryId, newScore);

    return newScore;
  }

  /**
   * Get outcome statistics for a memory
   */
  getStats(memoryId: string): { helpful: number; unhelpful: number; neutral: number } {
    const outcomes = this.db
      .query(`
      SELECT outcome, COUNT(*) as count
      FROM memory_outcomes
      WHERE memory_id = $memoryId
      GROUP BY outcome
    `)
      .all({ $memoryId: memoryId }) as { outcome: string; count: number }[];

    const stats = { helpful: 0, unhelpful: 0, neutral: 0 };

    for (const { outcome, count } of outcomes) {
      if (outcome in stats) {
        stats[outcome as keyof typeof stats] = count;
      }
    }

    return stats;
  }

  /**
   * Delete all outcomes for a memory
   */
  deleteForMemory(memoryId: string): number {
    const result = this.db
      .query(`
      DELETE FROM memory_outcomes WHERE memory_id = $memoryId
    `)
      .run({ $memoryId: memoryId });

    return result.changes;
  }

  private rowToOutcome(row: OutcomeRow): MemoryOutcome {
    return {
      id: row.id,
      memoryId: row.memory_id,
      sessionId: row.session_id,
      timestamp: new Date(row.timestamp),
      outcome: row.outcome as OutcomeType,
      context: row.context ?? undefined,
    };
  }
}
