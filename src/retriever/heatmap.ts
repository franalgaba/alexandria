/**
 * Access Heatmap - prioritize frequently accessed memories
 *
 * Heat score = access_count × recency_weight
 * Recency weights:
 *   - Accessed today: 1.0
 *   - Last week: 0.7
 *   - Last month: 0.4
 *   - Older: 0.2
 */

import type { Database } from 'bun:sqlite';
import type { MemoryObject, MemoryObjectRow } from '../types/memory-objects.ts';

export interface HeatmapEntry {
  memoryId: string;
  content: string;
  objectType: string;
  accessCount: number;
  lastAccessedAt?: Date;
  heatScore: number;
  codeRefs: string[];
}

export interface HeatmapOptions {
  limit?: number;
  minAccessCount?: number;
  types?: string[];
}

export class AccessHeatmap {
  constructor(private db: Database) {}

  /**
   * Get hot memories sorted by heat score
   */
  getHotMemories(options: HeatmapOptions = {}): HeatmapEntry[] {
    const { limit = 10, minAccessCount = 1, types } = options;

    let query = `
      SELECT
        id, content, object_type, access_count, last_accessed, code_refs
      FROM memory_objects
      WHERE status = 'active'
        AND access_count >= $minAccessCount
    `;

    const params: Record<string, unknown> = { $minAccessCount: minAccessCount };

    if (types && types.length > 0) {
      const placeholders = types.map((_, i) => `$type${i}`).join(', ');
      query += ` AND object_type IN (${placeholders})`;
      types.forEach((type, i) => {
        params[`$type${i}`] = type;
      });
    }

    query += ` ORDER BY access_count DESC LIMIT $limit`;
    params.$limit = limit * 2; // Get extra to sort by heat score

    const rows = this.db.query(query).all(params as Record<string, string | number>) as Array<{
      id: string;
      content: string;
      object_type: string;
      access_count: number;
      last_accessed: string | null;
      code_refs: string | null;
    }>;

    // Calculate heat scores and sort
    const entries: HeatmapEntry[] = rows.map((row) => {
      const lastAccessedAt = row.last_accessed ? new Date(row.last_accessed) : undefined;
      const heatScore = this.calculateHeatScore(row.access_count, lastAccessedAt);

      let codeRefs: string[] = [];
      if (row.code_refs) {
        try {
          const refs = JSON.parse(row.code_refs);
          codeRefs = refs.map((r: { path: string }) => r.path);
        } catch {
          codeRefs = [];
        }
      }

      return {
        memoryId: row.id,
        content: row.content,
        objectType: row.object_type,
        accessCount: row.access_count,
        lastAccessedAt,
        heatScore,
        codeRefs,
      };
    });

    // Sort by heat score descending and limit
    entries.sort((a, b) => b.heatScore - a.heatScore);
    return entries.slice(0, limit);
  }

  /**
   * Calculate heat score based on access count and recency
   */
  private calculateHeatScore(accessCount: number, lastAccessedAt?: Date): number {
    const recencyWeight = this.getRecencyWeight(lastAccessedAt);
    return accessCount * recencyWeight;
  }

  /**
   * Get recency weight based on how recently the memory was accessed
   */
  private getRecencyWeight(lastAccessedAt?: Date): number {
    if (!lastAccessedAt) return 0.2;

    const daysSinceAccess =
      (Date.now() - lastAccessedAt.getTime()) / (1000 * 60 * 60 * 24);

    if (daysSinceAccess < 1) return 1.0; // Today
    if (daysSinceAccess < 7) return 0.7; // Last week
    if (daysSinceAccess < 30) return 0.4; // Last month
    return 0.2; // Older
  }

  /**
   * Get hot memory IDs (for use in pack command)
   */
  getHotMemoryIds(limit = 10): string[] {
    return this.getHotMemories({ limit }).map((e) => e.memoryId);
  }

  /**
   * Format heatmap for display
   */
  formatHeatmap(entries: HeatmapEntry[]): string {
    if (entries.length === 0) {
      return 'No frequently accessed memories yet.';
    }

    const lines: string[] = ['🔥 ACCESS HEATMAP', ''];

    const maxCount = Math.max(...entries.map((e) => e.accessCount));

    entries.forEach((entry, i) => {
      const flames = this.getFlameEmoji(entry.accessCount, maxCount);
      const codeRef =
        entry.codeRefs.length > 0 ? ` [${entry.codeRefs.slice(0, 2).join(', ')}]` : '';
      const truncatedContent =
        entry.content.length > 60 ? entry.content.substring(0, 57) + '...' : entry.content;

      lines.push(`${i + 1}. ${flames} (${entry.accessCount}) ${truncatedContent}${codeRef}`);
    });

    return lines.join('\n');
  }

  /**
   * Get flame emoji based on access count relative to max
   */
  private getFlameEmoji(count: number, maxCount: number): string {
    const ratio = count / maxCount;
    if (ratio >= 0.8) return '🔥🔥🔥';
    if (ratio >= 0.5) return '🔥🔥 ';
    if (ratio >= 0.3) return '🔥  ';
    return '   ';
  }
}

/**
 * Factory function
 */
export function createAccessHeatmap(db: Database): AccessHeatmap {
  return new AccessHeatmap(db);
}
