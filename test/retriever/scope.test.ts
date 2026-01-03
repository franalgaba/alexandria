import { describe, expect, test } from 'bun:test';
import { codeRefsMatchScope, extractScope, scoreScopeMatch } from '../../src/retriever/scope.ts';

describe('Scope Extraction', () => {
  describe('file path extraction', () => {
    test('extracts TypeScript file paths', () => {
      const result = extractScope('in src/api.ts we have the handler');
      expect(result).not.toBeNull();
      expect(result!.scope.type).toBe('file');
      expect(result!.scope.path).toBe('src/api.ts');
      expect(result!.confidence).toBe('high');
    });

    test('extracts JavaScript file paths', () => {
      const result = extractScope('check file utils/helpers.js');
      expect(result).not.toBeNull();
      expect(result!.scope.path).toBe('utils/helpers.js');
    });

    test('extracts Python file paths', () => {
      const result = extractScope('from app/models.py');
      expect(result).not.toBeNull();
      expect(result!.scope.path).toBe('app/models.py');
    });
  });

  describe('module extraction', () => {
    test('extracts module references', () => {
      const result = extractScope('in the auth module');
      expect(result).not.toBeNull();
      expect(result!.scope.type).toBe('module');
      expect(result!.scope.path).toBe('auth');
      expect(result!.confidence).toBe('medium');
    });

    test('extracts directory references', () => {
      const result = extractScope('in the utils directory');
      expect(result).not.toBeNull();
      expect(result!.scope.path).toBe('utils');
    });
  });

  describe('area keyword extraction', () => {
    test('extracts known area keywords', () => {
      const result = extractScope('something about database');
      expect(result).not.toBeNull();
      expect(result!.scope.path).toBe('database');
      expect(result!.confidence).toBe('low');
    });

    test('extracts api area', () => {
      const result = extractScope('the api layer');
      expect(result).not.toBeNull();
      expect(result!.scope.path).toBe('api');
    });
  });

  test('returns null for queries without scope', () => {
    const result = extractScope('hello world');
    expect(result).toBeNull();
  });
});

describe('Scope Matching', () => {
  test('exact match scores 1.0', () => {
    const score = scoreScopeMatch(
      { type: 'file', path: 'src/api.ts' },
      { type: 'file', path: 'src/api.ts' },
    );
    expect(score).toBe(1.0);
  });

  test('file in module scores 0.8', () => {
    const score = scoreScopeMatch(
      { type: 'file', path: 'src/auth/login.ts' },
      { type: 'module', path: 'auth' },
    );
    expect(score).toBe(0.8);
  });

  test('global scope scores low', () => {
    const score = scoreScopeMatch({ type: 'global' }, { type: 'file', path: 'src/api.ts' });
    expect(score).toBe(0.1);
  });

  test('no match scores 0', () => {
    const score = scoreScopeMatch(
      { type: 'module', path: 'auth' },
      { type: 'module', path: 'database' },
    );
    expect(score).toBe(0);
  });
});

describe('Code Refs Scope Matching', () => {
  test('exact file match scores 1.0', () => {
    const score = codeRefsMatchScope(['src/api.ts', 'src/utils.ts'], {
      type: 'file',
      path: 'src/api.ts',
    });
    expect(score).toBe(1.0);
  });

  test('file in module scores 0.8', () => {
    const score = codeRefsMatchScope(['src/auth/login.ts'], { type: 'module', path: 'auth' });
    expect(score).toBe(0.8);
  });

  test('no refs scores 0', () => {
    const score = codeRefsMatchScope([], { type: 'file', path: 'src/api.ts' });
    expect(score).toBe(0);
  });
});
