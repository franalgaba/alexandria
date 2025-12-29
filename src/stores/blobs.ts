/**
 * Blob storage for large payloads
 */

import type { Database } from 'bun:sqlite';
import type { Blob, BlobRow } from '../types/events.ts';
import { generateId } from '../utils/id.ts';

export class BlobStore {
  constructor(private db: Database) {}

  /**
   * Store a blob and return its ID
   */
  store(content: string | Uint8Array): string {
    const id = generateId();
    const buffer = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;

    this.db
      .query(`
      INSERT INTO blobs (id, content, size, created_at)
      VALUES ($id, $content, $size, $createdAt)
    `)
      .run({
        $id: id,
        $content: buffer,
        $size: buffer.length,
        $createdAt: new Date().toISOString(),
      });

    return id;
  }

  /**
   * Get a blob by ID
   */
  get(id: string): Blob | null {
    const row = this.db
      .query(`
      SELECT * FROM blobs WHERE id = $id
    `)
      .get({ $id: id }) as BlobRow | null;

    if (!row) return null;

    return this.rowToBlob(row);
  }

  /**
   * Get blob content as string
   */
  getContent(id: string): string | null {
    const blob = this.get(id);
    if (!blob) return null;
    return Buffer.from(blob.content).toString('utf-8');
  }

  /**
   * Delete a blob
   */
  delete(id: string): boolean {
    const result = this.db
      .query(`
      DELETE FROM blobs WHERE id = $id
    `)
      .run({ $id: id });

    return result.changes > 0;
  }

  /**
   * Get total blob storage size
   */
  getTotalSize(): number {
    const row = this.db
      .query(`
      SELECT SUM(size) as total FROM blobs
    `)
      .get() as { total: number | null };

    return row.total ?? 0;
  }

  /**
   * Clean up orphaned blobs (not referenced by any event)
   */
  cleanOrphaned(): number {
    const result = this.db
      .query(`
      DELETE FROM blobs 
      WHERE id NOT IN (SELECT blob_id FROM events WHERE blob_id IS NOT NULL)
    `)
      .run();

    return result.changes;
  }

  private rowToBlob(row: BlobRow): Blob {
    return {
      id: row.id,
      content: row.content,
      size: row.size,
      createdAt: new Date(row.created_at),
    };
  }
}
