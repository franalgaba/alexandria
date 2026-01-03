/**
 * Escalation Detector - determines when to re-inject memories
 *
 * Hybrid strategy combining:
 * - Depth thresholds (event count)
 * - Error detection (3+ errors → constraint-focused)
 * - Topic/file shifts
 * - Explicit query triggers
 */

import type { Database } from 'bun:sqlite';
import type { Session } from '../types/sessions.ts';
import { classifyIntent, type QueryIntent } from './intent.ts';

// Configuration via environment
const DISCLOSURE_EVENT_THRESHOLD =
  Number(process.env.ALEXANDRIA_DISCLOSURE_THRESHOLD) || 15;
const ERROR_BURST_THRESHOLD =
  Number(process.env.ALEXANDRIA_ERROR_BURST_THRESHOLD) || 3;
const MIN_DISCLOSURE_GAP_MS = 60_000; // Minimum 1 minute between disclosures

export type EscalationTrigger =
  | 'event_threshold'
  | 'error_burst'
  | 'topic_shift'
  | 'explicit_query'
  | 'constraint_relevant';

export type ContextLevel = 'minimal' | 'task' | 'deep';

export interface EscalationSignal {
  trigger: EscalationTrigger;
  confidence: number; // 0-1
  suggestedLevel: ContextLevel;
  query?: string;
  topic?: string;
  reason: string;
}

// Explicit query patterns that trigger immediate disclosure
const EXPLICIT_TRIGGERS = [
  { pattern: /remind\s+me/i, reason: 'User requested reminder' },
  { pattern: /what\s+did\s+we\s+decide/i, reason: 'User asking about past decisions' },
  { pattern: /what('s|s)?\s+the\s+constraint/i, reason: 'User asking about constraints' },
  { pattern: /what\s+should\s+i\s+(remember|know)/i, reason: 'User asking for context' },
  { pattern: /any\s+conventions?\s+for/i, reason: 'User asking about conventions' },
  { pattern: /what\s+went\s+wrong\s+(before|last\s+time)/i, reason: 'User asking about failures' },
  { pattern: /what\s+failed\s+(before|previously)/i, reason: 'User asking about failures' },
  { pattern: /how\s+did\s+we\s+fix/i, reason: 'User asking about fixes' },
  { pattern: /why\s+did\s+we\s+choose/i, reason: 'User asking about past choices' },
];

export class EscalationDetector {
  constructor(private db: Database) {}

  /**
   * Analyze current session state and determine if escalation needed
   */
  analyze(
    session: Session,
    currentQuery?: string,
    currentFile?: string,
  ): EscalationSignal | null {
    const signals: EscalationSignal[] = [];

    // 1. Check explicit query triggers (highest priority)
    if (currentQuery) {
      const explicitSignal = this.checkExplicitTrigger(currentQuery);
      if (explicitSignal) {
        signals.push(explicitSignal);
      }
    }

    // 2. Check error burst (high priority)
    if (session.errorCount >= ERROR_BURST_THRESHOLD) {
      signals.push({
        trigger: 'error_burst',
        confidence: Math.min(1.0, session.errorCount / 5),
        suggestedLevel: 'deep', // Deep context when struggling
        reason: `${session.errorCount} errors detected - showing constraints and known fixes`,
      });
    }

    // 3. Check topic shift
    if (currentFile && session.lastTopic && currentFile !== session.lastTopic) {
      signals.push({
        trigger: 'topic_shift',
        confidence: 0.7,
        suggestedLevel: 'task',
        topic: currentFile,
        reason: `Topic changed from ${session.lastTopic} to ${currentFile}`,
      });
    }

    // 4. Check event threshold (moderate priority)
    if (session.eventsSinceCheckpoint >= DISCLOSURE_EVENT_THRESHOLD) {
      // Only if enough time has passed
      const now = Date.now();
      const lastDisclosure = session.lastDisclosureAt?.getTime() ?? 0;

      if (now - lastDisclosure >= MIN_DISCLOSURE_GAP_MS) {
        signals.push({
          trigger: 'event_threshold',
          confidence: 0.5,
          suggestedLevel: this.suggestLevelForEventCount(session.eventsCount),
          reason: `${session.eventsSinceCheckpoint} events since last checkpoint`,
        });
      }
    }

    // Return highest confidence signal
    if (signals.length === 0) return null;

    signals.sort((a, b) => b.confidence - a.confidence);
    return signals[0];
  }

  /**
   * Check if query is an explicit trigger
   */
  private checkExplicitTrigger(query: string): EscalationSignal | null {
    for (const { pattern, reason } of EXPLICIT_TRIGGERS) {
      if (pattern.test(query)) {
        return {
          trigger: 'explicit_query',
          confidence: 1.0,
          suggestedLevel: 'deep',
          query,
          reason,
        };
      }
    }

    // Also check intent classification for history/debugging
    const intent = classifyIntent(query);
    if (intent === 'history') {
      return {
        trigger: 'explicit_query',
        confidence: 0.8,
        suggestedLevel: 'deep',
        query,
        reason: 'Query classified as history lookup',
      };
    }
    if (intent === 'debugging') {
      return {
        trigger: 'explicit_query',
        confidence: 0.7,
        suggestedLevel: 'deep',
        query,
        reason: 'Query classified as debugging',
      };
    }

    return null;
  }

  /**
   * Suggest level based on event count (session depth)
   */
  private suggestLevelForEventCount(eventCount: number): ContextLevel {
    if (eventCount < 30) return 'task';
    if (eventCount < 75) return 'task'; // Stay at task for mid-session
    return 'deep'; // Deep for long sessions
  }

  /**
   * Check if disclosure is needed (simpler version for CLI)
   */
  isDisclosureNeeded(
    session: Session,
    currentQuery?: string,
    currentFile?: string,
  ): { needed: boolean; signal?: EscalationSignal } {
    const signal = this.analyze(session, currentQuery, currentFile);
    return {
      needed: signal !== null,
      signal: signal ?? undefined,
    };
  }
}

/**
 * Factory function for creating detector
 */
export function createEscalationDetector(db: Database): EscalationDetector {
  return new EscalationDetector(db);
}
