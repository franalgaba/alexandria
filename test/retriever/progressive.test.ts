import type { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  getLevelConfig,
  ProgressiveRetriever,
  recommendLevel,
} from '../../src/retriever/progressive.ts';
import { getMemoryConnection } from '../../src/stores/connection.ts';
import { MemoryObjectStore } from '../../src/stores/memory-objects.ts';

describe('ProgressiveRetriever', () => {
  let db: Database;
  let retriever: ProgressiveRetriever;
  let store: MemoryObjectStore;

  beforeAll(() => {
    db = getMemoryConnection();
    retriever = new ProgressiveRetriever(db);
    store = new MemoryObjectStore(db);

    // Add test memories
    store.create({
      content: 'Always run tests before committing',
      objectType: 'constraint',
      scope: { type: 'project' },
      reviewStatus: 'approved',
    });

    store.create({
      content: 'Use TypeScript for all new files',
      objectType: 'convention',
      scope: { type: 'project' },
      reviewStatus: 'approved',
    });

    store.create({
      content: 'Database decision: use SQLite',
      objectType: 'decision',
      scope: { type: 'project' },
      reviewStatus: 'approved',
    });

    store.create({
      content: 'API endpoint failed with 500 error',
      objectType: 'failed_attempt',
      scope: { type: 'project' },
      reviewStatus: 'approved',
    });
  });

  afterAll(() => {
    db.close();
  });

  describe('getMinimalContext', () => {
    test('returns only constraints', () => {
      const pack = retriever.getMinimalContext();

      expect(pack.objects.length).toBeGreaterThanOrEqual(1);
      // All objects should be constraints or warnings
      for (const obj of pack.objects) {
        expect(['constraint'].includes(obj.objectType) || obj.status === 'stale').toBe(true);
      }
    });

    test('respects token budget', () => {
      const pack = retriever.getMinimalContext();
      expect(pack.metadata?.tokensUsed).toBeLessThanOrEqual(200);
    });
  });

  describe('getTaskContext', () => {
    test('includes query-relevant memories', async () => {
      const pack = await retriever.getTaskContext('database');

      expect(pack.objects.length).toBeGreaterThanOrEqual(1);
      // Should include the database decision
      const hasDatabase = pack.objects.some((o) => o.content.includes('SQLite'));
      expect(hasDatabase).toBe(true);
    });

    test('includes constraints', async () => {
      const pack = await retriever.getTaskContext('anything');

      const hasConstraint = pack.objects.some((o) => o.objectType === 'constraint');
      expect(hasConstraint).toBe(true);
    });
  });

  describe('getDeepContext', () => {
    test('has larger token budget', async () => {
      const pack = await retriever.getDeepContext('database');

      expect(pack.metadata?.tokenBudget).toBe(4000);
    });

    test('includes more memories than task level', async () => {
      const taskPack = await retriever.getTaskContext('test');
      const deepPack = await retriever.getDeepContext('test');

      // Deep should have at least as many as task
      expect(deepPack.objects.length).toBeGreaterThanOrEqual(taskPack.objects.length);
    });
  });

  describe('getContext', () => {
    test('accepts custom token budget', async () => {
      const pack = await retriever.getContext('task', {
        query: 'test',
        tokenBudget: 100,
      });

      expect(pack.metadata?.tokenBudget).toBe(100);
    });
  });
});

describe('Level Utilities', () => {
  test('recommendLevel returns deep for complex queries', () => {
    expect(recommendLevel('what is the architecture of this system')).toBe('deep');
    expect(recommendLevel('tell me everything about the database')).toBe('deep');
  });

  test('recommendLevel returns minimal for simple queries', () => {
    expect(recommendLevel('status')).toBe('minimal');
    expect(recommendLevel('is this still valid')).toBe('minimal');
  });

  test('recommendLevel returns task for typical queries', () => {
    expect(recommendLevel('how do I add a new endpoint')).toBe('task');
    expect(recommendLevel('where is the config file')).toBe('task');
  });

  test('getLevelConfig returns correct budgets', () => {
    expect(getLevelConfig('minimal').tokenBudget).toBe(500);
    expect(getLevelConfig('task').tokenBudget).toBe(2000);
    expect(getLevelConfig('deep').tokenBudget).toBe(4000);
  });
});
