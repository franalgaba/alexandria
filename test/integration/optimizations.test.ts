/**
 * Integration tests for optimization paths.
 */

import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Checkpoint } from '../../src/ingestor/checkpoint.ts';
import { VectorIndex } from '../../src/indexes/vector.ts';
import { HybridSearch } from '../../src/retriever/hybrid-search.ts';
import { RetrievalRouter } from '../../src/retriever/router.ts';
import { StalenessChecker } from '../../src/reviewer/staleness.ts';
import { closeConnection, getConnection, getMemoryConnection } from '../../src/stores/connection.ts';
import { MemoryObjectStore } from '../../src/stores/memory-objects.ts';
import { symbolRef } from '../../src/types/code-refs.ts';
import type { Event } from '../../src/types/events.ts';
import { handler as exportHandler } from '../../src/cli/commands/export.ts';

function disableVectorSearch(search: HybridSearch): void {
  const unsafe = search as unknown as {
    vector: { searchSimilarObjects: (query: string, limit: number) => Promise<unknown[]> };
  };
  unsafe.vector.searchSimilarObjects = async () => [];
}

describe('Hybrid search optimizations', () => {
  let db: Database;
  let store: MemoryObjectStore;

  beforeEach(() => {
    db = getMemoryConnection();
    store = new MemoryObjectStore(db);
  });

  afterEach(() => {
    db.close();
  });

  test('recency multiplier lifts recently verified memories', async () => {
    const recent = store.create({
      content: 'Use PostgreSQL for telemetry storage.',
      objectType: 'constraint',
    });
    const older = store.create({
      content: 'Use PostgreSQL for telemetry storage.',
      objectType: 'constraint',
    });

    const now = new Date();
    const olderDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    store.update(recent.id, { lastVerifiedAt: now });
    store.update(older.id, { lastVerifiedAt: olderDate });

    const search = new HybridSearch(db);
    disableVectorSearch(search);

    const results = await search.search('PostgreSQL telemetry', {
      limit: 2,
      skipReinforcement: true,
    });

    expect(results.length).toBe(2);
    expect(results[0].object.id).toBe(recent.id);
  });

  test('scope boost prefers matching file scope', async () => {
    const matching = store.create({
      content: 'Auth flow uses PKCE for code exchange.',
      objectType: 'decision',
      scope: { type: 'file', path: 'src/auth/flow.ts' },
    });
    store.create({
      content: 'Auth flow uses PKCE for code exchange.',
      objectType: 'decision',
      scope: { type: 'file', path: 'src/other/flow.ts' },
    });

    const search = new HybridSearch(db);
    disableVectorSearch(search);

    const router = new RetrievalRouter();
    const plan = router.getPlanForIntent('implementation');

    const results = await search.searchWithPlan('What happens in src/auth/flow.ts?', plan);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].object.id).toBe(matching.id);
  });
});

describe('Staleness symbol checks', () => {
  let db: Database;
  let store: MemoryObjectStore;
  const projectRoot = join(import.meta.dir, '../..');

  beforeEach(() => {
    db = getMemoryConnection();
    store = new MemoryObjectStore(db);
  });

  afterEach(() => {
    db.close();
  });

  test('flags missing symbol references as stale', () => {
    const memory = store.create({
      content: 'Missing symbol ref should be stale.',
      objectType: 'constraint',
      codeRefs: [symbolRef('src/retriever/hybrid-search.ts', 'DefinitelyMissingSymbol')],
    });

    const checker = new StalenessChecker(db);
    const result = checker.check(memory, projectRoot);

    expect(result.level).toBe('stale');
    expect(result.missingRefs.length).toBe(1);
  });

  test('keeps existing symbol references verified', () => {
    const memory = store.create({
      content: 'HybridSearch symbol should exist.',
      objectType: 'decision',
      codeRefs: [symbolRef('src/retriever/hybrid-search.ts', 'HybridSearch')],
    });

    const checker = new StalenessChecker(db);
    const result = checker.check(memory, projectRoot);

    expect(result.level).toBe('verified');
    expect(result.isStale).toBe(false);
  });
});

describe('Import review status gating', () => {
  const testDir = join(import.meta.dir, '.test-import');
  const dbPath = join(testDir, 'alexandria.db');
  let previousDbPath: string | undefined;

  beforeEach(() => {
    previousDbPath = process.env.ALEXANDRIA_DB_PATH;
    process.env.ALEXANDRIA_DB_PATH = dbPath;
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (previousDbPath === undefined) {
      delete process.env.ALEXANDRIA_DB_PATH;
    } else {
      process.env.ALEXANDRIA_DB_PATH = previousDbPath;
    }
    closeConnection();
    rmSync(testDir, { recursive: true, force: true });
  });

  test('requires evidence or code refs for auto-approval', async () => {
    const originalIndexObject = VectorIndex.prototype.indexObject;
    VectorIndex.prototype.indexObject = async () => {};

    try {
      const importFile = join(testDir, 'import.json');
      const payload = {
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        objects: [
          {
            content: 'High confidence without evidence.',
            objectType: 'constraint',
            confidence: 'high',
            evidenceEventIds: [],
            codeRefs: [],
          },
          {
            content: 'High confidence with evidence.',
            objectType: 'constraint',
            confidence: 'high',
            evidenceEventIds: ['evt_1'],
            codeRefs: [],
          },
        ],
      };

      writeFileSync(importFile, JSON.stringify(payload), 'utf8');

      await exportHandler({
        action: 'import',
        file: importFile,
        status: ['active', 'stale'],
      } as Parameters<typeof exportHandler>[0]);

      const db = getConnection(dbPath);
      const store = new MemoryObjectStore(db);
      const objects = store.list({ status: ['active'] });

      const noEvidence = objects.find((obj) => obj.content === 'High confidence without evidence.');
      const withEvidence = objects.find((obj) => obj.content === 'High confidence with evidence.');

      expect(noEvidence?.reviewStatus).toBe('pending');
      expect(withEvidence?.reviewStatus).toBe('approved');
    } finally {
      VectorIndex.prototype.indexObject = originalIndexObject;
    }
  });
});

describe('Tier2 conflict detection', () => {
  let db: Database;
  let store: MemoryObjectStore;

  beforeEach(() => {
    db = getMemoryConnection();
    store = new MemoryObjectStore(db);
  });

  afterEach(() => {
    db.close();
  });

  test('queues contradictions for human review', async () => {
    store.create({
      content: 'Always use tabs in this codebase.',
      objectType: 'constraint',
    });

    const checkpoint = new Checkpoint(db, {
      curatorMode: 'tier2',
      minEventsForCheckpoint: 1,
      toolBurstCount: 100,
      toolBurstWindowMs: 60000,
    });

    const event = createEvent(
      'session_conflict',
      'turn',
      'No, never use tabs in this codebase.',
    );
    await checkpoint.addEvent(event);

    const result = await checkpoint.executeManual('Conflict test');

    expect(result.conflictsDetected).toBeGreaterThan(0);
    expect(result.conflictsPending).toBeGreaterThan(0);
    expect(result.memoriesCreated).toBe(0);
    expect(store.list({ status: ['active'] }).length).toBe(1);
  });
});

let eventCounter = 0;
function createEvent(sessionId: string, eventType: Event['eventType'], content: string): Event {
  eventCounter += 1;
  return {
    id: `evt_${eventCounter}`,
    sessionId,
    eventType,
    content,
    contentHash: `hash_${eventCounter}`,
    timestamp: new Date(),
  };
}
