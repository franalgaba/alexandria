/**
 * Cost Tracking Service
 *
 * Provides cost data from CostTracker for the TUI.
 */

import type { Database } from 'bun:sqlite';
import { CostTracker, type UsageSummary } from '../../utils/cost-tracker.ts';
import type { BudgetStatus } from '../state/types.ts';

export class CostService {
  private tracker: CostTracker | null = null;
  private db: Database | null = null;

  /**
   * Initialize with a database connection
   */
  initialize(db: Database): void {
    this.db = db;
    this.tracker = new CostTracker(db);
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return this.tracker !== null;
  }

  /**
   * Get session usage summary
   */
  getSessionSummary(): UsageSummary | null {
    if (!this.tracker) return null;
    try {
      return this.tracker.getSessionSummary();
    } catch {
      return null;
    }
  }

  /**
   * Get daily usage summary
   */
  getDailySummary(): UsageSummary | null {
    if (!this.tracker) return null;
    try {
      return this.tracker.getDailyUsage();
    } catch {
      return null;
    }
  }

  /**
   * Get budget status
   */
  getBudgetStatus(): BudgetStatus | null {
    if (!this.tracker) return null;
    try {
      return this.tracker.getBudgetStatus();
    } catch {
      return null;
    }
  }

  /**
   * Format cost for display
   */
  formatCost(cost: number): string {
    return CostTracker.formatCost(cost);
  }

  /**
   * Get summary string for status bar
   */
  getStatusBarSummary(): string {
    const daily = this.getDailySummary();
    if (!daily) return '';

    const cost = this.formatCost(daily.totalCost);
    return `${cost} today`;
  }

  /**
   * Get detailed breakdown for costs view
   */
  getDetailedBreakdown(): {
    byOperation: Record<string, { tokens: number; cost: number }>;
    byModel: Record<string, { tokens: number; cost: number }>;
    totals: { inputTokens: number; outputTokens: number; cost: number };
  } | null {
    const summary = this.getSessionSummary();
    if (!summary) return null;

    return {
      byOperation: summary.byOperation,
      byModel: summary.byModel,
      totals: {
        inputTokens: summary.totalInputTokens,
        outputTokens: summary.totalOutputTokens,
        cost: summary.totalCost,
      },
    };
  }

  /**
   * Clean up
   */
  cleanup(): void {
    this.tracker = null;
    this.db = null;
  }
}

// Singleton instance
export const costService = new CostService();
