import type { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';
import { getMemoryConnection } from '../../src/stores/connection.ts';
import { MemoryObjectStore } from '../../src/stores/memory-objects.ts';
import { OutcomeStore } from '../../src/stores/outcomes.ts';

describe('OutcomeStore', () => {
  let db: Database;
  let memoryStore: MemoryObjectStore;
  let outcomeStore: OutcomeStore;
  let testMemoryId: string;

  beforeEach(() => {
    db = getMemoryConnection();
    memoryStore = new MemoryObjectStore(db);
    outcomeStore = new OutcomeStore(db);

    // Create a test memory
    const memory = memoryStore.create({
      content: 'Test memory for outcomes',
      objectType: 'decision',
    });
    testMemoryId = memory.id;
  });

  test('records helpful outcome', () => {
    const outcome = outcomeStore.record(testMemoryId, 'test-session', 'helpful');

    expect(outcome.memoryId).toBe(testMemoryId);
    expect(outcome.sessionId).toBe('test-session');
    expect(outcome.outcome).toBe('helpful');
    expect(outcome.timestamp).toBeInstanceOf(Date);
  });

  test('records unhelpful outcome with context', () => {
    const outcome = outcomeStore.record(
      testMemoryId,
      'test-session',
      'unhelpful',
      'Memory was outdated',
    );

    expect(outcome.outcome).toBe('unhelpful');
    expect(outcome.context).toBe('Memory was outdated');
  });

  test('getForMemory returns all outcomes', () => {
    outcomeStore.record(testMemoryId, 'session-1', 'helpful');
    outcomeStore.record(testMemoryId, 'session-2', 'neutral');
    outcomeStore.record(testMemoryId, 'session-3', 'unhelpful');

    const outcomes = outcomeStore.getForMemory(testMemoryId);
    expect(outcomes).toHaveLength(3);
  });

  test('getForSession returns session outcomes', () => {
    const memory2 = memoryStore.create({
      content: 'Another memory',
      objectType: 'convention',
    });

    outcomeStore.record(testMemoryId, 'my-session', 'helpful');
    outcomeStore.record(memory2.id, 'my-session', 'neutral');
    outcomeStore.record(testMemoryId, 'other-session', 'unhelpful');

    const outcomes = outcomeStore.getForSession('my-session');
    expect(outcomes).toHaveLength(2);
    expect(outcomes.every((o) => o.sessionId === 'my-session')).toBe(true);
  });

  test('getStats returns correct counts', () => {
    outcomeStore.record(testMemoryId, 'session-1', 'helpful');
    outcomeStore.record(testMemoryId, 'session-2', 'helpful');
    outcomeStore.record(testMemoryId, 'session-3', 'neutral');
    outcomeStore.record(testMemoryId, 'session-4', 'unhelpful');

    const stats = outcomeStore.getStats(testMemoryId);
    expect(stats.helpful).toBe(2);
    expect(stats.neutral).toBe(1);
    expect(stats.unhelpful).toBe(1);
  });

  test('updates memory outcome score on record', () => {
    outcomeStore.record(testMemoryId, 'session-1', 'helpful');
    outcomeStore.record(testMemoryId, 'session-2', 'helpful');

    const memory = memoryStore.get(testMemoryId);
    expect(memory?.outcomeScore).toBe(1.0); // All helpful
  });

  test('calculates correct outcome score with mixed outcomes', () => {
    outcomeStore.record(testMemoryId, 'session-1', 'helpful'); // 1.0
    outcomeStore.record(testMemoryId, 'session-2', 'neutral'); // 0.5
    outcomeStore.record(testMemoryId, 'session-3', 'unhelpful'); // 0.0

    // Average: (1.0 + 0.5 + 0.0) / 3 = 0.5
    const memory = memoryStore.get(testMemoryId);
    expect(memory?.outcomeScore).toBeCloseTo(0.5, 2);
  });

  test('deleteForMemory removes all outcomes', () => {
    outcomeStore.record(testMemoryId, 'session-1', 'helpful');
    outcomeStore.record(testMemoryId, 'session-2', 'neutral');

    const deleted = outcomeStore.deleteForMemory(testMemoryId);
    expect(deleted).toBe(2);

    const outcomes = outcomeStore.getForMemory(testMemoryId);
    expect(outcomes).toHaveLength(0);
  });
});
