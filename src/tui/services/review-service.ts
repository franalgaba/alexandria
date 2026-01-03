/**
 * Review Queue Service
 *
 * Provides pending memory review data for the TUI.
 */

import type { Database } from 'bun:sqlite';
import { MemoryObjectStore } from '../../stores/memory-objects.ts';
import type { MemoryObject } from '../../types/memory-objects.ts';
import type { ReviewQueueItem } from '../../types/retriever.ts';

// Review actions
export type ReviewAction = 'approve' | 'edit' | 'merge' | 'supersede' | 'reject' | 'skip';

export class ReviewService {
  private db: Database | null = null;
  private store: MemoryObjectStore | null = null;

  /**
   * Initialize with database connection
   */
  initialize(db: Database): void {
    this.db = db;
    this.store = new MemoryObjectStore(db);
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return this.store !== null;
  }

  /**
   * Get pending memories for review
   */
  getPendingItems(limit: number = 20): MemoryObject[] {
    if (!this.store) return [];

    try {
      return this.store.list({
        reviewStatus: 'pending',
        limit,
      });
    } catch {
      return [];
    }
  }

  /**
   * Get count of pending items
   */
  getPendingCount(): number {
    if (!this.store) return 0;

    try {
      return this.store.list({ reviewStatus: 'pending' }).length;
    } catch {
      return 0;
    }
  }

  /**
   * Build review queue items with suggestions
   */
  async getReviewQueue(limit: number = 20): Promise<ReviewQueueItem[]> {
    const pending = this.getPendingItems(limit);

    return pending.map((obj) => {
      // Determine suggested action based on content/metadata
      let suggestedAction: ReviewAction = 'approve';
      let reason = 'Memory looks complete and valid';

      // Check content quality
      if (obj.content.length < 20) {
        suggestedAction = 'edit';
        reason = 'Content is too brief - consider expanding';
      } else if (obj.content.length > 500) {
        suggestedAction = 'edit';
        reason = 'Content is very long - consider summarizing';
      }

      // Check confidence
      if (obj.confidenceTier === 'hypothesis') {
        suggestedAction = 'reject';
        reason = 'Low confidence - no evidence to support';
      }

      return {
        object: obj,
        suggestedAction,
        reason,
        similarObjects: [], // TODO: Find similar objects
      };
    });
  }

  /**
   * Approve a memory
   */
  approve(id: string): boolean {
    if (!this.store) return false;

    try {
      const updated = this.store.update(id, {
        reviewStatus: 'approved',
        reviewedAt: new Date(),
      });
      return updated !== null;
    } catch {
      return false;
    }
  }

  /**
   * Reject a memory
   */
  reject(id: string): boolean {
    if (!this.store) return false;

    try {
      const updated = this.store.update(id, {
        reviewStatus: 'rejected',
        reviewedAt: new Date(),
        status: 'retired',
      });
      return updated !== null;
    } catch {
      return false;
    }
  }

  /**
   * Edit a memory's content
   */
  edit(id: string, newContent: string): boolean {
    if (!this.store) return false;

    try {
      const updated = this.store.update(id, {
        content: newContent,
        reviewStatus: 'approved',
        reviewedAt: new Date(),
      });
      return updated !== null;
    } catch {
      return false;
    }
  }

  /**
   * Skip a memory (leave as pending)
   */
  skip(_id: string): boolean {
    // No-op for skip - just move to next
    return true;
  }

  /**
   * Process a review action
   */
  async processAction(
    id: string,
    action: ReviewAction,
    options?: { newContent?: string; mergeWith?: string[]; supersedeId?: string },
  ): Promise<boolean> {
    switch (action) {
      case 'approve':
        return this.approve(id);
      case 'reject':
        return this.reject(id);
      case 'edit':
        if (options?.newContent) {
          return this.edit(id, options.newContent);
        }
        return false;
      case 'skip':
        return this.skip(id);
      case 'merge':
        // TODO: Implement merge
        return this.approve(id);
      case 'supersede':
        // TODO: Implement supersede
        return this.approve(id);
      default:
        return false;
    }
  }

  /**
   * Cleanup
   */
  cleanup(): void {
    this.store = null;
    this.db = null;
  }
}

// Singleton instance
export const reviewService = new ReviewService();
