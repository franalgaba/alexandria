import { describe, expect, test } from 'bun:test';
import type { StalenessResult } from '../../src/reviewer/staleness.ts';
import type { MemoryObject } from '../../src/types/memory-objects.ts';
import {
  formatPrompts,
  formatPromptsYaml,
  generatePrompts,
  type RevalidationPrompt,
} from '../../src/utils/revalidation.ts';

function createMemory(overrides: Partial<MemoryObject> = {}): MemoryObject {
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
    createdAt: new Date(),
    updatedAt: new Date(),
    accessCount: 0,
    codeRefs: [],
    ...overrides,
  };
}

function createStalenessResult(
  memory: MemoryObject,
  isStale: boolean,
  reasons: string[] = [],
): StalenessResult {
  return {
    memoryId: memory.id,
    memory,
    level: isStale ? 'stale' : 'verified',
    isStale,
    reasons,
    changedRefs: [],
    missingRefs: [],
  };
}

describe('generatePrompts', () => {
  test('generates prompts for stale memories', () => {
    const memory = createMemory({ content: 'Use fetchUser()' });
    const stalenessResults = new Map<string, StalenessResult>([
      [memory.id, createStalenessResult(memory, true, ['File changed'])],
    ]);

    const prompts = generatePrompts([memory], stalenessResults);

    expect(prompts.length).toBe(1);
    expect(prompts[0].memory.id).toBe(memory.id);
    expect(prompts[0].reasons).toContain('File changed');
  });

  test('skips non-stale memories', () => {
    const memory = createMemory();
    const stalenessResults = new Map<string, StalenessResult>([
      [memory.id, createStalenessResult(memory, false)],
    ]);

    const prompts = generatePrompts([memory], stalenessResults);

    expect(prompts.length).toBe(0);
  });

  test('suggests retire for deleted files', () => {
    const memory = createMemory();
    const stalenessResults = new Map<string, StalenessResult>([
      [memory.id, createStalenessResult(memory, true, ['File deleted: src/api.ts'])],
    ]);

    const prompts = generatePrompts([memory], stalenessResults);

    expect(prompts[0].suggestedAction).toBe('retire');
    expect(prompts[0].priority).toBeGreaterThan(2);
  });

  test('suggests verify for changed files', () => {
    const memory = createMemory();
    const stalenessResults = new Map<string, StalenessResult>([
      [memory.id, createStalenessResult(memory, true, ['File changed since verification'])],
    ]);

    const prompts = generatePrompts([memory], stalenessResults);

    expect(prompts[0].suggestedAction).toBe('verify');
  });

  test('prioritizes constraints higher', () => {
    const decision = createMemory({ objectType: 'decision' });
    const constraint = createMemory({ objectType: 'constraint' });

    const stalenessResults = new Map<string, StalenessResult>([
      [decision.id, createStalenessResult(decision, true, ['Changed'])],
      [constraint.id, createStalenessResult(constraint, true, ['Changed'])],
    ]);

    const prompts = generatePrompts([decision, constraint], stalenessResults);

    // Should be sorted by priority, constraint first
    expect(prompts[0].memory.objectType).toBe('constraint');
  });
});

describe('formatPrompts', () => {
  test('formats prompts for display', () => {
    const memory = createMemory({ content: 'Use fetchUser() for API calls' });
    const prompt: RevalidationPrompt = {
      memory,
      reasons: ['File src/api.ts changed'],
      suggestedAction: 'verify',
      priority: 2,
    };

    const output = formatPrompts([prompt]);

    expect(output).toContain('NEEDS REVALIDATION');
    expect(output).toContain('Use fetchUser()');
    expect(output).toContain('src/api.ts changed');
    expect(output).toContain('alex verify');
  });

  test('returns empty string for no prompts', () => {
    const output = formatPrompts([]);
    expect(output).toBe('');
  });
});

describe('formatPromptsYaml', () => {
  test('formats prompts as YAML', () => {
    const memory = createMemory({ content: 'Test memory' });
    const prompt: RevalidationPrompt = {
      memory,
      reasons: ['Changed'],
      suggestedAction: 'verify',
      priority: 1,
    };

    const output = formatPromptsYaml([prompt]);

    expect(output).toContain('needs_revalidation:');
    expect(output).toContain('action: verify');
    expect(output).toContain('reasons:');
  });
});
