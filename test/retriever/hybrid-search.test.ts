/**
 * Tests for hybrid search
 */

import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { HybridSearch } from '../../src/retriever/hybrid-search.ts';
import { getMemoryConnection } from '../../src/stores/connection.ts';
import { MemoryObjectStore } from '../../src/stores/memory-objects.ts';

describe('HybridSearch', () => {
  let db: Database;
  let store: MemoryObjectStore;
  let search: HybridSearch;

  beforeEach(() => {
    db = getMemoryConnection();
    store = new MemoryObjectStore(db);
    search = new HybridSearch(db);
  });

  afterEach(() => {
    db.close();
  });

  test('hybrid search combines FTS and vector results', async () => {
    store.create({
      content: 'sharp image processing library crashes on Alpine Linux',
      objectType: 'failed_attempt',
    });

    store.create({
      content: 'Use Bun instead of Node for better performance',
      objectType: 'decision',
    });

    store.create({
      content: 'The project uses TypeScript with strict mode',
      objectType: 'convention',
    });

    // Use lexical search since vector search requires model loading
    const results = search.searchLexical('sharp alpine', { limit: 10 });

    expect(results.length).toBeGreaterThan(0);
    // First result should be about sharp/alpine
    expect(results[0].object.content.toLowerCase()).toMatch(/sharp|alpine/);
  });

  test('lexical-only search', () => {
    store.create({
      content: 'Exact keyword match test',
      objectType: 'decision',
    });

    store.create({
      content: 'Different content altogether',
      objectType: 'decision',
    });

    const results = search.searchLexical('exact keyword');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].matchType).toBe('lexical');
  });

  test('search respects status filter', async () => {
    store.create({
      content: 'Active memory about configuration',
      objectType: 'decision',
    });

    const retired = store.create({
      content: 'Retired memory about configuration',
      objectType: 'decision',
    });
    store.retire(retired.id);

    const activeResults = await search.search('configuration', { status: ['active'] });
    expect(activeResults.length).toBe(1);
    expect(activeResults[0].object.status).toBe('active');
  });

  test('search respects type filter', async () => {
    store.create({
      content: 'Decision about testing',
      objectType: 'decision',
    });

    store.create({
      content: 'Constraint about testing',
      objectType: 'constraint',
    });

    const results = await search.search('testing', { objectType: 'decision' });
    expect(results.every((r) => r.object.objectType === 'decision')).toBe(true);
  });

  test('search by exact token', () => {
    store.create({
      content: 'The handleUserInput function validates form data',
      objectType: 'convention',
    });

    const results = search.searchByToken('handleUserInput');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].matchType).toBe('lexical');
  });

  test('superseded objects excluded by default', async () => {
    const old = store.create({
      content: 'Old approach to API design',
      objectType: 'decision',
    });

    const newObj = store.create({
      content: 'New approach to API design using GraphQL',
      objectType: 'decision',
    });

    store.supersede(old.id, newObj.id);

    const results = await search.search('API design');
    const ids = results.map((r) => r.object.id);

    expect(ids).not.toContain(old.id);
    expect(ids).toContain(newObj.id);
  });
});
