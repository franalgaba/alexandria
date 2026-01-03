import { describe, expect, test } from 'bun:test';
import type { MemoryObject } from '../../src/types/memory-objects.ts';
import { ContradictionDetector, formatConflict } from '../../src/utils/conflicts.ts';

function createMemory(
  overrides: Partial<Omit<MemoryObject, 'createdAt' | 'updatedAt'>> & {
    createdAt?: Date | string;
    updatedAt?: Date | string;
  } = {},
): MemoryObject {
  const createdAt =
    overrides.createdAt instanceof Date
      ? overrides.createdAt
      : overrides.createdAt
        ? new Date(overrides.createdAt)
        : new Date();
  const updatedAt =
    overrides.updatedAt instanceof Date
      ? overrides.updatedAt
      : overrides.updatedAt
        ? new Date(overrides.updatedAt)
        : new Date();
  const { createdAt: _ca, updatedAt: _ua, ...rest } = overrides;
  return {
    id: `test_${Math.random().toString(36).slice(2)}`,
    content: 'Test content',
    objectType: 'decision',
    scope: { type: 'project' },
    status: 'active',
    confidence: 'medium',
    confidenceTier: 'observed',
    evidenceEventIds: [],
    reviewStatus: 'approved',
    accessCount: 0,
    codeRefs: [],
    ...rest,
    createdAt,
    updatedAt,
  };
}

describe('ContradictionDetector', () => {
  const detector = new ContradictionDetector();

  describe('direct contradictions', () => {
    test('detects negation conflicts', () => {
      const memories = [
        createMemory({ content: 'Use tabs for indentation' }),
        createMemory({ content: 'Never use tabs for indentation' }),
      ];

      const conflicts = detector.findConflicts(memories);

      expect(conflicts.length).toBe(1);
      expect(conflicts[0].type).toBe('direct');
    });

    test('detects antonym conflicts', () => {
      const memories = [
        createMemory({ content: 'Always use async functions' }),
        createMemory({ content: 'Never use async functions' }),
      ];

      const conflicts = detector.findConflicts(memories);

      expect(conflicts.length).toBe(1);
      expect(conflicts[0].type).toBe('direct');
    });

    test('ignores unrelated memories', () => {
      const memories = [
        createMemory({ content: 'Use TypeScript for frontend' }),
        createMemory({ content: 'Never use PHP' }),
      ];

      const conflicts = detector.findConflicts(memories);

      expect(conflicts.length).toBe(0);
    });
  });

  describe('implicit contradictions', () => {
    test('detects exclusive technology choices', () => {
      const memories = [
        createMemory({ content: 'Use React for the frontend' }),
        createMemory({ content: 'Use Vue for the frontend' }),
      ];

      const conflicts = detector.findConflicts(memories);

      expect(conflicts.length).toBe(1);
      expect(conflicts[0].type).toBe('implicit');
    });

    test('detects database choice conflicts', () => {
      const memories = [
        createMemory({ content: 'Decision: use PostgreSQL for the database' }),
        createMemory({ content: 'Decision: use MongoDB for storage' }),
      ];

      const conflicts = detector.findConflicts(memories);

      expect(conflicts.length).toBe(1);
      expect(conflicts[0].type).toBe('implicit');
    });
  });

  describe('temporal contradictions', () => {
    test('detects old vs new decisions', () => {
      const oldDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
      const newDate = new Date();

      const memories = [
        createMemory({
          content: 'We decided to use REST API',
          createdAt: oldDate.toISOString(),
        }),
        createMemory({
          content: 'We decided to use REST endpoints',
          createdAt: newDate.toISOString(),
        }),
      ];

      const conflicts = detector.findConflicts(memories);

      expect(conflicts.length).toBe(1);
      expect(conflicts[0].type).toBe('temporal');
      expect(conflicts[0].suggestedResolution).toBe('keep_newer');
    });
  });

  describe('supersedes handling', () => {
    test('ignores conflicts when supersedes is set', () => {
      const memories = [
        createMemory({
          id: 'old',
          content: 'Use tabs for indentation',
          supersededBy: 'new',
        }),
        createMemory({
          id: 'new',
          content: 'Use spaces for indentation',
          supersedes: ['old'],
        }),
      ];

      const conflicts = detector.findConflicts(memories);

      expect(conflicts.length).toBe(0);
    });
  });

  describe('checkNewMemory', () => {
    test('finds conflicts with existing memories', () => {
      const existing = [createMemory({ content: 'Always use tabs' })];
      const candidate = createMemory({ content: 'Never use tabs' });

      const conflicts = detector.checkNewMemory(candidate, existing);

      expect(conflicts.length).toBe(1);
    });
  });

  describe('resolution suggestions', () => {
    test('suggests keep_grounded when tiers differ', () => {
      const memories = [
        createMemory({
          content: 'Use tabs',
          confidenceTier: 'grounded',
        }),
        createMemory({
          content: 'Never use tabs',
          confidenceTier: 'inferred',
        }),
      ];

      const conflicts = detector.findConflicts(memories);

      expect(conflicts[0].suggestedResolution).toBe('keep_grounded');
    });
  });
});

describe('formatConflict', () => {
  test('formats conflict for display', () => {
    const detector = new ContradictionDetector();
    const memories = [
      createMemory({ content: 'Use tabs' }),
      createMemory({ content: 'Never use tabs' }),
    ];

    const conflicts = detector.findConflicts(memories);
    const formatted = formatConflict(conflicts[0]);

    expect(formatted).toContain('CONFLICT');
    expect(formatted).toContain('Memory 1');
    expect(formatted).toContain('Memory 2');
    expect(formatted).toContain('Suggested');
  });
});
