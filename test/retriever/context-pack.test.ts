/**
 * Tests for context pack compiler
 */

import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ContextPackCompiler } from '../../src/retriever/context-pack.ts';
import { getMemoryConnection } from '../../src/stores/connection.ts';
import { MemoryObjectStore } from '../../src/stores/memory-objects.ts';
import { SessionStore } from '../../src/stores/sessions.ts';

describe('ContextPackCompiler', () => {
  let db: Database;
  let store: MemoryObjectStore;
  let _sessions: SessionStore;
  let compiler: ContextPackCompiler;

  beforeEach(() => {
    db = getMemoryConnection();
    store = new MemoryObjectStore(db);
    _sessions = new SessionStore(db);
    compiler = new ContextPackCompiler(db);
  });

  afterEach(() => {
    db.close();
  });

  test('compile empty pack', async () => {
    const pack = await compiler.compile({ tokenBudget: 1000 });

    expect(pack.tokenCount).toBe(0);
    expect(pack.tokenBudget).toBe(1000);
    expect(pack.constraints.length).toBe(0);
    expect(pack.relevantObjects.length).toBe(0);
  });

  test('compile with constraints', async () => {
    store.create({
      content: 'Never use any in TypeScript',
      objectType: 'constraint',
    });
    store.approve(store.list()[0].id);

    store.create({
      content: 'Always run tests before commit',
      objectType: 'constraint',
    });
    store.approve(store.list()[1].id);

    const pack = await compiler.compile({ tokenBudget: 1000 });

    expect(pack.constraints.length).toBe(2);
    expect(pack.tokenCount).toBeGreaterThan(0);
  });

  test('compile respects token budget', async () => {
    // Create many objects
    for (let i = 0; i < 20; i++) {
      const obj = store.create({
        content: `Memory object number ${i} with some content that takes up tokens`,
        objectType: 'decision',
      });
      store.approve(obj.id);
    }

    const pack = await compiler.compile({ tokenBudget: 200 });

    expect(pack.tokenCount).toBeLessThanOrEqual(200);
    expect(pack.overflowCount).toBeGreaterThan(0);
  });

  test('compile minimal pack', () => {
    store.create({
      content: 'A constraint',
      objectType: 'constraint',
    });
    store.approve(store.list()[0].id);

    store.create({
      content: 'A decision',
      objectType: 'decision',
    });
    store.approve(store.list()[1].id);

    const pack = compiler.compileMinimal();

    expect(pack.constraints.length).toBe(1);
    expect(pack.relevantObjects.length).toBe(0);
  });

  test('compile with task description includes approved objects', async () => {
    const fix = store.create({
      content: 'Fixed sharp by using vips instead',
      objectType: 'known_fix',
    });
    store.approve(fix.id);

    const unrelated = store.create({
      content: 'Database connection settings',
      objectType: 'environment',
    });
    store.approve(unrelated.id);

    // Without task description, should still include approved objects
    const pack = await compiler.compile({
      tokenBudget: 1000,
    });

    // Should include both approved objects
    expect(pack.relevantObjects.length).toBe(2);
  });

  test('pack records access counts', async () => {
    const obj = store.create({
      content: 'Test access tracking',
      objectType: 'decision',
    });
    store.approve(obj.id);

    expect(store.get(obj.id)!.accessCount).toBe(0);

    await compiler.compile({ tokenBudget: 1000 });

    // Access count should be incremented
    expect(store.get(obj.id)!.accessCount).toBeGreaterThan(0);
  });
});
