/**
 * Superseder - automatically detect and supersede outdated objects
 */

import type { Database } from 'bun:sqlite';
import { cosineSimilarity, generateEmbedding } from '../indexes/embeddings.ts';
import { FTSIndex } from '../indexes/fts.ts';
import { VectorIndex } from '../indexes/vector.ts';
import { MemoryObjectStore } from '../stores/memory-objects.ts';
import type { MemoryObject } from '../types/memory-objects.ts';

// Similarity threshold for considering supersession
const SUPERSESSION_THRESHOLD = 0.8;

// Keywords that suggest contradiction/update
const CONTRADICTION_KEYWORDS = [
  'instead',
  'now',
  'actually',
  'no longer',
  'changed',
  'updated',
  'switched',
  'replaced',
  'not anymore',
  'fixed',
  'resolved',
];

// Keywords that suggest the new object is about the same topic
const TOPIC_KEYWORDS = ['same', 'still', 'also', 'related', 'similar', 'like', 'same thing'];

export interface SupersessionCandidate {
  oldObject: MemoryObject;
  newObject: MemoryObject;
  reason: string;
  confidence: number;
}

export class Superseder {
  private store: MemoryObjectStore;
  private fts: FTSIndex;
  private vector: VectorIndex;

  constructor(db: Database) {
    this.store = new MemoryObjectStore(db);
    this.fts = new FTSIndex(db);
    this.vector = new VectorIndex(db);
  }

  /**
   * Find objects that might be superseded by a new object
   */
  async findSupersessionCandidates(newObject: MemoryObject): Promise<SupersessionCandidate[]> {
    const candidates: SupersessionCandidate[] = [];

    // Search for similar active objects of the same type
    const ftsResults = this.fts.searchObjects(newObject.content, ['active'], 10);

    for (const result of ftsResults) {
      const oldObject = result.object;

      // Skip self
      if (oldObject.id === newObject.id) continue;

      // Must be same type for supersession
      if (oldObject.objectType !== newObject.objectType) continue;

      // Check if new object contradicts or updates old
      const analysis = await this.analyzeSupersession(oldObject, newObject);

      if (analysis.shouldSupersede) {
        candidates.push({
          oldObject,
          newObject,
          reason: analysis.reason,
          confidence: analysis.confidence,
        });
      }
    }

    return candidates;
  }

  /**
   * Analyze whether new object supersedes old
   */
  private async analyzeSupersession(
    oldObject: MemoryObject,
    newObject: MemoryObject,
  ): Promise<{ shouldSupersede: boolean; reason: string; confidence: number }> {
    // Calculate semantic similarity
    const [oldEmbed, newEmbed] = await Promise.all([
      generateEmbedding(oldObject.content),
      generateEmbedding(newObject.content),
    ]);
    const similarity = cosineSimilarity(oldEmbed, newEmbed);

    // If not similar enough, no supersession
    if (similarity < SUPERSESSION_THRESHOLD) {
      return { shouldSupersede: false, reason: '', confidence: 0 };
    }

    // Check for contradiction keywords in new content
    const hasContradiction = CONTRADICTION_KEYWORDS.some((kw) =>
      newObject.content.toLowerCase().includes(kw),
    );

    // Check for topic continuation
    const hasTopic = TOPIC_KEYWORDS.some((kw) => newObject.content.toLowerCase().includes(kw));

    // Heuristics for supersession
    let shouldSupersede = false;
    let reason = '';
    let confidence = similarity;

    // Failed attempt supersedes failed attempt if it's about the same thing
    if (oldObject.objectType === 'failed_attempt' && hasContradiction) {
      shouldSupersede = true;
      reason = 'New failure information supersedes old';
      confidence = similarity * 0.9;
    }

    // Known fix supersedes failed attempt
    if (oldObject.objectType === 'failed_attempt' && newObject.objectType === 'known_fix') {
      shouldSupersede = true;
      reason = 'Fix supersedes failed attempt';
      confidence = similarity;
    }

    // Decision supersedes decision if it contradicts
    if (oldObject.objectType === 'decision' && hasContradiction) {
      shouldSupersede = true;
      reason = 'New decision replaces old decision';
      confidence = similarity * 0.95;
    }

    // Environment supersedes environment if newer
    if (oldObject.objectType === 'environment') {
      // Check if new object has higher version numbers
      const oldVersions = oldObject.content.match(/\d+\.\d+(?:\.\d+)?/g) || [];
      const newVersions = newObject.content.match(/\d+\.\d+(?:\.\d+)?/g) || [];

      if (newVersions.length > 0 && oldVersions.length > 0) {
        // Simple version comparison
        const newVersion = newVersions[0];
        const oldVersion = oldVersions[0];
        if (newVersion && oldVersion && newVersion > oldVersion) {
          shouldSupersede = true;
          reason = 'Newer version information';
          confidence = similarity;
        }
      }
    }

    // If newer object is from more recent session, consider it more relevant
    if (newObject.createdAt > oldObject.createdAt && similarity > 0.9) {
      if (hasContradiction || hasTopic) {
        shouldSupersede = true;
        reason = reason || 'More recent, similar information';
        confidence = Math.max(confidence, similarity * 0.85);
      }
    }

    return { shouldSupersede, reason, confidence };
  }

  /**
   * Supersede an old object with a new one
   */
  supersede(oldId: string, newId: string): boolean {
    return this.store.supersede(oldId, newId);
  }

  /**
   * Find all stale objects (active but not accessed in a while)
   */
  findStaleObjects(daysThreshold = 30): MemoryObject[] {
    const threshold = new Date();
    threshold.setDate(threshold.getDate() - daysThreshold);

    const activeObjects = this.store.list({ status: ['active'] });

    return activeObjects.filter((obj) => {
      // If never accessed, check creation date
      const lastAccess = obj.lastAccessed || obj.createdAt;
      return lastAccess < threshold;
    });
  }

  /**
   * Mark objects as stale
   */
  markStale(ids: string[]): number {
    let count = 0;
    for (const id of ids) {
      if (this.store.markStale(id)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Auto-supersede based on analysis
   */
  async autoSupersede(newObject: MemoryObject): Promise<string[]> {
    const candidates = await this.findSupersessionCandidates(newObject);
    const superseded: string[] = [];

    for (const candidate of candidates) {
      // Only auto-supersede if confidence is high enough
      if (candidate.confidence >= 0.85) {
        this.supersede(candidate.oldObject.id, candidate.newObject.id);
        superseded.push(candidate.oldObject.id);
      }
    }

    return superseded;
  }
}
