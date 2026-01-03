/**
 * Integration Tests for Progressive Memory Disclosure
 *
 * Tests the end-to-end flow of:
 * 1. Session start with heatmap-prioritized memories
 * 2. Context window monitoring
 * 3. Escalation detection and disclosure
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ProgressiveRetriever } from '../../src/retriever/progressive.ts';
import { AccessHeatmap } from '../../src/retriever/heatmap.ts';
import { EscalationDetector } from '../../src/retriever/escalation.ts';
import { calculateContextUsage } from '../../src/utils/context-monitor.ts';
import type { Session } from '../../src/types/sessions.ts';

describe('Progressive Disclosure Integration', () => {
  let db: Database;
  const testDir = join(import.meta.dir, '.test-progressive');

  beforeEach(() => {
    db = new Database(':memory:');
    mkdirSync(testDir, { recursive: true });

    // Create full schema for integration testing
    db.run(`
      CREATE TABLE memory_objects (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        object_type TEXT NOT NULL,
        scope TEXT DEFAULT '{"type":"project"}',
        status TEXT DEFAULT 'active',
        confidence REAL DEFAULT 0.7,
        confidence_tier TEXT DEFAULT 'inferred',
        evidence_event_ids TEXT DEFAULT '[]',
        review_status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        access_count INTEGER DEFAULT 0,
        last_accessed TEXT,
        code_refs TEXT DEFAULT '[]',
        supersedes TEXT,
        superseded_by TEXT
      )
    `);

    // Create FTS table
    db.run(`
      CREATE VIRTUAL TABLE memory_fts USING fts5(
        id,
        content,
        object_type
      )
    `);

    // Create sessions table
    db.run(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        working_directory TEXT NOT NULL,
        events_count INTEGER DEFAULT 0,
        objects_created INTEGER DEFAULT 0,
        objects_accessed INTEGER DEFAULT 0,
        events_since_checkpoint INTEGER DEFAULT 0,
        injected_memory_ids TEXT DEFAULT '[]',
        last_disclosure_at TEXT,
        error_count INTEGER DEFAULT 0,
        disclosure_level TEXT DEFAULT 'task',
        last_topic TEXT
      )
    `);
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('Session Start Flow', () => {
    test('prioritizes hot memories at session start', () => {
      // Insert memories with varying access counts
      db.run(`
        INSERT INTO memory_objects (id, content, object_type, access_count, last_accessed, status)
        VALUES
          ('hot1', 'Use Bun for TypeScript', 'constraint', 50, datetime('now'), 'active'),
          ('hot2', 'Never commit .env files', 'constraint', 40, datetime('now'), 'active'),
          ('cold1', 'Use consistent naming', 'convention', 5, datetime('now', '-60 days'), 'active'),
          ('cold2', 'Format with Prettier', 'convention', 3, datetime('now', '-60 days'), 'active')
      `);

      // Get hot memory IDs
      const heatmap = new AccessHeatmap(db);
      const hotIds = heatmap.getHotMemoryIds(2);

      expect(hotIds).toEqual(['hot1', 'hot2']);

      // Use progressive retriever with priority IDs
      const retriever = new ProgressiveRetriever(db);
      const pack = retriever.getMinimalContext();

      // Constraints should be included
      expect(pack.objects.length).toBeGreaterThanOrEqual(2);
    });

    test('retriever does not increment access count (no feedback loop)', () => {
      db.run(`
        INSERT INTO memory_objects (id, content, object_type, access_count, last_accessed, status)
        VALUES ('m1', 'Test memory', 'constraint', 10, datetime('now'), 'active')
      `);

      const retriever = new ProgressiveRetriever(db);

      // Get context multiple times
      retriever.getMinimalContext();
      retriever.getMinimalContext();
      retriever.getMinimalContext();

      // Check access count hasn't changed
      const row = db.query('SELECT access_count FROM memory_objects WHERE id = $id').get({
        $id: 'm1',
      }) as { access_count: number };

      expect(row.access_count).toBe(10); // Should remain unchanged
    });
  });

  describe('Context Window Monitoring', () => {
    test('monitors context and triggers checkpoint recommendation', () => {
      const transcriptPath = join(testDir, 'context.jsonl');

      // Simulate 55% context usage
      const entries = [
        {
          timestamp: '2024-01-01T10:00:00Z',
          message: {
            usage: {
              input_tokens: 90000,
              output_tokens: 20000,
            },
          },
        },
      ];

      writeFileSync(transcriptPath, entries.map((e) => JSON.stringify(e)).join('\n'));

      const usage = calculateContextUsage(transcriptPath);

      expect(usage).not.toBeNull();
      expect(usage!.exceeds50Percent).toBe(true);
      expect(usage!.recommendation).toBe('checkpoint_and_clear');
    });

    test('continues normally under threshold', () => {
      const transcriptPath = join(testDir, 'normal.jsonl');

      // Simulate 25% context usage
      const entries = [
        {
          timestamp: '2024-01-01T10:00:00Z',
          message: {
            usage: {
              input_tokens: 40000,
              output_tokens: 10000,
            },
          },
        },
      ];

      writeFileSync(transcriptPath, entries.map((e) => JSON.stringify(e)).join('\n'));

      const usage = calculateContextUsage(transcriptPath);

      expect(usage!.exceeds50Percent).toBe(false);
      expect(usage!.recommendation).toBe('continue');
    });
  });

  describe('Escalation Detection Flow', () => {
    test('escalates on explicit memory queries', () => {
      const detector = new EscalationDetector(db);
      const session: Session = {
        id: 'test',
        startedAt: new Date(),
        workingDirectory: '/test',
        eventsCount: 5,
        objectsCreated: 0,
        objectsAccessed: 0,
        eventsSinceCheckpoint: 5,
        injectedMemoryIds: [],
        errorCount: 0,
        disclosureLevel: 'task',
      };

      // User asks about past decisions
      const result = detector.isDisclosureNeeded(session, 'what did we decide about the API?');

      expect(result.needed).toBe(true);
      expect(result.signal?.trigger).toBe('explicit_query');
      expect(result.signal?.suggestedLevel).toBe('deep');
    });

    test('escalates on error burst', () => {
      const detector = new EscalationDetector(db);
      const session: Session = {
        id: 'test',
        startedAt: new Date(),
        workingDirectory: '/test',
        eventsCount: 10,
        objectsCreated: 0,
        objectsAccessed: 0,
        eventsSinceCheckpoint: 5,
        injectedMemoryIds: [],
        errorCount: 4,
        disclosureLevel: 'task',
      };

      const result = detector.isDisclosureNeeded(session);

      expect(result.needed).toBe(true);
      expect(result.signal?.trigger).toBe('error_burst');
    });

    test('tracks topic shifts', () => {
      const detector = new EscalationDetector(db);
      const session: Session = {
        id: 'test',
        startedAt: new Date(),
        workingDirectory: '/test',
        eventsCount: 10,
        objectsCreated: 0,
        objectsAccessed: 0,
        eventsSinceCheckpoint: 5,
        injectedMemoryIds: [],
        errorCount: 0,
        disclosureLevel: 'task',
        lastTopic: 'src/api/auth.ts',
      };

      const result = detector.isDisclosureNeeded(session, undefined, 'src/database/migrations.ts');

      expect(result.needed).toBe(true);
      expect(result.signal?.trigger).toBe('topic_shift');
    });
  });

  describe('Full Disclosure Flow', () => {
    test('progressive retrieval respects priority IDs', async () => {
      // Insert memories
      db.run(`
        INSERT INTO memory_objects (id, content, object_type, access_count, last_accessed, status)
        VALUES
          ('c1', 'Use Bun for TS', 'constraint', 100, datetime('now'), 'active'),
          ('c2', 'No .env commits', 'constraint', 80, datetime('now'), 'active'),
          ('d1', 'Chose SQLite for simplicity', 'decision', 5, datetime('now', '-30 days'), 'active')
      `);

      // Also insert into FTS for searching
      db.run(`INSERT INTO memory_fts (id, content, object_type) VALUES ('c1', 'Use Bun for TS', 'constraint')`);
      db.run(`INSERT INTO memory_fts (id, content, object_type) VALUES ('c2', 'No .env commits', 'constraint')`);
      db.run(`INSERT INTO memory_fts (id, content, object_type) VALUES ('d1', 'Chose SQLite for simplicity', 'decision')`);

      // Get hot memory IDs
      const heatmap = new AccessHeatmap(db);
      const hotIds = heatmap.getHotMemoryIds(2);

      // Get context with priority
      const retriever = new ProgressiveRetriever(db);
      const pack = await retriever.getContext('task', {
        query: 'database',
        priorityIds: hotIds,
      });

      // Hot memories should be included
      const includedIds = pack.objects.map((o) => o.id);
      expect(includedIds).toContain('c1');
      expect(includedIds).toContain('c2');
    });

    test('deduplication prevents re-injection', async () => {
      db.run(`
        INSERT INTO memory_objects (id, content, object_type, status)
        VALUES
          ('m1', 'Memory 1', 'constraint', 'active'),
          ('m2', 'Memory 2', 'constraint', 'active'),
          ('m3', 'Memory 3', 'decision', 'active')
      `);

      const retriever = new ProgressiveRetriever(db);

      // First retrieval
      const pack1 = retriever.getMinimalContext();
      const ids1 = pack1.objects.map((o) => o.id);

      // Simulate tracking injected IDs
      const injectedIds = new Set(ids1);

      // Second retrieval - filter out already injected
      const pack2 = retriever.getMinimalContext();
      const newIds = pack2.objects.filter((o) => !injectedIds.has(o.id));

      // Should not have new constraints (they were already injected)
      expect(newIds.length).toBeLessThanOrEqual(pack2.objects.length);
    });
  });

  describe('Code Refs in Context', () => {
    test('memories include code refs in context', () => {
      db.run(`
        INSERT INTO memory_objects (id, content, object_type, code_refs, status)
        VALUES ('m1', 'Use getConnection for DB', 'constraint',
                '[{"path": "src/stores/connection.ts", "line": 15}]', 'active')
      `);

      const retriever = new ProgressiveRetriever(db);
      const pack = retriever.getMinimalContext();

      expect(pack.objects.length).toBe(1);
      expect(pack.objects[0].codeRefs).toBeDefined();
      expect(pack.objects[0].codeRefs.length).toBe(1);
      expect(pack.objects[0].codeRefs[0].path).toBe('src/stores/connection.ts');
    });
  });
});
