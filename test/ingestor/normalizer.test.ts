/**
 * Tests for Event Normalizer
 */

import { describe, expect, test } from 'bun:test';
import {
  extractSignals,
  generateSynopsis,
  hashContent,
  isDuplicate,
  normalizeEvent,
} from '../../src/ingestor/normalizer.ts';

describe('Event Normalizer', () => {
  describe('generateSynopsis', () => {
    test('generates synopsis for tool output', () => {
      const content = 'Some output from a command\nWith multiple lines\n';
      const synopsis = generateSynopsis(content, 'tool_output', {
        toolName: 'bash',
        exitCode: 0,
      });

      expect(synopsis).toContain('bash');
      expect(synopsis).toContain('success');
    });

    test('generates synopsis for failed tool output', () => {
      const synopsis = generateSynopsis('Error: something went wrong', 'tool_output', {
        toolName: 'test',
        exitCode: 1,
      });

      expect(synopsis).toContain('test');
      expect(synopsis).toContain('failed');
    });

    test('generates synopsis for error', () => {
      const content = 'Error: Cannot find module "foo"\n  at require()';
      const synopsis = generateSynopsis(content, 'error');

      expect(synopsis).toContain('Error');
      expect(synopsis).toContain('Cannot find module');
    });

    test('generates synopsis for test summary', () => {
      const content = '10 tests passed, 2 tests failed';
      const synopsis = generateSynopsis(content, 'test_summary');

      expect(synopsis).toContain('10 passed');
      expect(synopsis).toContain('2 failed');
    });

    test('generates synopsis for diff', () => {
      const content = `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
+import { foo } from './foo';
 const x = 1;
-const y = 2;
+const y = 3;`;

      const synopsis = generateSynopsis(content, 'diff');

      expect(synopsis).toContain('Diff');
      expect(synopsis).toContain('+');
      expect(synopsis).toContain('-');
    });
  });

  describe('extractSignals', () => {
    test('extracts exit code', () => {
      const signals = extractSignals('output', 'tool_output', { exitCode: 1 });
      expect(signals.exitCode).toBe(1);
    });

    test('extracts error signature', () => {
      const content = 'Error: ENOENT: no such file';
      const signals = extractSignals(content, 'error', { exitCode: 1 });

      expect(signals.errorSignature).toBeDefined();
      expect(signals.errorSignature).toContain('ENOENT');
    });

    test('extracts test counts', () => {
      const content = '15 tests passed\n3 tests failed';
      const signals = extractSignals(content, 'test_summary');

      expect(signals.testsPassed).toBe(15);
      expect(signals.testsFailed).toBe(3);
    });

    test('extracts files changed from diff', () => {
      const content = `--- a/src/foo.ts
+++ b/src/foo.ts
--- a/src/bar.ts
+++ b/src/bar.ts`;

      const signals = extractSignals(content, 'diff');

      expect(signals.filesChanged).toBeDefined();
      expect(signals.filesChanged?.length).toBeGreaterThanOrEqual(1);
    });

    test('extracts line and byte counts', () => {
      const content = 'line1\nline2\nline3';
      const signals = extractSignals(content, 'turn');

      expect(signals.lineCount).toBe(3);
      expect(signals.byteCount).toBe(17);
    });
  });

  describe('hashContent', () => {
    test('generates consistent hash for same content', () => {
      const content = 'Some content to hash';
      const hash1 = hashContent(content);
      const hash2 = hashContent(content);

      expect(hash1).toBe(hash2);
    });

    test('generates different hashes for different content', () => {
      const hash1 = hashContent('Content A');
      const hash2 = hashContent('Content B');

      expect(hash1).not.toBe(hash2);
    });

    test('normalizes whitespace', () => {
      const hash1 = hashContent('hello  world');
      const hash2 = hashContent('hello world');

      expect(hash1).toBe(hash2);
    });

    test('is case insensitive', () => {
      const hash1 = hashContent('Hello World');
      const hash2 = hashContent('hello world');

      expect(hash1).toBe(hash2);
    });
  });

  describe('normalizeEvent', () => {
    test('returns normalized event structure', () => {
      const result = normalizeEvent('Short content', 'turn');

      expect(result.eventType).toBe('turn');
      expect(result.content).toBe('Short content');
      expect(result.contentHash).toBeDefined();
      expect(result.structuredSignals).toBeDefined();
      expect(result.shouldBlob).toBe(false);
    });

    test('sets shouldBlob for large content', () => {
      const largeContent = 'x'.repeat(1000);
      const result = normalizeEvent(largeContent, 'tool_output');

      expect(result.shouldBlob).toBe(true);
      expect(result.synopsis).toBeDefined();
    });

    test('generates synopsis only for large content', () => {
      const smallContent = 'Small';
      const result = normalizeEvent(smallContent, 'tool_output');

      expect(result.synopsis).toBeUndefined();
      expect(result.shouldBlob).toBe(false);
    });
  });

  describe('isDuplicate', () => {
    test('detects duplicates', () => {
      const hash1 = hashContent('Same content');
      const hash2 = hashContent('Same content');

      expect(isDuplicate(hash1, hash2)).toBe(true);
    });

    test('detects non-duplicates', () => {
      const hash1 = hashContent('Content A');
      const hash2 = hashContent('Content B');

      expect(isDuplicate(hash1, hash2)).toBe(false);
    });
  });
});
