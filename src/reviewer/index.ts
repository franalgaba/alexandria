/**
 * Reviewer pipeline - main entry point
 */

import type { Database } from 'bun:sqlite';
import { VectorIndex } from '../indexes/vector.ts';
import { MemoryObjectStore } from '../stores/memory-objects.ts';
import type { CodeReference } from '../types/code-refs.ts';
import type { MemoryCandidate, MemoryObject } from '../types/memory-objects.ts';
import { Extractor } from './extractor.ts';
import { Merger } from './merger.ts';
import { ReviewQueue } from './queue.ts';
import { Superseder } from './superseder.ts';

export interface ReviewPipelineResult {
  extracted: number;
  created: number;
  merged: number;
  superseded: number;
  queued: number;
}

export class ReviewPipeline {
  private store: MemoryObjectStore;
  private vector: VectorIndex;
  private extractor: Extractor;
  private merger: Merger;
  private superseder: Superseder;
  private queue: ReviewQueue;

  constructor(db: Database) {
    this.store = new MemoryObjectStore(db);
    this.vector = new VectorIndex(db);
    this.extractor = new Extractor(db);
    this.merger = new Merger(db);
    this.superseder = new Superseder(db);
    this.queue = new ReviewQueue(db);
  }

  /**
   * Run the full review pipeline on a session
   */
  async processSession(sessionId: string): Promise<ReviewPipelineResult> {
    const result: ReviewPipelineResult = {
      extracted: 0,
      created: 0,
      merged: 0,
      superseded: 0,
      queued: 0,
    };

    // 1. Extract candidates from session events
    const candidates = this.extractor.extractFromSession(sessionId);
    result.extracted = candidates.length;

    // 2. Create memory objects from candidates
    const created: MemoryObject[] = [];
    for (const candidate of candidates) {
      const obj = await this.createFromCandidate(candidate);
      created.push(obj);
      result.created++;
    }

    // 3. Auto-supersede old objects
    for (const obj of created) {
      const superseded = await this.superseder.autoSupersede(obj);
      result.superseded += superseded.length;
    }

    // 4. Find merge candidates
    const mergeCandidates = await this.merger.findMergeCandidates();

    // 5. Auto-merge high-similarity groups
    for (const mc of mergeCandidates) {
      if (mc.similarity > 0.9) {
        const ids = mc.objects.map((o) => o.id);
        const merged = await this.merger.merge(ids, mc.suggestedContent);
        if (merged) {
          result.merged++;
        }
      }
    }

    // 6. Queue remaining for review
    result.queued = this.queue.getPendingCount();

    return result;
  }

  /**
   * Create a memory object from a candidate
   */
  async createFromCandidate(candidate: MemoryCandidate): Promise<MemoryObject> {
    const obj = this.store.create({
      content: candidate.content,
      objectType: candidate.suggestedType,
      confidence: candidate.confidence,
      evidenceEventIds: candidate.evidenceEventIds,
      evidenceExcerpt: candidate.evidenceExcerpt,
      reviewStatus: 'pending',
    });

    // Index for vector search
    await this.vector.indexObject(obj.id, obj.content);

    return obj;
  }

  /**
   * Manually add a memory object
   */
  async addMemory(input: {
    content: string;
    type: MemoryObject['objectType'];
    confidence?: MemoryObject['confidence'];
    scope?: MemoryObject['scope'];
    autoApprove?: boolean;
    codeRefs?: CodeReference[];
  }): Promise<MemoryObject> {
    const obj = this.store.create({
      content: input.content,
      objectType: input.type,
      confidence: input.confidence ?? 'medium',
      scope: input.scope,
      reviewStatus: input.autoApprove ? 'approved' : 'pending',
      codeRefs: input.codeRefs,
    });

    // Index for vector search
    await this.vector.indexObject(obj.id, obj.content);

    // Auto-supersede if approved
    if (input.autoApprove) {
      await this.superseder.autoSupersede(obj);
    }

    return obj;
  }

  /**
   * Get the review queue
   */
  getQueue(): ReviewQueue {
    return this.queue;
  }

  /**
   * Get the extractor
   */
  getExtractor(): Extractor {
    return this.extractor;
  }

  /**
   * Get the merger
   */
  getMerger(): Merger {
    return this.merger;
  }

  /**
   * Get the superseder
   */
  getSuperseder(): Superseder {
    return this.superseder;
  }
}

// Re-export components
export { Extractor } from './extractor.ts';
export { Merger } from './merger.ts';
export { ReviewQueue } from './queue.ts';
export { Superseder } from './superseder.ts';
