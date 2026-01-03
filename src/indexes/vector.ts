/**
 * Vector index for semantic search
 * Uses in-memory storage as fallback when sqlite-vec is not available
 */

import type { Database } from 'bun:sqlite';
import { hasVectorSupport } from '../stores/connection.ts';
import { cosineSimilarity, generateEmbedding } from './embeddings.ts';

export interface VectorSearchResult {
  id: string;
  distance: number;
}

export class VectorIndex {
  private useNative: boolean;
  private memoryIndex: Map<string, Float32Array>;
  private objectMemoryIndex: Map<string, Float32Array>;

  constructor(private db: Database) {
    this.useNative = hasVectorSupport(db);
    this.memoryIndex = new Map();
    this.objectMemoryIndex = new Map();

    // Load existing embeddings into memory if not using native
    if (!this.useNative) {
      this.loadFromDb();
    }
  }

  /**
   * Index an event embedding
   */
  async indexEvent(eventId: string, content: string): Promise<void> {
    const embedding = await generateEmbedding(content);

    if (this.useNative) {
      this.storeNative('event_embeddings', 'event_id', eventId, embedding);
    } else {
      this.memoryIndex.set(eventId, embedding);
      this.storeInDb('event_embeddings_fallback', eventId, embedding);
    }
  }

  /**
   * Index a memory object embedding
   */
  async indexObject(objectId: string, content: string): Promise<void> {
    const embedding = await generateEmbedding(content);

    if (this.useNative) {
      this.storeNative('object_embeddings', 'object_id', objectId, embedding);
    } else {
      this.objectMemoryIndex.set(objectId, embedding);
      this.storeInDb('object_embeddings_fallback', objectId, embedding);
    }
  }

  /**
   * Search for similar events
   */
  async searchSimilarEvents(query: string, limit = 20): Promise<VectorSearchResult[]> {
    const queryEmbedding = await generateEmbedding(query);

    if (this.useNative) {
      return this.searchNative('event_embeddings', 'event_id', queryEmbedding, limit);
    }
    return this.searchMemory(this.memoryIndex, queryEmbedding, limit);
  }

  /**
   * Search for similar memory objects
   */
  async searchSimilarObjects(query: string, limit = 20): Promise<VectorSearchResult[]> {
    const queryEmbedding = await generateEmbedding(query);

    if (this.useNative) {
      return this.searchNative('object_embeddings', 'object_id', queryEmbedding, limit);
    }
    return this.searchMemory(this.objectMemoryIndex, queryEmbedding, limit);
  }

  /**
   * Delete event embedding
   */
  deleteEvent(eventId: string): void {
    if (this.useNative) {
      this.deleteNative('event_embeddings', 'event_id', eventId);
    } else {
      this.memoryIndex.delete(eventId);
      this.deleteFromDb('event_embeddings_fallback', eventId);
    }
  }

  /**
   * Delete object embedding
   */
  deleteObject(objectId: string): void {
    if (this.useNative) {
      this.deleteNative('object_embeddings', 'object_id', objectId);
    } else {
      this.objectMemoryIndex.delete(objectId);
      this.deleteFromDb('object_embeddings_fallback', objectId);
    }
  }

  /**
   * Check if vector search is available
   */
  isAvailable(): boolean {
    return true; // Always available, either native or fallback
  }

  /**
   * Check if using native sqlite-vec
   */
  isNative(): boolean {
    return this.useNative;
  }

  // --- Native sqlite-vec methods ---

  private storeNative(table: string, idCol: string, id: string, embedding: Float32Array): void {
    try {
      this.db
        .query(`
        INSERT OR REPLACE INTO ${table} (${idCol}, embedding)
        VALUES ($id, $embedding)
      `)
        .run({ $id: id, $embedding: embedding });
    } catch (error) {
      console.debug(`Failed to store embedding in ${table}:`, error);
    }
  }

  private searchNative(
    table: string,
    idCol: string,
    queryEmbedding: Float32Array,
    limit: number,
  ): VectorSearchResult[] {
    try {
      const rows = this.db
        .query(`
        SELECT ${idCol} as id, distance
        FROM ${table}
        WHERE embedding MATCH $embedding
          AND k = $limit
        ORDER BY distance
      `)
        .all({ $embedding: queryEmbedding, $limit: limit }) as { id: string; distance: number }[];

      return rows;
    } catch (error) {
      console.debug(`Native vector search failed for ${table}:`, error);
      return [];
    }
  }

  private deleteNative(table: string, idCol: string, id: string): void {
    try {
      this.db.query(`DELETE FROM ${table} WHERE ${idCol} = $id`).run({ $id: id });
    } catch (error) {
      console.debug(`Failed to delete from ${table}:`, error);
    }
  }

  // --- Fallback memory-based methods ---

  private searchMemory(
    index: Map<string, Float32Array>,
    queryEmbedding: Float32Array,
    limit: number,
  ): VectorSearchResult[] {
    const results: VectorSearchResult[] = [];

    for (const [id, embedding] of index) {
      const similarity = cosineSimilarity(queryEmbedding, embedding);
      // Convert similarity to distance (1 - similarity)
      const distance = 1 - similarity;
      results.push({ id, distance });
    }

    // Sort by distance (ascending) and take top results
    return results.sort((a, b) => a.distance - b.distance).slice(0, limit);
  }

  private loadFromDb(): void {
    // Create fallback tables if needed
    this.ensureFallbackTables();

    try {
      const eventRows = this.db
        .query(`
        SELECT id, embedding FROM event_embeddings_fallback
      `)
        .all() as { id: string; embedding: Uint8Array }[];

      for (const row of eventRows) {
        this.memoryIndex.set(row.id, new Float32Array(row.embedding.buffer));
      }

      const objectRows = this.db
        .query(`
        SELECT id, embedding FROM object_embeddings_fallback
      `)
        .all() as { id: string; embedding: Uint8Array }[];

      for (const row of objectRows) {
        this.objectMemoryIndex.set(row.id, new Float32Array(row.embedding.buffer));
      }
    } catch (error) {
      console.debug('Failed to load embeddings from fallback tables:', error);
    }
  }

  private ensureFallbackTables(): void {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS event_embeddings_fallback (
          id TEXT PRIMARY KEY,
          embedding BLOB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS object_embeddings_fallback (
          id TEXT PRIMARY KEY,
          embedding BLOB NOT NULL
        );
      `);
    } catch (error) {
      console.debug('Failed to create fallback tables:', error);
    }
  }

  private storeInDb(table: string, id: string, embedding: Float32Array): void {
    try {
      const buffer = Buffer.from(embedding.buffer);
      this.db
        .query(`
        INSERT OR REPLACE INTO ${table} (id, embedding)
        VALUES ($id, $embedding)
      `)
        .run({ $id: id, $embedding: buffer });
    } catch (error) {
      console.debug(`Failed to store in ${table}:`, error);
    }
  }

  private deleteFromDb(table: string, id: string): void {
    try {
      this.db.query(`DELETE FROM ${table} WHERE id = $id`).run({ $id: id });
    } catch (error) {
      console.debug(`Failed to delete from ${table}:`, error);
    }
  }
}
