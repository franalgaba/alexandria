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
}

export interface PackOptions {
  tokenBudget?: number;
  taskDescription?: string;
}
