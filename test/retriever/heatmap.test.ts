/**
 * Tests for Access Heatmap
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { AccessHeatmap, createAccessHeatmap } from '../../src/retriever/heatmap.ts';

describe('AccessHeatmap', () => {
  let db: Database;
  let heatmap: AccessHeatmap;

  beforeEach(() => {
    db = new Database(':memory:');

    // Create minimal schema
    db.run(`
      CREATE TABLE memory_objects (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        object_type TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        access_count INTEGER DEFAULT 0,
        last_accessed TEXT,
        code_refs TEXT DEFAULT '[]'
      )
    `);

    heatmap = new AccessHeatmap(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('getHotMemories', () => {
    test('returns empty array when no memories exist', () => {
      const result = heatmap.getHotMemories();
      expect(result).toEqual([]);
    });

    test('returns memories sorted by access count', () => {
      // Insert memories with different access counts
      db.run(
        `INSERT INTO memory_objects (id, content, object_type, access_count, last_accessed)
         VALUES ('m1', 'Memory 1', 'decision', 5, datetime('now'))`,
      );
      db.run(
        `INSERT INTO memory_objects (id, content, object_type, access_count, last_accessed)
         VALUES ('m2', 'Memory 2', 'constraint', 20, datetime('now'))`,
      );
      db.run(
        `INSERT INTO memory_objects (id, content, object_type, access_count, last_accessed)
         VALUES ('m3', 'Memory 3', 'known_fix', 10, datetime('now'))`,
      );

      const result = heatmap.getHotMemories({ limit: 10 });

      expect(result.length).toBe(3);
      expect(result[0].memoryId).toBe('m2'); // Highest access count
      expect(result[0].accessCount).toBe(20);
      expect(result[1].memoryId).toBe('m3');
      expect(result[2].memoryId).toBe('m1');
    });

    test('respects limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        db.run(
          `INSERT INTO memory_objects (id, content, object_type, access_count, last_accessed)
           VALUES ('m${i}', 'Memory ${i}', 'decision', ${i * 10}, datetime('now'))`,
        );
      }

      const result = heatmap.getHotMemories({ limit: 3 });

      expect(result.length).toBe(3);
    });

    test('filters by minimum access count', () => {
      db.run(
        `INSERT INTO memory_objects (id, content, object_type, access_count, last_accessed)
         VALUES ('m1', 'Memory 1', 'decision', 1, datetime('now'))`,
      );
      db.run(
        `INSERT INTO memory_objects (id, content, object_type, access_count, last_accessed)
         VALUES ('m2', 'Memory 2', 'constraint', 5, datetime('now'))`,
      );
      db.run(
        `INSERT INTO memory_objects (id, content, object_type, access_count, last_accessed)
         VALUES ('m3', 'Memory 3', 'known_fix', 10, datetime('now'))`,
      );

      const result = heatmap.getHotMemories({ minAccessCount: 5 });

      expect(result.length).toBe(2);
      expect(result.every((r) => r.accessCount >= 5)).toBe(true);
    });

    test('filters by object type', () => {
      db.run(
        `INSERT INTO memory_objects (id, content, object_type, access_count, last_accessed)
         VALUES ('m1', 'Memory 1', 'decision', 10, datetime('now'))`,
      );
      db.run(
        `INSERT INTO memory_objects (id, content, object_type, access_count, last_accessed)
         VALUES ('m2', 'Memory 2', 'constraint', 20, datetime('now'))`,
      );
      db.run(
        `INSERT INTO memory_objects (id, content, object_type, access_count, last_accessed)
         VALUES ('m3', 'Memory 3', 'decision', 15, datetime('now'))`,
      );

      const result = heatmap.getHotMemories({ types: ['decision'] });

      expect(result.length).toBe(2);
      expect(result.every((r) => r.objectType === 'decision')).toBe(true);
    });

    test('excludes non-active memories', () => {
      db.run(
        `INSERT INTO memory_objects (id, content, object_type, status, access_count, last_accessed)
         VALUES ('m1', 'Active memory', 'decision', 'active', 10, datetime('now'))`,
      );
      db.run(
        `INSERT INTO memory_objects (id, content, object_type, status, access_count, last_accessed)
         VALUES ('m2', 'Stale memory', 'constraint', 'stale', 20, datetime('now'))`,
      );
      db.run(
        `INSERT INTO memory_objects (id, content, object_type, status, access_count, last_accessed)
         VALUES ('m3', 'Retired memory', 'known_fix', 'retired', 30, datetime('now'))`,
      );

      const result = heatmap.getHotMemories();

      expect(result.length).toBe(1);
      expect(result[0].memoryId).toBe('m1');
    });

    test('parses code refs correctly', () => {
      db.run(
        `INSERT INTO memory_objects (id, content, object_type, access_count, last_accessed, code_refs)
         VALUES ('m1', 'Memory 1', 'decision', 10, datetime('now'),
                 '[{"path": "src/file.ts", "line": 10}, {"path": "src/other.ts"}]')`,
      );

      const result = heatmap.getHotMemories();

      expect(result.length).toBe(1);
      expect(result[0].codeRefs).toEqual(['src/file.ts', 'src/other.ts']);
    });

    test('handles invalid code refs JSON', () => {
      db.run(
        `INSERT INTO memory_objects (id, content, object_type, access_count, last_accessed, code_refs)
         VALUES ('m1', 'Memory 1', 'decision', 10, datetime('now'), 'invalid json')`,
      );

      const result = heatmap.getHotMemories();

      expect(result.length).toBe(1);
      expect(result[0].codeRefs).toEqual([]);
    });
  });

  describe('heat score calculation', () => {
    test('weights recent access higher', () => {
      // Memory accessed today
      db.run(
        `INSERT INTO memory_objects (id, content, object_type, access_count, last_accessed)
         VALUES ('today', 'Today memory', 'decision', 10, datetime('now'))`,
      );

      // Memory accessed a month ago with same access count
      db.run(
        `INSERT INTO memory_objects (id, content, object_type, access_count, last_accessed)
         VALUES ('old', 'Old memory', 'decision', 10, datetime('now', '-35 days'))`,
      );

      const result = heatmap.getHotMemories();

      expect(result.length).toBe(2);
      // Today memory should have higher heat score
      expect(result[0].memoryId).toBe('today');
      expect(result[0].heatScore).toBe(10); // 10 * 1.0
      expect(result[1].memoryId).toBe('old');
      expect(result[1].heatScore).toBe(2); // 10 * 0.2
    });

    test('applies correct recency weights', () => {
      const now = new Date();

      // Today: weight 1.0
      db.run(
        `INSERT INTO memory_objects (id, content, object_type, access_count, last_accessed)
         VALUES ('today', 'Today', 'decision', 10, datetime('now'))`,
      );

      // 3 days ago: weight 0.7 (within week)
      db.run(
        `INSERT INTO memory_objects (id, content, object_type, access_count, last_accessed)
         VALUES ('week', 'This week', 'decision', 10, datetime('now', '-3 days'))`,
      );

      // 15 days ago: weight 0.4 (within month)
      db.run(
        `INSERT INTO memory_objects (id, content, object_type, access_count, last_accessed)
         VALUES ('month', 'This month', 'decision', 10, datetime('now', '-15 days'))`,
      );

      // 60 days ago: weight 0.2 (older)
      db.run(
        `INSERT INTO memory_objects (id, content, object_type, access_count, last_accessed)
         VALUES ('old', 'Old', 'decision', 10, datetime('now', '-60 days'))`,
      );

      const result = heatmap.getHotMemories();

      expect(result.length).toBe(4);
      expect(result[0].memoryId).toBe('today');
      expect(result[0].heatScore).toBe(10); // 10 * 1.0
      expect(result[1].memoryId).toBe('week');
      expect(result[1].heatScore).toBe(7); // 10 * 0.7
      expect(result[2].memoryId).toBe('month');
      expect(result[2].heatScore).toBe(4); // 10 * 0.4
      expect(result[3].memoryId).toBe('old');
      expect(result[3].heatScore).toBe(2); // 10 * 0.2
    });

    test('handles null last_accessed', () => {
      db.run(
        `INSERT INTO memory_objects (id, content, object_type, access_count)
         VALUES ('no-date', 'No date', 'decision', 10)`,
      );

      const result = heatmap.getHotMemories();

      expect(result.length).toBe(1);
      expect(result[0].heatScore).toBe(2); // 10 * 0.2 (default weight)
    });
  });

  describe('getHotMemoryIds', () => {
    test('returns array of memory IDs', () => {
      db.run(
        `INSERT INTO memory_objects (id, content, object_type, access_count, last_accessed)
         VALUES ('m1', 'Memory 1', 'decision', 10, datetime('now'))`,
      );
      db.run(
        `INSERT INTO memory_objects (id, content, object_type, access_count, last_accessed)
         VALUES ('m2', 'Memory 2', 'constraint', 20, datetime('now'))`,
      );

      const result = heatmap.getHotMemoryIds(5);

      expect(result).toEqual(['m2', 'm1']);
    });
  });

  describe('formatHeatmap', () => {
    test('formats empty heatmap', () => {
      const formatted = heatmap.formatHeatmap([]);
      expect(formatted).toBe('No frequently accessed memories yet.');
    });

    test('formats entries with flames', () => {
      const entries = [
        {
          memoryId: 'm1',
          content: 'Use Bun for TypeScript',
          objectType: 'decision',
          accessCount: 50,
          heatScore: 50,
          codeRefs: ['src/cli.ts'],
        },
        {
          memoryId: 'm2',
          content: 'Never commit .env files',
          objectType: 'constraint',
          accessCount: 25,
          heatScore: 25,
          codeRefs: [],
        },
      ];

      const formatted = heatmap.formatHeatmap(entries);

      expect(formatted).toContain('🔥 ACCESS HEATMAP');
      expect(formatted).toContain('(50)');
      expect(formatted).toContain('Use Bun for TypeScript');
      expect(formatted).toContain('[src/cli.ts]');
      expect(formatted).toContain('🔥🔥🔥'); // Top entry gets max flames
    });

    test('truncates long content', () => {
      const entries = [
        {
          memoryId: 'm1',
          content:
            'This is a very long memory content that should be truncated to fit within the display limit properly',
          objectType: 'decision',
          accessCount: 10,
          heatScore: 10,
          codeRefs: [],
        },
      ];

      const formatted = heatmap.formatHeatmap(entries);

      expect(formatted).toContain('...');
      expect(formatted.length).toBeLessThan(
        entries[0].content.length + 100,
      );
    });
  });

  describe('createAccessHeatmap', () => {
    test('factory function creates instance', () => {
      const instance = createAccessHeatmap(db);
      expect(instance).toBeInstanceOf(AccessHeatmap);
    });
  });
});
