/**
 * Cost Tracker - Track LLM usage and costs
 *
 * Tracks:
 * - Token usage per session/operation
 * - Estimated costs based on model pricing
 * - Budget enforcement
 */

import type { Database } from 'bun:sqlite';

// Cost per 1K tokens (approximate, update as needed)
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'gpt-4': { input: 0.03, output: 0.06 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  'claude-3-opus': { input: 0.015, output: 0.075 },
  'claude-3-sonnet': { input: 0.003, output: 0.015 },
  'claude-3-haiku': { input: 0.00025, output: 0.00125 },
  local: { input: 0, output: 0 },
  default: { input: 0.001, output: 0.002 },
};

export interface UsageRecord {
  id: string;
  sessionId: string;
  operation: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  timestamp: Date;
}

export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  byOperation: Record<string, { tokens: number; cost: number }>;
  byModel: Record<string, { tokens: number; cost: number }>;
  recordCount: number;
}

export interface BudgetConfig {
  maxCostPerSession: number;
  maxCostPerDay: number;
  maxTokensPerSession: number;
  warnAtPercent: number;
}

const DEFAULT_BUDGET: BudgetConfig = {
  maxCostPerSession: 0.5, // $0.50 per session
  maxCostPerDay: 5.0, // $5 per day
  maxTokensPerSession: 50000, // 50K tokens per session
  warnAtPercent: 80, // Warn at 80% of budget
};

export class CostTracker {
  private db: Database;
  private budget: BudgetConfig;
  private currentSessionId: string | null = null;
  private sessionUsage: { inputTokens: number; outputTokens: number; cost: number } = {
    inputTokens: 0,
    outputTokens: 0,
    cost: 0,
  };

  constructor(db: Database, budget: Partial<BudgetConfig> = {}) {
    this.db = db;
    this.budget = { ...DEFAULT_BUDGET, ...budget };
    this.initTable();
  }

  private initTable(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS llm_usage (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        estimated_cost REAL NOT NULL,
        timestamp TEXT NOT NULL
      )
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_llm_usage_session ON llm_usage(session_id)
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_llm_usage_timestamp ON llm_usage(timestamp)
    `);
  }

  /**
   * Start tracking a session
   */
  startSession(sessionId: string): void {
    this.currentSessionId = sessionId;
    this.sessionUsage = { inputTokens: 0, outputTokens: 0, cost: 0 };
  }

  /**
   * Record LLM usage
   */
  record(
    operation: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
  ): { cost: number; budgetWarning?: string; budgetExceeded?: boolean } {
    const sessionId = this.currentSessionId || 'unknown';
    const cost = this.calculateCost(model, inputTokens, outputTokens);

    const id = `usage_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    this.db
      .query(
        `
      INSERT INTO llm_usage (id, session_id, operation, model, input_tokens, output_tokens, estimated_cost, timestamp)
      VALUES ($id, $sessionId, $operation, $model, $inputTokens, $outputTokens, $cost, $timestamp)
    `,
      )
      .run({
        $id: id,
        $sessionId: sessionId,
        $operation: operation,
        $model: model,
        $inputTokens: inputTokens,
        $outputTokens: outputTokens,
        $cost: cost,
        $timestamp: new Date().toISOString(),
      });

    // Update session totals
    this.sessionUsage.inputTokens += inputTokens;
    this.sessionUsage.outputTokens += outputTokens;
    this.sessionUsage.cost += cost;

    // Check budget
    const result: { cost: number; budgetWarning?: string; budgetExceeded?: boolean } = { cost };

    const sessionPercent = (this.sessionUsage.cost / this.budget.maxCostPerSession) * 100;
    const tokenPercent =
      ((this.sessionUsage.inputTokens + this.sessionUsage.outputTokens) /
        this.budget.maxTokensPerSession) *
      100;

    if (sessionPercent >= 100 || tokenPercent >= 100) {
      result.budgetExceeded = true;
      result.budgetWarning = `Session budget exceeded: $${this.sessionUsage.cost.toFixed(4)} / $${this.budget.maxCostPerSession}`;
    } else if (
      sessionPercent >= this.budget.warnAtPercent ||
      tokenPercent >= this.budget.warnAtPercent
    ) {
      result.budgetWarning = `Approaching session budget: ${Math.max(sessionPercent, tokenPercent).toFixed(0)}%`;
    }

    return result;
  }

  /**
   * Calculate cost for token usage
   */
  private calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = MODEL_COSTS[model] || MODEL_COSTS['default'];
    return (inputTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output;
  }

  /**
   * Get usage summary for current session
   */
  getSessionSummary(): UsageSummary {
    const sessionId = this.currentSessionId || 'unknown';
    return this.getSummary({ sessionId });
  }

  /**
   * Get usage summary with optional filters
   */
  getSummary(filters: { sessionId?: string; since?: Date } = {}): UsageSummary {
    let query = 'SELECT * FROM llm_usage WHERE 1=1';
    const params: Record<string, any> = {};

    if (filters.sessionId) {
      query += ' AND session_id = $sessionId';
      params.$sessionId = filters.sessionId;
    }

    if (filters.since) {
      query += ' AND timestamp >= $since';
      params.$since = filters.since.toISOString();
    }

    const rows = this.db.query(query).all(params) as any[];

    const summary: UsageSummary = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
      byOperation: {},
      byModel: {},
      recordCount: rows.length,
    };

    for (const row of rows) {
      summary.totalInputTokens += row.input_tokens;
      summary.totalOutputTokens += row.output_tokens;
      summary.totalCost += row.estimated_cost;

      // By operation
      if (!summary.byOperation[row.operation]) {
        summary.byOperation[row.operation] = { tokens: 0, cost: 0 };
      }
      summary.byOperation[row.operation].tokens += row.input_tokens + row.output_tokens;
      summary.byOperation[row.operation].cost += row.estimated_cost;

      // By model
      if (!summary.byModel[row.model]) {
        summary.byModel[row.model] = { tokens: 0, cost: 0 };
      }
      summary.byModel[row.model].tokens += row.input_tokens + row.output_tokens;
      summary.byModel[row.model].cost += row.estimated_cost;
    }

    return summary;
  }

  /**
   * Get daily usage
   */
  getDailyUsage(date: Date = new Date()): UsageSummary {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    return this.getSummary({ since: startOfDay });
  }

  /**
   * Check if operation is within budget
   */
  canProceed(estimatedTokens: number = 1000): { allowed: boolean; reason?: string } {
    const sessionTokens = this.sessionUsage.inputTokens + this.sessionUsage.outputTokens;

    if (sessionTokens + estimatedTokens > this.budget.maxTokensPerSession) {
      return {
        allowed: false,
        reason: `Would exceed session token limit (${sessionTokens + estimatedTokens} > ${this.budget.maxTokensPerSession})`,
      };
    }

    const dailyUsage = this.getDailyUsage();
    if (dailyUsage.totalCost >= this.budget.maxCostPerDay) {
      return {
        allowed: false,
        reason: `Daily budget exceeded ($${dailyUsage.totalCost.toFixed(2)} >= $${this.budget.maxCostPerDay})`,
      };
    }

    return { allowed: true };
  }

  /**
   * Get current budget status
   */
  getBudgetStatus(): {
    session: { used: number; limit: number; percent: number };
    daily: { used: number; limit: number; percent: number };
    tokens: { used: number; limit: number; percent: number };
  } {
    const dailyUsage = this.getDailyUsage();
    const sessionTokens = this.sessionUsage.inputTokens + this.sessionUsage.outputTokens;

    return {
      session: {
        used: this.sessionUsage.cost,
        limit: this.budget.maxCostPerSession,
        percent: (this.sessionUsage.cost / this.budget.maxCostPerSession) * 100,
      },
      daily: {
        used: dailyUsage.totalCost,
        limit: this.budget.maxCostPerDay,
        percent: (dailyUsage.totalCost / this.budget.maxCostPerDay) * 100,
      },
      tokens: {
        used: sessionTokens,
        limit: this.budget.maxTokensPerSession,
        percent: (sessionTokens / this.budget.maxTokensPerSession) * 100,
      },
    };
  }

  /**
   * Format cost for display
   */
  static formatCost(cost: number): string {
    if (cost < 0.01) {
      return `$${(cost * 100).toFixed(2)}¢`;
    }
    return `$${cost.toFixed(4)}`;
  }
}
