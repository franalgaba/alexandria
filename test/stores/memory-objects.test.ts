/**
 * Tests for memory object store
 */

import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getMemoryConnection } from '../../src/stores/connection.ts';
import { MemoryObjectStore } from '../../src/stores/memory-objects.ts';

describe('MemoryObjectStore', () => {
  let db: Database;
  let store: MemoryObjectStore;

  beforeEach(() => {
    db = getMemoryConnection();
    store = new MemoryObjectStore(db);
  });

  afterEach(() => {
    db.close();
  });

  test('create and get memory object', () => {
    const obj = store.create({
      content: 'Use Bun instead of Node.js',
      objectType: 'decision',
      confidence: 'high',
    });

    expect(obj.id).toBeDefined();
    expect(obj.content).toBe('Use Bun instead of Node.js');
    expect(obj.objectType).toBe('decision');
    expect(obj.confidence).toBe('high');
    expect(obj.status).toBe('active');
    expect(obj.reviewStatus).toBe('pending');

    const retrieved = store.get(obj.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.content).toBe(obj.content);
  });

  test('update memory object', () => {
    const obj = store.create({
      content: 'Initial content',
      objectType: 'preference',
    });

    const updated = store.update(obj.id, {
      content: 'Updated content',
      confidence: 'certain',
    });

    expect(updated).not.toBeNull();
    expect(updated!.content).toBe('Updated content');
    expect(updated!.confidence).toBe('certain');
    // Updated timestamp should be >= original (may be equal if update is very fast)
    expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(obj.updatedAt.getTime());
  });

  test('supersede object', () => {
    const old = store.create({
      content: 'Old approach',
      objectType: 'decision',
    });

    const newObj = store.create({
      content: 'New approach',
      objectType: 'decision',
    });

    const result = store.supersede(old.id, newObj.id);
    expect(result).toBe(true);

    const superseded = store.get(old.id);
    expect(superseded!.status).toBe('superseded');
    expect(superseded!.supersededBy).toBe(newObj.id);
  });

  test('list by status', () => {
    store.create({ content: 'Active 1', objectType: 'decision' });
    store.create({ content: 'Active 2', objectType: 'preference' });

    const obj = store.create({ content: 'To retire', objectType: 'convention' });
    store.retire(obj.id);

    const active = store.list({ status: ['active'] });
    expect(active.length).toBe(2);

    const retired = store.list({ status: ['retired'] });
    expect(retired.length).toBe(1);
    expect(retired[0].content).toBe('To retire');
  });

  test('list by type', () => {
    store.create({ content: 'Decision 1', objectType: 'decision' });
    store.create({ content: 'Decision 2', objectType: 'decision' });
    store.create({ content: 'Preference 1', objectType: 'preference' });

    const decisions = store.list({ objectType: 'decision' });
    expect(decisions.length).toBe(2);

    const preferences = store.list({ objectType: 'preference' });
    expect(preferences.length).toBe(1);
  });

  test('approve and reject', () => {
    const obj = store.create({
      content: 'Pending review',
      objectType: 'decision',
    });

    expect(obj.reviewStatus).toBe('pending');

    store.approve(obj.id);
    const approved = store.get(obj.id);
    expect(approved!.reviewStatus).toBe('approved');
    expect(approved!.reviewedAt).toBeDefined();

    const obj2 = store.create({
      content: 'Will be rejected',
      objectType: 'decision',
    });

    store.reject(obj2.id);
    const rejected = store.get(obj2.id);
    expect(rejected!.reviewStatus).toBe('rejected');
    expect(rejected!.status).toBe('retired');
  });

  test('get active constraints', () => {
    store.create({ content: 'Not a constraint', objectType: 'decision' });
    store.create({ content: 'Never use any', objectType: 'constraint' });
    store.create({ content: 'Must always test', objectType: 'constraint' });

    const constraints = store.getActiveConstraints();
    expect(constraints.length).toBe(2);
    expect(constraints.every((c) => c.objectType === 'constraint')).toBe(true);
  });

  test('record access', () => {
    const obj = store.create({
      content: 'Track access',
      objectType: 'decision',
    });

    expect(obj.accessCount).toBe(0);
    expect(obj.lastAccessed).toBeUndefined();

    store.recordAccess(obj.id);
    store.recordAccess(obj.id);
    store.recordAccess(obj.id);

    const updated = store.get(obj.id);
    expect(updated!.accessCount).toBe(3);
    expect(updated!.lastAccessed).toBeDefined();
  });

  test('count by status', () => {
    store.create({ content: 'A1', objectType: 'decision' });
    store.create({ content: 'A2', objectType: 'decision' });

    const obj = store.create({ content: 'S1', objectType: 'decision' });
    store.markStale(obj.id);

    const counts = store.countByStatus();
    expect(counts.active).toBe(2);
    expect(counts.stale).toBe(1);
    expect(counts.superseded).toBe(0);
    expect(counts.retired).toBe(0);
  });
});
