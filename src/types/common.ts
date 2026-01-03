/**
 * Common types used across the Alexandria memory system
 */

export type ScopeType = 'global' | 'project' | 'module' | 'file';

export interface Scope {
  type: ScopeType;
  path?: string;
}

export interface SearchOptions {
  limit?: number;
  status?: string[];
  alpha?: number; // Weight for RRF fusion (0 = vector only, 1 = lexical only)
  objectType?: string;
  /** Skip strength/outcome scoring (for benchmarking) */
  skipStrengthScoring?: boolean;
  /** Skip reinforcement on access (for benchmarking) */
  skipReinforcement?: boolean;
}

export interface PackOptions {
  tokenBudget?: number;
  taskDescription?: string;
}
