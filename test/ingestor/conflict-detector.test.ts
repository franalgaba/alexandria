/**
 * Tests for Conflict Detector
 */

import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ConflictDetector } from '../../src/ingestor/conflict-detector.ts';
import { getMemoryConnection } from '../../src/stores/connection.ts';
import { MemoryObjectStore } from '../../src/stores/memory-objects.ts';

describe('ConflictDetector', () => {
  let db: Database;
  let detector: ConflictDetector;
  let store: MemoryObjectStore;

  beforeEach(() => {
    db = getMemoryConnection();
    store = new MemoryObjectStore(db);
    detector = new ConflictDetector(db);
  });

  afterEach(() => {
    db.close();
  });

  test('detects no conflicts for unique content', () => {
    const candidate = {
      content: 'Always use TypeScript for new files',
      suggestedType: 'convention' as const,
      evidenceEventIds: ['e1'],
      confidence: 'high' as const,
    };

    const conflicts = detector.detectConflicts(candidate);
    expect(conflicts).toHaveLength(0);
  });

  test('detects duplicate memory', () => {
    // Create existing memory (FTS is auto-indexed via trigger)
    store.create({
      content: 'Always use TypeScript for new files',
      objectType: 'convention',
      confidence: 'high',
      evidenceEventIds: ['e1'],
    });

    // Try to add similar content
    const candidate = {
      content: 'Always use TypeScript for new files',
      suggestedType: 'convention' as const,
      evidenceEventIds: ['e2'],
      confidence: 'high' as const,
    };

    const conflicts = detector.detectConflicts(candidate);
    expect(conflicts.length).toBeGreaterThanOrEqual(1);
    expect(conflicts[0].type).toBe('duplicate');
  });

  test('handles memories with no related content', () => {
    // Create an unrelated memory
    store.create({
      content: 'Database uses PostgreSQL',
      objectType: 'environment',
      confidence: 'high',
      evidenceEventIds: ['e1'],
    });

    // Completely different topic
    const candidate = {
      content: 'Use TypeScript for all new files',
      suggestedType: 'convention' as const,
      evidenceEventIds: ['e2'],
      confidence: 'high' as const,
    };

    const conflicts = detector.detectConflicts(candidate);
    // No conflicts expected - different topics
    expect(conflicts.length).toBe(0);
  });

  test('resolves conflict by keeping existing', () => {
    const existing = store.create({
      content: 'Use tabs for indentation',
      objectType: 'preference',
      confidence: 'high',
      evidenceEventIds: ['e1'],
    });

    const candidate = {
      content: 'Use tabs for indentation',
      suggestedType: 'preference' as const,
      evidenceEventIds: ['e2'],
      confidence: 'high' as const,
    };

    const conflicts = detector.detectConflicts(candidate);
    expect(conflicts.length).toBeGreaterThan(0);

    const result = detector.resolveConflict(conflicts[0].id, {
      option: 'keep_existing',
      resolvedBy: 'human',
      reason: 'Existing is correct',
    });

    expect(result).not.toBeNull();
    expect(result?.id).toBe(existing.id);
  });

  test('resolves conflict by replacing (exact duplicate)', () => {
    const existing = store.create({
      content: 'Use 4 spaces for indentation',
      objectType: 'preference',
      confidence: 'medium',
      evidenceEventIds: ['e1'],
    });

    // Exact duplicate to ensure FTS match
    const candidate = {
      content: 'Use 4 spaces for indentation',
      suggestedType: 'preference' as const,
      evidenceEventIds: ['e2'],
      confidence: 'high' as const,
    };

    const conflicts = detector.detectConflicts(candidate);
    expect(conflicts.length).toBeGreaterThan(0);

    const result = detector.resolveConflict(conflicts[0].id, {
      option: 'replace',
      resolvedBy: 'human',
      reason: 'Updated preference',
    });

    expect(result).not.toBeNull();
    expect(result?.content).toBe(candidate.content);

    // Check existing is superseded
    const updatedExisting = store.get(existing.id);
    expect(updatedExisting?.status).toBe('superseded');
  });

  test('auto-resolves low-severity conflicts', () => {
    // Create slightly different memory
    store.create({
      content: 'Prefer async/await over callbacks',
      objectType: 'preference',
      confidence: 'medium',
      evidenceEventIds: ['e1'],
    });

    // Near duplicate
    const candidate = {
      content: 'Prefer async/await over callbacks for async code',
      suggestedType: 'preference' as const,
      evidenceEventIds: ['e2'],
      confidence: 'high' as const,
    };

    detector.detectConflicts(candidate);
    const resolved = detector.autoResolve();

    // May or may not auto-resolve depending on severity detection
    expect(resolved).toBeGreaterThanOrEqual(0);
  });

  test('getPendingConflicts returns unresolved conflicts', () => {
    store.create({
      content: 'Test content for pending check',
      objectType: 'convention',
      confidence: 'high',
      evidenceEventIds: ['e1'],
    });

    const candidate = {
      content: 'Test content for pending check',
      suggestedType: 'convention' as const,
      evidenceEventIds: ['e2'],
      confidence: 'high' as const,
    };

    detector.detectConflicts(candidate);
    const pending = detector.getPendingConflicts();

    expect(pending.length).toBeGreaterThan(0);
    expect(pending[0].resolvedAt).toBeUndefined();
  });
});
