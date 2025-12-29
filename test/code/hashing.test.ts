import { describe, expect, test } from 'bun:test';
import { 
  hashContent, 
  hashFileContent, 
  contentMatches,
  getFileSnapshot,
} from '../../src/code/hashing.ts';

describe('Content Hashing', () => {
  test('hashContent returns consistent hash', () => {
    const hash1 = hashContent('hello world');
    const hash2 = hashContent('hello world');
    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(16);
  });

  test('hashContent returns different hash for different content', () => {
    const hash1 = hashContent('hello');
    const hash2 = hashContent('world');
    expect(hash1).not.toBe(hash2);
  });

  test('hashFileContent works for existing file', () => {
    const hash = hashFileContent('package.json');
    expect(hash).not.toBeNull();
    expect(hash!.length).toBe(16);
  });

  test('hashFileContent returns null for missing file', () => {
    const hash = hashFileContent('nonexistent-file.xyz');
    expect(hash).toBeNull();
  });

  test('contentMatches returns true for matching file', () => {
    const hash = hashFileContent('package.json');
    expect(hash).not.toBeNull();
    expect(contentMatches('package.json', hash!)).toBe(true);
  });

  test('contentMatches returns false for wrong hash', () => {
    expect(contentMatches('package.json', 'wronghash1234567')).toBe(false);
  });

  test('getFileSnapshot returns file info', () => {
    const snapshot = getFileSnapshot('package.json');
    expect(snapshot).not.toBeNull();
    expect(snapshot!.hash.length).toBe(16);
    expect(snapshot!.size).toBeGreaterThan(0);
    expect(snapshot!.lines).toBeGreaterThan(0);
  });
});
