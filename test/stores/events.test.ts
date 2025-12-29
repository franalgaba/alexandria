/**
 * Tests for event store
 */

import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getMemoryConnection } from '../../src/stores/connection.ts';
import { EventStore } from '../../src/stores/events.ts';
import { SessionStore } from '../../src/stores/sessions.ts';

describe('EventStore', () => {
  let db: Database;
  let store: EventStore;
  let sessions: SessionStore;
  let sessionId: string;

  beforeEach(() => {
    db = getMemoryConnection();
    store = new EventStore(db);
    sessions = new SessionStore(db);

    // Create a session for events
    const session = sessions.start({ workingDirectory: '/test' });
    sessionId = session.id;
  });

  afterEach(() => {
    db.close();
  });

  test('append and get event', () => {
    const event = store.append({
      sessionId,
      timestamp: new Date(),
      eventType: 'turn',
      content: 'Hello, world!',
    });

    expect(event.id).toBeDefined();
    expect(event.sessionId).toBe(sessionId);
    expect(event.eventType).toBe('turn');
    expect(event.content).toBe('Hello, world!');
    expect(event.tokenCount).toBeGreaterThan(0);

    const retrieved = store.get(event.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.content).toBe('Hello, world!');
  });

  test('append tool output event', () => {
    const event = store.append({
      sessionId,
      timestamp: new Date(),
      eventType: 'tool_output',
      content: 'Build successful',
      toolName: 'build',
      exitCode: 0,
    });

    expect(event.eventType).toBe('tool_output');
    expect(event.toolName).toBe('build');
    expect(event.exitCode).toBe(0);
  });

  test('get events by session', () => {
    store.append({
      sessionId,
      timestamp: new Date(),
      eventType: 'turn',
      content: 'Event 1',
    });

    store.append({
      sessionId,
      timestamp: new Date(),
      eventType: 'turn',
      content: 'Event 2',
    });

    // Create another session
    const otherSession = sessions.start({});
    store.append({
      sessionId: otherSession.id,
      timestamp: new Date(),
      eventType: 'turn',
      content: 'Other session event',
    });

    const events = store.getBySession(sessionId);
    expect(events.length).toBe(2);
  });

  test('get events by type', () => {
    store.append({
      sessionId,
      timestamp: new Date(),
      eventType: 'turn',
      content: 'A turn',
    });

    store.append({
      sessionId,
      timestamp: new Date(),
      eventType: 'error',
      content: 'An error',
    });

    store.append({
      sessionId,
      timestamp: new Date(),
      eventType: 'error',
      content: 'Another error',
    });

    const errors = store.getByType('error');
    expect(errors.length).toBe(2);

    const turns = store.getByType('turn');
    expect(turns.length).toBe(1);
  });

  test('count by session', () => {
    store.append({ sessionId, timestamp: new Date(), eventType: 'turn', content: 'E1' });
    store.append({ sessionId, timestamp: new Date(), eventType: 'turn', content: 'E2' });
    store.append({ sessionId, timestamp: new Date(), eventType: 'turn', content: 'E3' });

    const count = store.countBySession(sessionId);
    expect(count).toBe(3);
  });

  test('hash content for deduplication', () => {
    const event1 = store.append({
      sessionId,
      timestamp: new Date(),
      eventType: 'turn',
      content: 'Identical content',
    });

    const event2 = store.append({
      sessionId,
      timestamp: new Date(),
      eventType: 'turn',
      content: 'Identical content',
    });

    expect(event1.contentHash).toBeDefined();
    expect(event2.contentHash).toBeDefined();
    expect(event1.contentHash).toBe(event2.contentHash);
  });

  test('exists by hash', () => {
    const event = store.append({
      sessionId,
      timestamp: new Date(),
      eventType: 'turn',
      content: 'Unique content here',
    });

    expect(store.existsByHash(event.contentHash!)).toBe(true);
    expect(store.existsByHash('nonexistent')).toBe(false);
  });
});
