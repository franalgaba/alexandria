/**
 * Tests for Context Window Monitor
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { calculateContextUsage, formatContextUsage } from '../../src/utils/context-monitor.ts';

describe('Context Monitor', () => {
  const testDir = join(import.meta.dir, '.test-transcripts');

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('calculateContextUsage', () => {
    test('returns null for non-existent file', () => {
      const result = calculateContextUsage('/nonexistent/path.jsonl');
      expect(result).toBeNull();
    });

    test('parses valid transcript with usage data', () => {
      const transcriptPath = join(testDir, 'valid.jsonl');
      const entries = [
        {
          timestamp: '2024-01-01T10:00:00Z',
          message: {
            usage: {
              input_tokens: 5000,
              output_tokens: 2000,
              cache_read_input_tokens: 1000,
              cache_creation_input_tokens: 500,
            },
          },
        },
      ];

      writeFileSync(transcriptPath, entries.map(e => JSON.stringify(e)).join('\n'));

      const result = calculateContextUsage(transcriptPath);

      expect(result).not.toBeNull();
      expect(result!.inputTokens).toBe(5000);
      expect(result!.outputTokens).toBe(2000);
      expect(result!.cacheReadTokens).toBe(1000);
      expect(result!.cacheCreationTokens).toBe(500);
      expect(result!.totalTokens).toBe(8500);
    });

    test('uses most recent entry for usage', () => {
      const transcriptPath = join(testDir, 'multiple.jsonl');
      const entries = [
        {
          timestamp: '2024-01-01T10:00:00Z',
          message: { usage: { input_tokens: 1000, output_tokens: 500 } },
        },
        {
          timestamp: '2024-01-01T11:00:00Z',
          message: { usage: { input_tokens: 5000, output_tokens: 2000 } },
        },
        {
          timestamp: '2024-01-01T10:30:00Z',
          message: { usage: { input_tokens: 3000, output_tokens: 1000 } },
        },
      ];

      writeFileSync(transcriptPath, entries.map(e => JSON.stringify(e)).join('\n'));

      const result = calculateContextUsage(transcriptPath);

      expect(result).not.toBeNull();
      expect(result!.inputTokens).toBe(5000); // From 11:00 entry
      expect(result!.outputTokens).toBe(2000);
    });

    test('ignores sidechain entries', () => {
      const transcriptPath = join(testDir, 'sidechain.jsonl');
      const entries = [
        {
          timestamp: '2024-01-01T10:00:00Z',
          isSidechain: true,
          message: { usage: { input_tokens: 99999, output_tokens: 99999 } },
        },
        {
          timestamp: '2024-01-01T10:01:00Z',
          message: { usage: { input_tokens: 1000, output_tokens: 500 } },
        },
      ];

      writeFileSync(transcriptPath, entries.map(e => JSON.stringify(e)).join('\n'));

      const result = calculateContextUsage(transcriptPath);

      expect(result!.inputTokens).toBe(1000); // Should ignore sidechain
    });

    test('ignores API error entries', () => {
      const transcriptPath = join(testDir, 'errors.jsonl');
      const entries = [
        {
          timestamp: '2024-01-01T10:00:00Z',
          isApiErrorMessage: true,
          message: { usage: { input_tokens: 99999, output_tokens: 99999 } },
        },
        {
          timestamp: '2024-01-01T10:01:00Z',
          message: { usage: { input_tokens: 1000, output_tokens: 500 } },
        },
      ];

      writeFileSync(transcriptPath, entries.map(e => JSON.stringify(e)).join('\n'));

      const result = calculateContextUsage(transcriptPath);

      expect(result!.inputTokens).toBe(1000); // Should ignore error entry
    });

    test('calculates percentage correctly', () => {
      const transcriptPath = join(testDir, 'percentage.jsonl');
      // 100K tokens = 50% of 200K context window
      const entries = [
        {
          timestamp: '2024-01-01T10:00:00Z',
          message: { usage: { input_tokens: 80000, output_tokens: 20000 } },
        },
      ];

      writeFileSync(transcriptPath, entries.map(e => JSON.stringify(e)).join('\n'));

      const result = calculateContextUsage(transcriptPath);

      expect(result!.percentage).toBe(50);
      expect(result!.exceeds50Percent).toBe(true);
      expect(result!.recommendation).toBe('checkpoint_and_clear');
    });

    test('recommends continue when under threshold', () => {
      const transcriptPath = join(testDir, 'under.jsonl');
      const entries = [
        {
          timestamp: '2024-01-01T10:00:00Z',
          message: { usage: { input_tokens: 20000, output_tokens: 10000 } },
        },
      ];

      writeFileSync(transcriptPath, entries.map(e => JSON.stringify(e)).join('\n'));

      const result = calculateContextUsage(transcriptPath);

      expect(result!.exceeds50Percent).toBe(false);
      expect(result!.recommendation).toBe('continue');
    });

    test('handles empty transcript', () => {
      const transcriptPath = join(testDir, 'empty.jsonl');
      writeFileSync(transcriptPath, '');

      const result = calculateContextUsage(transcriptPath);

      expect(result!.totalTokens).toBe(0);
      expect(result!.percentage).toBe(0);
    });

    test('handles transcript with no usage data', () => {
      const transcriptPath = join(testDir, 'no-usage.jsonl');
      const entries = [
        { timestamp: '2024-01-01T10:00:00Z', message: {} },
        { timestamp: '2024-01-01T10:01:00Z', message: { content: 'hello' } },
      ];

      writeFileSync(transcriptPath, entries.map(e => JSON.stringify(e)).join('\n'));

      const result = calculateContextUsage(transcriptPath);

      expect(result!.totalTokens).toBe(0);
    });

    test('handles invalid JSON lines gracefully', () => {
      const transcriptPath = join(testDir, 'invalid.jsonl');
      const content = 'invalid json\n{"message":{"usage":{"input_tokens":1000}}}\nalso invalid';

      writeFileSync(transcriptPath, content);

      const result = calculateContextUsage(transcriptPath);

      expect(result!.inputTokens).toBe(1000);
    });
  });

  describe('formatContextUsage', () => {
    test('formats usage with progress bar', () => {
      const usage = {
        inputTokens: 30000,
        outputTokens: 10000,
        cacheReadTokens: 5000,
        cacheCreationTokens: 2000,
        totalTokens: 47000,
        percentage: 23.5,
        exceeds50Percent: false,
        exceedsThreshold: false,
        threshold: 50,
        recommendation: 'continue' as const,
      };

      const formatted = formatContextUsage(usage);

      expect(formatted).toContain('23.5%');
      expect(formatted).toContain('47.0K tokens');
      expect(formatted).toContain('Input: 30.0K');
      expect(formatted).toContain('Output: 10.0K');
      expect(formatted).toContain('Continue');
    });

    test('shows warning when threshold exceeded', () => {
      const usage = {
        inputTokens: 80000,
        outputTokens: 30000,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 110000,
        percentage: 55,
        exceeds50Percent: true,
        exceedsThreshold: true,
        threshold: 50,
        recommendation: 'checkpoint_and_clear' as const,
      };

      const formatted = formatContextUsage(usage);

      expect(formatted).toContain('⚠️');
      expect(formatted).toContain('Checkpoint and clear');
    });
  });
});
