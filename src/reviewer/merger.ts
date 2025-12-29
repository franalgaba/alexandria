/**
 * Merger - merge similar memory objects
 */

import type { Database } from 'bun:sqlite';
import { cosineSimilarity, generateEmbedding } from '../indexes/embeddings.ts';
import { FTSIndex } from '../indexes/fts.ts';
import { VectorIndex } from '../indexes/vector.ts';
import { MemoryObjectStore } from '../stores/memory-objects.ts';
import type { MemoryObject } from '../types/memory-objects.ts';

// Similarity thresholds
const FTS_MATCH_THRESHOLD = 0.5;
const VECTOR_SIMILARITY_THRESHOLD = 0.85;

export interface MergeCandidate {
  objects: MemoryObject[];
  similarity: number;
  suggestedContent: string;
}

export class Merger {
  private store: MemoryObjectStore;
  private fts: FTSIndex;
  private vector: VectorIndex;

  constructor(db: Database) {
    this.store = new MemoryObjectStore(db);
    this.fts = new FTSIndex(db);
    this.vector = new VectorIndex(db);
  }

  /**
   * Find similar objects to a given object
   */
  async findSimilar(object: MemoryObject, limit = 5): Promise<MemoryObject[]> {
    const similar: MemoryObject[] = [];
    const seen = new Set<string>([object.id]);

    // FTS similarity
    const ftsResults = this.fts.searchObjects(object.content, ['active'], limit * 2);
    for (const result of ftsResults) {
      if (!seen.has(result.object.id) && result.score > FTS_MATCH_THRESHOLD) {
        seen.add(result.object.id);
        similar.push(result.object);
      }
    }

    // Vector similarity
    try {
      const vectorResults = await this.vector.searchSimilarObjects(object.content, limit * 2);

      for (const result of vectorResults) {
        if (seen.has(result.id)) continue;

        // Convert distance to similarity (1 - distance for cosine)
        const similarity = 1 - result.distance;
        if (similarity > VECTOR_SIMILARITY_THRESHOLD) {
          const obj = this.store.get(result.id);
          if (obj && obj.status === 'active') {
            seen.add(result.id);
            similar.push(obj);
          }
        }
      }
    } catch (error) {
      console.debug('Vector similarity search failed:', error);
    }

    return similar.slice(0, limit);
  }

  /**
   * Find merge candidates among active objects
   */
  async findMergeCandidates(): Promise<MergeCandidate[]> {
    const candidates: MergeCandidate[] = [];
    const processed = new Set<string>();

    const activeObjects = this.store.list({ status: ['active'] });

    for (const obj of activeObjects) {
      if (processed.has(obj.id)) continue;

      const similar = await this.findSimilar(obj);

      if (similar.length > 0) {
        // Mark all as processed
        processed.add(obj.id);
        for (const s of similar) {
          processed.add(s.id);
        }

        // Calculate average similarity
        const allObjects = [obj, ...similar];
        const similarity = await this.calculateGroupSimilarity(allObjects);

        candidates.push({
          objects: allObjects,
          similarity,
          suggestedContent: this.suggestMergedContent(allObjects),
        });
      }
    }

    return candidates;
  }

  /**
   * Calculate average pairwise similarity for a group
   */
  private async calculateGroupSimilarity(objects: MemoryObject[]): Promise<number> {
    if (objects.length < 2) return 1;

    const embeddings = await Promise.all(objects.map((obj) => generateEmbedding(obj.content)));

    let totalSimilarity = 0;
    let comparisons = 0;

    for (let i = 0; i < embeddings.length; i++) {
      for (let j = i + 1; j < embeddings.length; j++) {
        totalSimilarity += cosineSimilarity(embeddings[i], embeddings[j]);
        comparisons++;
      }
    }

    return totalSimilarity / comparisons;
  }

  /**
   * Suggest merged content from a group of similar objects
   */
  private suggestMergedContent(objects: MemoryObject[]): string {
    // For now, use the longest content as the base
    // In the future, could use LLM to synthesize
    const sorted = [...objects].sort((a, b) => b.content.length - a.content.length);
    return sorted[0].content;
  }

  /**
   * Merge objects into a single new object
   */
  async merge(objectIds: string[], newContent?: string): Promise<MemoryObject | null> {
    const objects = objectIds.map((id) => this.store.get(id)).filter(Boolean) as MemoryObject[];

    if (objects.length < 2) return null;

    // Determine the best type and confidence
    const typeCounts = new Map<string, number>();
    const confidenceValues = { certain: 4, high: 3, medium: 2, low: 1 };
    let maxConfidence = 0;

    for (const obj of objects) {
      typeCounts.set(obj.objectType, (typeCounts.get(obj.objectType) || 0) + 1);
      maxConfidence = Math.max(maxConfidence, confidenceValues[obj.confidence]);
    }

    // Most common type
    const objectType = [...typeCounts.entries()].sort(
      (a, b) => b[1] - a[1],
    )[0][0] as MemoryObject['objectType'];

    // Highest confidence
    const confidence =
      (Object.entries(confidenceValues).find(
        ([_, v]) => v === maxConfidence,
      )?.[0] as MemoryObject['confidence']) || 'medium';

    // Collect all evidence
    const evidenceEventIds = [...new Set(objects.flatMap((o) => o.evidenceEventIds))];

    // Create merged content
    const content = newContent || this.suggestMergedContent(objects);

    // Create new merged object
    const merged = this.store.create({
      content,
      objectType,
      confidence,
      evidenceEventIds,
      reviewStatus: 'pending',
    });

    // Index the new object
    await this.vector.indexObject(merged.id, merged.content);

    // Supersede old objects
    for (const obj of objects) {
      this.store.supersede(obj.id, merged.id);
    }

    return merged;
  }
}
