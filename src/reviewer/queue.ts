/**
 * Review queue management
 */

import type { Database } from 'bun:sqlite';
import { MemoryObjectStore } from '../stores/memory-objects.ts';
import type { MemoryObject } from '../types/memory-objects.ts';
import type { ReviewQueueItem } from '../types/retriever.ts';
import { Merger } from './merger.ts';
import { Superseder } from './superseder.ts';

export type ReviewAction = 'approve' | 'edit' | 'merge' | 'supersede' | 'reject' | 'skip';

export class ReviewQueue {
  private store: MemoryObjectStore;
  private merger: Merger;
  private superseder: Superseder;

  constructor(db: Database) {
    this.store = new MemoryObjectStore(db);
    this.merger = new Merger(db);
    this.superseder = new Superseder(db);
  }

  /**
   * Get pending review items
   */
  async getPending(limit = 10): Promise<ReviewQueueItem[]> {
    const pending = this.store.getPendingReview(limit);
    const items: ReviewQueueItem[] = [];

    for (const obj of pending) {
      const item = await this.buildReviewItem(obj);
      items.push(item);
    }

    return items;
  }

  /**
   * Get pending count
   */
  getPendingCount(): number {
    return this.store.list({ reviewStatus: 'pending' }).length;
  }

  /**
   * Build a review queue item with suggestions
   */
  private async buildReviewItem(object: MemoryObject): Promise<ReviewQueueItem> {
    // Find similar objects
    const similarObjects = await this.merger.findSimilar(object);

    // Determine suggested action
    let suggestedAction: ReviewQueueItem['suggestedAction'] = 'approve';
    let reason = 'No issues detected';

    if (similarObjects.length > 0) {
      // Check for potential merge
      const highSimilarity = similarObjects.filter((s) => s.objectType === object.objectType);

      if (highSimilarity.length > 0) {
        suggestedAction = 'merge';
        reason = `Similar to ${highSimilarity.length} existing object(s)`;
      } else {
        suggestedAction = 'supersede';
        reason = `May supersede ${similarObjects.length} existing object(s)`;
      }
    }

    // Check content quality
    if (object.content.length < 20) {
      suggestedAction = 'edit';
      reason = 'Content too brief';
    }

    if (object.content.length > 500) {
      suggestedAction = 'edit';
      reason = 'Content too long, consider summarizing';
    }

    // Check for low confidence
    if (object.confidence === 'low') {
      suggestedAction = 'reject';
      reason = 'Low confidence, needs verification';
    }

    return {
      object,
      suggestedAction,
      reason,
      similarObjects: similarObjects.slice(0, 3),
    };
  }

  /**
   * Process a review action
   */
  async processReview(
    objectId: string,
    action: ReviewAction,
    options?: {
      newContent?: string;
      mergeWith?: string[];
      supersedeId?: string;
    },
  ): Promise<boolean> {
    const object = this.store.get(objectId);
    if (!object) return false;

    switch (action) {
      case 'approve':
        return this.store.approve(objectId);

      case 'edit':
        if (options?.newContent) {
          this.store.update(objectId, { content: options.newContent });
        }
        return this.store.approve(objectId);

      case 'merge':
        if (options?.mergeWith && options.mergeWith.length > 0) {
          const allIds = [objectId, ...options.mergeWith];
          const merged = await this.merger.merge(allIds, options.newContent);
          if (merged) {
            this.store.approve(merged.id);
            return true;
          }
        }
        return false;

      case 'supersede':
        if (options?.supersedeId) {
          this.superseder.supersede(options.supersedeId, objectId);
          return this.store.approve(objectId);
        }
        return false;

      case 'reject':
        return this.store.reject(objectId);

      case 'skip':
        // Do nothing, leave as pending
        return true;

      default:
        return false;
    }
  }

  /**
   * Auto-process items with high confidence suggestions
   */
  async autoProcess(_confidenceThreshold = 0.9): Promise<{ processed: number; skipped: number }> {
    const pending = await this.getPending(50);
    let processed = 0;
    let skipped = 0;

    for (const item of pending) {
      // Only auto-approve if the suggestion is approve
      if (item.suggestedAction === 'approve') {
        await this.processReview(item.object.id, 'approve');
        processed++;
      } else {
        skipped++;
      }
    }

    return { processed, skipped };
  }

  /**
   * Get stale objects that need review
   */
  getStaleForReview(limit = 10): MemoryObject[] {
    return this.superseder.findStaleObjects().slice(0, limit);
  }

  /**
   * Mark stale objects for re-review
   */
  markForReReview(ids: string[]): number {
    let count = 0;
    for (const id of ids) {
      const updated = this.store.update(id, { reviewStatus: 'pending' });
      if (updated) count++;
    }
    return count;
  }
}
