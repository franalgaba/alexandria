/**
 * Benchmark types for Alexandria retrieval quality evaluation
 */

import type { ObjectType } from '../src/types/memory-objects.ts';

/**
 * A memory in the benchmark dataset
 */
export interface BenchmarkMemory {
  id: string;
  content: string;
  objectType: ObjectType;
  /** Topics/tags for grouping and relevance matching */
  topics: string[];
  /** Code references for grounding */
  codeRefs?: string[];
  /** Expected strength (for testing decay) */
  expectedStrength?: number;
  /** Expected outcome score (for testing helpfulness) */
  expectedOutcome?: number;
}

/**
 * A test query with expected relevant memories
 */
export interface BenchmarkQuery {
  id: string;
  query: string;
  /** IDs of memories that should be returned */
  relevantMemoryIds: string[];
  /** Relevance grades: 3=highly relevant, 2=relevant, 1=marginally relevant */
  relevanceGrades?: Record<string, number>;
  /** Expected memory types in results */
  expectedTypes?: ObjectType[];
  /** Topic being queried */
  topic?: string;
}

/**
 * Complete benchmark dataset
 */
export interface BenchmarkDataset {
  name: string;
  description: string;
  memories: BenchmarkMemory[];
  queries: BenchmarkQuery[];
  metadata?: {
    createdAt: string;
    version: string;
  };
}

/**
 * Metrics for a single query
 */
export interface QueryMetrics {
  queryId: string;
  /** Precision at K (what % of top K results are relevant) */
  precisionAtK: Record<number, number>;
  /** Recall at K (what % of relevant memories are in top K) */
  recallAtK: Record<number, number>;
  /** Mean Reciprocal Rank (1/rank of first relevant result) */
  mrr: number;
  /** Normalized Discounted Cumulative Gain */
  ndcg: number;
  /** Number of relevant memories found */
  relevantFound: number;
  /** Total relevant memories expected */
  totalRelevant: number;
  /** IDs of returned memories */
  returnedIds: string[];
  /** Time taken in ms */
  latencyMs: number;
}

/**
 * Aggregate metrics across all queries
 */
export interface BenchmarkResults {
  datasetName: string;
  runAt: string;
  config: {
    searchMode: 'hybrid' | 'lexical' | 'vector';
    useStrengthScoring: boolean;
    useOutcomeScoring: boolean;
  };
  /** Number of queries */
  queryCount: number;
  /** Mean precision at each K */
  meanPrecisionAtK: Record<number, number>;
  /** Mean recall at each K */
  meanRecallAtK: Record<number, number>;
  /** Mean Reciprocal Rank across all queries */
  meanMRR: number;
  /** Mean NDCG across all queries */
  meanNDCG: number;
  /** Average latency in ms */
  avgLatencyMs: number;
  /** P95 latency in ms */
  p95LatencyMs: number;
  /** Per-query metrics */
  queryMetrics: QueryMetrics[];
}
