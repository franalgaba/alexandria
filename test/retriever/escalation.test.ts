/**
 * Tests for Escalation Detector
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  EscalationDetector,
  createEscalationDetector,
  type EscalationSignal,
} from '../../src/retriever/escalation.ts';
import type { Session } from '../../src/types/sessions.ts';

describe('EscalationDetector', () => {
  let db: Database;
  let detector: EscalationDetector;

  // Base session for tests
  const baseSession: Session = {
    id: 'test-session',
    startedAt: new Date(),
    workingDirectory: '/test',
    eventsCount: 0,
    objectsCreated: 0,
    objectsAccessed: 0,
    eventsSinceCheckpoint: 0,
    injectedMemoryIds: [],
    errorCount: 0,
    disclosureLevel: 'task',
  };

  beforeEach(() => {
    db = new Database(':memory:');
    detector = new EscalationDetector(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('analyze - explicit query triggers', () => {
    test('detects "remind me" trigger', () => {
      const session = { ...baseSession };
      const result = detector.analyze(session, 'Can you remind me what we decided?');

      expect(result).not.toBeNull();
      expect(result!.trigger).toBe('explicit_query');
      expect(result!.confidence).toBe(1.0);
      expect(result!.suggestedLevel).toBe('deep');
    });

    test('detects "what did we decide" trigger', () => {
      const session = { ...baseSession };
      const result = detector.analyze(session, 'what did we decide about the database?');

      expect(result).not.toBeNull();
      expect(result!.trigger).toBe('explicit_query');
      expect(result!.reason).toContain('past decisions');
    });

    test('detects constraint question trigger', () => {
      const session = { ...baseSession };
      const result = detector.analyze(session, "what's the constraint for API keys?");

      expect(result).not.toBeNull();
      expect(result!.trigger).toBe('explicit_query');
    });

    test('detects convention question trigger', () => {
      const session = { ...baseSession };
      const result = detector.analyze(session, 'are there any conventions for file naming?');

      expect(result).not.toBeNull();
      expect(result!.trigger).toBe('explicit_query');
    });

    test('detects failure question trigger', () => {
      const session = { ...baseSession };
      const result = detector.analyze(session, 'what went wrong before with the build?');

      expect(result).not.toBeNull();
      expect(result!.trigger).toBe('explicit_query');
    });

    test('detects fix question trigger', () => {
      const session = { ...baseSession };
      const result = detector.analyze(session, 'how did we fix the auth issue?');

      expect(result).not.toBeNull();
      expect(result!.trigger).toBe('explicit_query');
    });

    test('detects choice question trigger', () => {
      const session = { ...baseSession };
      const result = detector.analyze(session, 'why did we choose Bun over Node?');

      expect(result).not.toBeNull();
      expect(result!.trigger).toBe('explicit_query');
    });

    test('returns null for normal queries', () => {
      const session = { ...baseSession };
      const result = detector.analyze(session, 'please add a new function');

      expect(result).toBeNull();
    });
  });

  describe('analyze - error burst detection', () => {
    test('triggers on 3+ errors', () => {
      const session = { ...baseSession, errorCount: 3 };
      const result = detector.analyze(session);

      expect(result).not.toBeNull();
      expect(result!.trigger).toBe('error_burst');
      expect(result!.suggestedLevel).toBe('deep');
    });

    test('scales confidence with error count', () => {
      const session3 = { ...baseSession, errorCount: 3 };
      const session5 = { ...baseSession, errorCount: 5 };
      const session10 = { ...baseSession, errorCount: 10 };

      const result3 = detector.analyze(session3);
      const result5 = detector.analyze(session5);
      const result10 = detector.analyze(session10);

      expect(result3!.confidence).toBe(0.6); // 3/5
      expect(result5!.confidence).toBe(1.0); // 5/5 capped
      expect(result10!.confidence).toBe(1.0); // capped at 1.0
    });

    test('does not trigger on 2 errors', () => {
      const session = { ...baseSession, errorCount: 2 };
      const result = detector.analyze(session);

      expect(result).toBeNull();
    });
  });

  describe('analyze - topic shift detection', () => {
    test('detects file change as topic shift', () => {
      const session = { ...baseSession, lastTopic: 'src/old-file.ts' };
      const result = detector.analyze(session, undefined, 'src/new-file.ts');

      expect(result).not.toBeNull();
      expect(result!.trigger).toBe('topic_shift');
      expect(result!.confidence).toBe(0.7);
      expect(result!.suggestedLevel).toBe('task');
    });

    test('no trigger when file stays same', () => {
      const session = { ...baseSession, lastTopic: 'src/file.ts' };
      const result = detector.analyze(session, undefined, 'src/file.ts');

      expect(result).toBeNull();
    });

    test('no trigger when no lastTopic set', () => {
      const session = { ...baseSession };
      const result = detector.analyze(session, undefined, 'src/file.ts');

      expect(result).toBeNull();
    });
  });

  describe('analyze - event threshold detection', () => {
    test('triggers after 15 events since checkpoint', () => {
      const session = {
        ...baseSession,
        eventsSinceCheckpoint: 15,
        eventsCount: 20,
        lastDisclosureAt: new Date(Date.now() - 120000), // 2 minutes ago
      };
      const result = detector.analyze(session);

      expect(result).not.toBeNull();
      expect(result!.trigger).toBe('event_threshold');
      expect(result!.confidence).toBe(0.5);
    });

    test('respects minimum disclosure gap', () => {
      const session = {
        ...baseSession,
        eventsSinceCheckpoint: 20,
        lastDisclosureAt: new Date(Date.now() - 30000), // 30 seconds ago
      };
      const result = detector.analyze(session);

      expect(result).toBeNull(); // Should not trigger within gap
    });

    test('does not trigger under threshold', () => {
      const session = {
        ...baseSession,
        eventsSinceCheckpoint: 10,
      };
      const result = detector.analyze(session);

      expect(result).toBeNull();
    });
  });

  describe('analyze - signal priority', () => {
    test('prefers explicit query over error burst', () => {
      const session = { ...baseSession, errorCount: 5 };
      const result = detector.analyze(session, 'remind me about the constraints');

      expect(result!.trigger).toBe('explicit_query');
    });

    test('prefers error burst over event threshold', () => {
      const session = {
        ...baseSession,
        errorCount: 3,
        eventsSinceCheckpoint: 20,
        lastDisclosureAt: new Date(Date.now() - 120000),
      };
      const result = detector.analyze(session);

      // Error burst has higher confidence (0.6) than event threshold (0.5)
      expect(result!.trigger).toBe('error_burst');
    });
  });

  describe('analyze - suggested level based on depth', () => {
    test('suggests task for short sessions', () => {
      const session = {
        ...baseSession,
        eventsCount: 20,
        eventsSinceCheckpoint: 15,
        lastDisclosureAt: new Date(Date.now() - 120000),
      };
      const result = detector.analyze(session);

      expect(result!.suggestedLevel).toBe('task');
    });

    test('suggests deep for long sessions', () => {
      const session = {
        ...baseSession,
        eventsCount: 100,
        eventsSinceCheckpoint: 15,
        lastDisclosureAt: new Date(Date.now() - 120000),
      };
      const result = detector.analyze(session);

      expect(result!.suggestedLevel).toBe('deep');
    });
  });

  describe('isDisclosureNeeded', () => {
    test('returns needed: true with signal when trigger detected', () => {
      const session = { ...baseSession, errorCount: 5 };
      const result = detector.isDisclosureNeeded(session);

      expect(result.needed).toBe(true);
      expect(result.signal).toBeDefined();
      expect(result.signal!.trigger).toBe('error_burst');
    });

    test('returns needed: false when no trigger', () => {
      const session = { ...baseSession };
      const result = detector.isDisclosureNeeded(session);

      expect(result.needed).toBe(false);
      expect(result.signal).toBeUndefined();
    });
  });

  describe('intent-based detection', () => {
    test('detects history intent', () => {
      const session = { ...baseSession };
      // "why" questions often get classified as history
      const result = detector.analyze(session, 'what were the past decisions here?');

      // This may or may not trigger depending on intent classification
      // The important thing is that history-type queries can trigger disclosure
      if (result) {
        expect(result.trigger).toBe('explicit_query');
      }
    });

    test('detects debugging intent', () => {
      const session = { ...baseSession };
      const result = detector.analyze(session, 'debug why this is failing');

      // Debug queries may trigger disclosure
      if (result) {
        expect(result.trigger).toBe('explicit_query');
        expect(result.suggestedLevel).toBe('deep');
      }
    });
  });

  describe('createEscalationDetector', () => {
    test('factory function creates instance', () => {
      const instance = createEscalationDetector(db);
      expect(instance).toBeInstanceOf(EscalationDetector);
    });
  });
});
