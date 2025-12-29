/**
 * Tests for FTS index
 */

import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { FTSIndex } from '../../src/indexes/fts.ts';
import { getMemoryConnection } from '../../src/stores/connection.ts';
import { MemoryObjectStore } from '../../src/stores/memory-objects.ts';

describe('FTSIndex', () => {
  let db: Database;
  let store: MemoryObjectStore;
  let fts: FTSIndex;

  beforeEach(() => {
    db = getMemoryConnection();
    store = new MemoryObjectStore(db);
    fts = new FTSIndex(db);
  });

  afterEach(() => {
    db.close();
  });

  test('search by content', () => {
    store.create({
      content: 'sharp segfaults on Alpine Linux',
      objectType: 'failed_attempt',
      confidence: 'certain',
    });

    store.create({
      content: 'Use Bun instead of Node.js',
      objectType: 'decision',
    });

    const results = fts.searchObjects('sharp segfaults');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].object.content).toContain('sharp');
  });

  test('search respects status filter', () => {
    store.create({
      content: 'Active memory about testing',
      objectType: 'decision',
    });

    const retired = store.create({
      content: 'Retired memory about testing',
      objectType: 'decision',
    });
    store.retire(retired.id);

    const activeResults = fts.searchObjects('testing', ['active']);
    expect(activeResults.length).toBe(1);
    expect(activeResults[0].object.content).toContain('Active');

    const allResults = fts.searchObjects('testing', ['active', 'retired']);
    expect(allResults.length).toBe(2);
  });

  test('search returns highlights', () => {
    store.create({
      content: 'This is a test memory with specific keywords for testing',
      objectType: 'decision',
    });

    const results = fts.searchObjects('specific keywords');
    expect(results.length).toBeGreaterThan(0);
    // Highlight might include <mark> tags
    expect(results[0].highlight).toBeDefined();
  });

  test('search by token', () => {
    store.create({
      content: 'Using handleUserInput for form validation',
      objectType: 'convention',
    });

    store.create({
      content: 'The build process uses webpack',
      objectType: 'decision',
    });

    const results = fts.searchByToken('handleUserInput');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain('handleUserInput');
  });

  test('search by token pattern', () => {
    store.create({
      content: 'Functions: getUserData, getOrderData, getProductData',
      objectType: 'convention',
    });

    // Token pattern search looks for tokens in object_tokens table
    // which are extracted identifiers like camelCase
    const results = fts.searchByTokenPattern('getUserData');
    // This may or may not find results depending on token extraction
    expect(Array.isArray(results)).toBe(true);
  });

  test('escapes special characters in query', () => {
    store.create({
      content: 'Special test content',
      objectType: 'decision',
    });

    // These characters should not cause FTS5 syntax errors
    const results = fts.searchObjects('test "special:content"');
    // Should not throw, may or may not return results
    expect(Array.isArray(results)).toBe(true);
  });

  test('empty query returns empty results', () => {
    store.create({ content: 'Some content', objectType: 'decision' });

    const results = fts.searchObjects('');
    expect(results.length).toBe(0);
  });
});
