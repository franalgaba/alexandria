/**
 * Tests for Cost Tracker
 */

import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getMemoryConnection } from '../../src/stores/connection.ts';
import { CostTracker } from '../../src/utils/cost-tracker.ts';

describe('CostTracker', () => {
  let db: Database;
  let tracker: CostTracker;

  beforeEach(() => {
    db = getMemoryConnection();
    tracker = new CostTracker(db);
  });

  afterEach(() => {
    db.close();
  });

  test('records usage', () => {
    tracker.startSession('session-1');
    const result = tracker.record('extraction', 'gpt-4', 1000, 500);

    expect(result.cost).toBeGreaterThan(0);
    expect(result.budgetExceeded).toBeUndefined();
  });

  test('tracks session totals', () => {
    tracker.startSession('session-1');
    tracker.record('extraction', 'gpt-4', 1000, 500);
    tracker.record('extraction', 'gpt-4', 500, 250);

    const summary = tracker.getSessionSummary();
    expect(summary.totalInputTokens).toBe(1500);
    expect(summary.totalOutputTokens).toBe(750);
  });

  test('warns when approaching budget', () => {
    tracker.startSession('session-1');

    // Record large usage to trigger warning
    const result = tracker.record('extraction', 'gpt-4', 10000, 5000);

    // Should trigger budget warning at this cost
    expect(result.budgetWarning).toBeDefined();
  });

  test('checks budget enforcement', () => {
    tracker.startSession('session-1');

    // Initial check should pass
    expect(tracker.canProceed().allowed).toBe(true);

    // Record to approach limit
    tracker.record('extraction', 'gpt-4', 40000, 10000);

    // Should now fail
    const check = tracker.canProceed(10000);
    expect(check.allowed).toBe(false);
  });

  test('groups by operation', () => {
    tracker.startSession('session-1');
    tracker.record('extraction', 'gpt-4', 1000, 500);
    tracker.record('extraction', 'gpt-4', 500, 250);
    tracker.record('conflict-check', 'gpt-4', 200, 100);

    const summary = tracker.getSessionSummary();
    expect(summary.byOperation['extraction'].tokens).toBe(2250);
    expect(summary.byOperation['conflict-check'].tokens).toBe(300);
  });

  test('groups by model', () => {
    tracker.startSession('session-1');
    tracker.record('extraction', 'gpt-4', 1000, 500);
    tracker.record('extraction', 'claude-3-haiku', 500, 250);

    const summary = tracker.getSessionSummary();
    expect(summary.byModel['gpt-4'].tokens).toBe(1500);
    expect(summary.byModel['claude-3-haiku'].tokens).toBe(750);
  });

  test('formats cost correctly', () => {
    // Small amounts show as cents
    expect(CostTracker.formatCost(0.005)).toContain('¢');
    // Larger amounts show as dollars
    expect(CostTracker.formatCost(1.5)).toBe('$1.5000');
  });

  test('gets budget status', () => {
    tracker.startSession('session-1');
    tracker.record('extraction', 'gpt-4', 1000, 500);

    const status = tracker.getBudgetStatus();
    expect(status.session.used).toBeGreaterThan(0);
    expect(status.session.limit).toBe(0.5);
    expect(status.tokens.used).toBe(1500);
  });
});
