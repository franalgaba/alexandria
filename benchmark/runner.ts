/**
 * Benchmark runner - evaluates Alexandria retrieval quality
 */

import type { Database } from 'bun:sqlite';
import { getMemoryConnection } from '../src/stores/connection.ts';
import { MemoryObjectStore } from '../src/stores/memory-objects.ts';
import { HybridSearch } from '../src/retriever/hybrid-search.ts';
import { VectorIndex } from '../src/indexes/vector.ts';
import type { MemoryObject } from '../src/types/memory-objects.ts';
import type {
  BenchmarkDataset,
  BenchmarkMemory,
  BenchmarkQuery,
  BenchmarkResults,
  QueryMetrics,
} from './types.ts';

interface RunnerConfig {
  /** Search mode to use */
  searchMode: 'hybrid' | 'lexical' | 'vector';
  /** Whether to use strength scoring */
  useStrengthScoring: boolean;
  /** Whether to use outcome scoring */
  useOutcomeScoring: boolean;
  /** Values of K for Precision@K and Recall@K */
  kValues: number[];
  /** Index embeddings for semantic search (slower but better) */
  indexEmbeddings?: boolean;
}

const DEFAULT_CONFIG: RunnerConfig = {
  searchMode: 'hybrid',
  useStrengthScoring: true,
  useOutcomeScoring: true,
  kValues: [1, 3, 5, 10],
  indexEmbeddings: false,
};

/**
 * Run benchmark on a dataset
 */
export async function runBenchmark(
  dataset: BenchmarkDataset,
  config: Partial<RunnerConfig> = {},
): Promise<BenchmarkResults> {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };

  // Create in-memory database for benchmark
  const db = getMemoryConnection();
  const store = new MemoryObjectStore(db);
  const search = new HybridSearch(db);
  const vectorIndex = new VectorIndex(db);

  // Load memories into database
  const memoryIdMap = new Map<string, string>();
  for (const mem of dataset.memories) {
    const created = loadBenchmarkMemory(store, mem);
    memoryIdMap.set(mem.id, created.id);

    // Index embeddings for semantic search if requested
    if (fullConfig.indexEmbeddings) {
      await vectorIndex.indexObject(created.id, created.content);
    }
  }

  // Run queries and collect metrics
  const queryMetrics: QueryMetrics[] = [];
  const latencies: number[] = [];

  for (const query of dataset.queries) {
    const metrics = await runQuery(
      search,
      query,
      memoryIdMap,
      fullConfig,
    );
    queryMetrics.push(metrics);
    latencies.push(metrics.latencyMs);
  }

  // Calculate aggregate metrics
  const results = aggregateMetrics(
    dataset.name,
    queryMetrics,
    latencies,
    fullConfig,
  );

  return results;
}

/**
 * Load a benchmark memory into the store
 */
function loadBenchmarkMemory(
  store: MemoryObjectStore,
  mem: BenchmarkMemory,
): MemoryObject {
  const codeRefs = (mem.codeRefs || []).map((path) => ({
    path,
    type: 'file' as const,
  }));

  const created = store.create({
    content: mem.content,
    objectType: mem.objectType,
    codeRefs,
  });

  // Set expected strength/outcome if specified
  if (mem.expectedStrength !== undefined || mem.expectedOutcome !== undefined) {
    store.update(created.id, {
      strength: mem.expectedStrength ?? 1.0,
      outcomeScore: mem.expectedOutcome ?? 0.5,
    });
  }

  return store.get(created.id)!;
}

/**
 * Run a single query and calculate metrics
 */
async function runQuery(
  search: HybridSearch,
  query: BenchmarkQuery,
  memoryIdMap: Map<string, string>,
  config: RunnerConfig,
): Promise<QueryMetrics> {
  const startTime = performance.now();

  const searchOptions = {
    limit: 20,
    skipStrengthScoring: !config.useStrengthScoring,
    skipReinforcement: true, // Always skip for benchmarking
  };

  // Execute search
  let results;
  switch (config.searchMode) {
    case 'lexical':
      results = search.searchLexical(query.query, searchOptions);
      break;
    case 'vector':
      results = await search.searchVector(query.query, searchOptions);
      break;
    default:
      results = await search.search(query.query, searchOptions);
  }

  const latencyMs = performance.now() - startTime;

  // Map returned IDs back to benchmark IDs
  const returnedIds: string[] = [];
  const benchmarkIdToDbId = new Map(
    Array.from(memoryIdMap.entries()).map(([bId, dbId]) => [dbId, bId]),
  );

  for (const result of results) {
    const benchmarkId = benchmarkIdToDbId.get(result.object.id);
    if (benchmarkId) {
      returnedIds.push(benchmarkId);
    }
  }

  // Calculate metrics
  const relevantSet = new Set(query.relevantMemoryIds);
  const grades = query.relevanceGrades || {};

  // Precision@K and Recall@K
  const precisionAtK: Record<number, number> = {};
  const recallAtK: Record<number, number> = {};

  for (const k of config.kValues) {
    const topK = returnedIds.slice(0, k);
    const relevantInTopK = topK.filter((id) => relevantSet.has(id)).length;

    precisionAtK[k] = topK.length > 0 ? relevantInTopK / topK.length : 0;
    recallAtK[k] = relevantSet.size > 0 ? relevantInTopK / relevantSet.size : 0;
  }

  // MRR (Mean Reciprocal Rank)
  let mrr = 0;
  for (let i = 0; i < returnedIds.length; i++) {
    if (relevantSet.has(returnedIds[i])) {
      mrr = 1 / (i + 1);
      break;
    }
  }

  // NDCG (Normalized Discounted Cumulative Gain)
  const ndcg = calculateNDCG(returnedIds, grades, query.relevantMemoryIds);

  return {
    queryId: query.id,
    precisionAtK,
    recallAtK,
    mrr,
    ndcg,
    relevantFound: returnedIds.filter((id) => relevantSet.has(id)).length,
    totalRelevant: relevantSet.size,
    returnedIds,
    latencyMs,
  };
}

/**
 * Calculate Normalized Discounted Cumulative Gain
 */
function calculateNDCG(
  returnedIds: string[],
  grades: Record<string, number>,
  relevantIds: string[],
): number {
  // DCG for returned results
  let dcg = 0;
  for (let i = 0; i < returnedIds.length; i++) {
    const grade = grades[returnedIds[i]] || 0;
    dcg += (Math.pow(2, grade) - 1) / Math.log2(i + 2);
  }

  // Ideal DCG (perfect ranking)
  const idealGrades = relevantIds
    .map((id) => grades[id] || 1)
    .sort((a, b) => b - a);

  let idcg = 0;
  for (let i = 0; i < idealGrades.length; i++) {
    idcg += (Math.pow(2, idealGrades[i]) - 1) / Math.log2(i + 2);
  }

  return idcg > 0 ? dcg / idcg : 0;
}

/**
 * Aggregate metrics across all queries
 */
function aggregateMetrics(
  datasetName: string,
  queryMetrics: QueryMetrics[],
  latencies: number[],
  config: RunnerConfig,
): BenchmarkResults {
  const n = queryMetrics.length;

  // Mean Precision@K
  const meanPrecisionAtK: Record<number, number> = {};
  for (const k of config.kValues) {
    meanPrecisionAtK[k] =
      queryMetrics.reduce((sum, qm) => sum + qm.precisionAtK[k], 0) / n;
  }

  // Mean Recall@K
  const meanRecallAtK: Record<number, number> = {};
  for (const k of config.kValues) {
    meanRecallAtK[k] =
      queryMetrics.reduce((sum, qm) => sum + qm.recallAtK[k], 0) / n;
  }

  // Mean MRR
  const meanMRR = queryMetrics.reduce((sum, qm) => sum + qm.mrr, 0) / n;

  // Mean NDCG
  const meanNDCG = queryMetrics.reduce((sum, qm) => sum + qm.ndcg, 0) / n;

  // Latency stats
  const sortedLatencies = [...latencies].sort((a, b) => a - b);
  const avgLatencyMs = latencies.reduce((a, b) => a + b, 0) / n;
  const p95Index = Math.floor(n * 0.95);
  const p95LatencyMs = sortedLatencies[p95Index] || sortedLatencies[n - 1];

  return {
    datasetName,
    runAt: new Date().toISOString(),
    config: {
      searchMode: config.searchMode,
      useStrengthScoring: config.useStrengthScoring,
      useOutcomeScoring: config.useOutcomeScoring,
    },
    queryCount: n,
    meanPrecisionAtK,
    meanRecallAtK,
    meanMRR,
    meanNDCG,
    avgLatencyMs,
    p95LatencyMs,
    queryMetrics,
  };
}

/**
 * Format results for console output
 */
export function formatResults(results: BenchmarkResults): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(`=== Benchmark Results: ${results.datasetName} ===`);
  lines.push(`Run at: ${results.runAt}`);
  lines.push(`Queries: ${results.queryCount}`);
  lines.push('');

  lines.push('Configuration:');
  lines.push(`  Search mode: ${results.config.searchMode}`);
  lines.push(`  Strength scoring: ${results.config.useStrengthScoring}`);
  lines.push(`  Outcome scoring: ${results.config.useOutcomeScoring}`);
  lines.push('');

  lines.push('Precision@K:');
  for (const [k, v] of Object.entries(results.meanPrecisionAtK)) {
    lines.push(`  P@${k}: ${(v * 100).toFixed(1)}%`);
  }
  lines.push('');

  lines.push('Recall@K:');
  for (const [k, v] of Object.entries(results.meanRecallAtK)) {
    lines.push(`  R@${k}: ${(v * 100).toFixed(1)}%`);
  }
  lines.push('');

  lines.push('Ranking Metrics:');
  lines.push(`  MRR: ${results.meanMRR.toFixed(3)}`);
  lines.push(`  NDCG: ${results.meanNDCG.toFixed(3)}`);
  lines.push('');

  lines.push('Latency:');
  lines.push(`  Avg: ${results.avgLatencyMs.toFixed(1)}ms`);
  lines.push(`  P95: ${results.p95LatencyMs.toFixed(1)}ms`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Compare two benchmark results
 */
export function compareResults(
  baseline: BenchmarkResults,
  experiment: BenchmarkResults,
): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('=== Comparison ===');
  lines.push(`Baseline: ${baseline.config.searchMode} (strength=${baseline.config.useStrengthScoring})`);
  lines.push(`Experiment: ${experiment.config.searchMode} (strength=${experiment.config.useStrengthScoring})`);
  lines.push('');

  lines.push('Precision@K diff:');
  for (const k of Object.keys(baseline.meanPrecisionAtK)) {
    const diff = experiment.meanPrecisionAtK[Number(k)] - baseline.meanPrecisionAtK[Number(k)];
    const sign = diff >= 0 ? '+' : '';
    lines.push(`  P@${k}: ${sign}${(diff * 100).toFixed(1)}%`);
  }
  lines.push('');

  lines.push('Recall@K diff:');
  for (const k of Object.keys(baseline.meanRecallAtK)) {
    const diff = experiment.meanRecallAtK[Number(k)] - baseline.meanRecallAtK[Number(k)];
    const sign = diff >= 0 ? '+' : '';
    lines.push(`  R@${k}: ${sign}${(diff * 100).toFixed(1)}%`);
  }
  lines.push('');

  const mrrDiff = experiment.meanMRR - baseline.meanMRR;
  const ndcgDiff = experiment.meanNDCG - baseline.meanNDCG;
  lines.push(`MRR diff: ${mrrDiff >= 0 ? '+' : ''}${mrrDiff.toFixed(3)}`);
  lines.push(`NDCG diff: ${ndcgDiff >= 0 ? '+' : ''}${ndcgDiff.toFixed(3)}`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Run a strength/outcome impact test
 *
 * This test simulates a scenario where relevant memories have high strength/outcome
 * and irrelevant memories have low strength/outcome. This shows how the scoring
 * can improve ranking when we have meaningful strength/outcome data.
 */
export async function runStrengthImpactTest(
  dataset: BenchmarkDataset,
): Promise<{ withScoring: BenchmarkResults; withoutScoring: BenchmarkResults; analysis: string }> {
  // Create database with memories where relevant ones are "helpful" and others are "stale"
  const db = getMemoryConnection();
  const store = new MemoryObjectStore(db);
  const search = new HybridSearch(db);

  // Build set of relevant memory IDs across all queries
  const allRelevantIds = new Set<string>();
  for (const query of dataset.queries) {
    for (const id of query.relevantMemoryIds) {
      allRelevantIds.add(id);
    }
  }

  // Load memories with strength/outcome based on relevance
  const memoryIdMap = new Map<string, string>();
  for (const mem of dataset.memories) {
    const codeRefs = (mem.codeRefs || []).map((path) => ({
      path,
      type: 'file' as const,
    }));

    const created = store.create({
      content: mem.content,
      objectType: mem.objectType,
      codeRefs,
    });

    // Set strength/outcome based on whether this memory is relevant
    const isRelevant = allRelevantIds.has(mem.id);
    store.update(created.id, {
      strength: isRelevant ? 1.0 : 0.3, // Relevant = strong, irrelevant = decayed
      outcomeScore: isRelevant ? 0.9 : 0.2, // Relevant = helpful, irrelevant = unhelpful
    });

    memoryIdMap.set(mem.id, created.id);
  }

  // Run without strength scoring
  const withoutConfig: RunnerConfig = {
    searchMode: 'hybrid',
    useStrengthScoring: false,
    useOutcomeScoring: false,
    kValues: [1, 3, 5, 10],
  };

  const withoutMetrics: QueryMetrics[] = [];
  for (const query of dataset.queries) {
    const metrics = await runQueryWithDb(search, query, memoryIdMap, withoutConfig);
    withoutMetrics.push(metrics);
  }
  const withoutScoring = aggregateMetrics(
    dataset.name + ' (no strength scoring)',
    withoutMetrics,
    withoutMetrics.map((m) => m.latencyMs),
    withoutConfig,
  );

  // Now enable strength scoring and re-run
  // Note: We need a fresh search to not have reinforcement from previous run
  const db2 = getMemoryConnection();
  const store2 = new MemoryObjectStore(db2);
  const search2 = new HybridSearch(db2);

  // Reload memories with same strength/outcome values
  const memoryIdMap2 = new Map<string, string>();
  for (const mem of dataset.memories) {
    const codeRefs = (mem.codeRefs || []).map((path) => ({
      path,
      type: 'file' as const,
    }));

    const created = store2.create({
      content: mem.content,
      objectType: mem.objectType,
      codeRefs,
    });

    const isRelevant = allRelevantIds.has(mem.id);
    store2.update(created.id, {
      strength: isRelevant ? 1.0 : 0.3,
      outcomeScore: isRelevant ? 0.9 : 0.2,
    });

    memoryIdMap2.set(mem.id, created.id);
  }

  const withConfig: RunnerConfig = {
    searchMode: 'hybrid',
    useStrengthScoring: true,
    useOutcomeScoring: true,
    kValues: [1, 3, 5, 10],
  };

  const withMetrics: QueryMetrics[] = [];
  for (const query of dataset.queries) {
    const metrics = await runQueryWithDb(search2, query, memoryIdMap2, withConfig);
    withMetrics.push(metrics);
  }
  const withScoring = aggregateMetrics(
    dataset.name + ' (with strength scoring)',
    withMetrics,
    withMetrics.map((m) => m.latencyMs),
    withConfig,
  );

  // Generate analysis
  const analysis = generateStrengthAnalysis(withoutScoring, withScoring);

  return { withScoring, withoutScoring, analysis };
}

/**
 * Run query with a specific database/search instance
 */
async function runQueryWithDb(
  search: HybridSearch,
  query: BenchmarkQuery,
  memoryIdMap: Map<string, string>,
  config: RunnerConfig,
): Promise<QueryMetrics> {
  const startTime = performance.now();

  const results = await search.search(query.query, {
    limit: 20,
    skipStrengthScoring: !config.useStrengthScoring,
    skipReinforcement: true, // Always skip for benchmarking
  });
  const latencyMs = performance.now() - startTime;

  // Map returned IDs back to benchmark IDs
  const returnedIds: string[] = [];
  const benchmarkIdToDbId = new Map(
    Array.from(memoryIdMap.entries()).map(([bId, dbId]) => [dbId, bId]),
  );

  for (const result of results) {
    const benchmarkId = benchmarkIdToDbId.get(result.object.id);
    if (benchmarkId) {
      returnedIds.push(benchmarkId);
    }
  }

  // Calculate metrics
  const relevantSet = new Set(query.relevantMemoryIds);
  const grades = query.relevanceGrades || {};

  const precisionAtK: Record<number, number> = {};
  const recallAtK: Record<number, number> = {};

  for (const k of config.kValues) {
    const topK = returnedIds.slice(0, k);
    const relevantInTopK = topK.filter((id) => relevantSet.has(id)).length;

    precisionAtK[k] = topK.length > 0 ? relevantInTopK / topK.length : 0;
    recallAtK[k] = relevantSet.size > 0 ? relevantInTopK / relevantSet.size : 0;
  }

  let mrr = 0;
  for (let i = 0; i < returnedIds.length; i++) {
    if (relevantSet.has(returnedIds[i])) {
      mrr = 1 / (i + 1);
      break;
    }
  }

  const ndcg = calculateNDCG(returnedIds, grades, query.relevantMemoryIds);

  return {
    queryId: query.id,
    precisionAtK,
    recallAtK,
    mrr,
    ndcg,
    relevantFound: returnedIds.filter((id) => relevantSet.has(id)).length,
    totalRelevant: relevantSet.size,
    returnedIds,
    latencyMs,
  };
}

/**
 * Generate analysis of strength scoring impact
 */
function generateStrengthAnalysis(
  without: BenchmarkResults,
  withScoring: BenchmarkResults,
): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('=== Strength/Outcome Scoring Impact Analysis ===');
  lines.push('');
  lines.push('Scenario: Relevant memories have high strength (1.0) and helpful outcomes (0.9)');
  lines.push('          Irrelevant memories have low strength (0.3) and unhelpful outcomes (0.2)');
  lines.push('');

  lines.push('Without scoring:');
  lines.push(`  P@1: ${(without.meanPrecisionAtK[1] * 100).toFixed(1)}%`);
  lines.push(`  MRR: ${without.meanMRR.toFixed(3)}`);
  lines.push(`  NDCG: ${without.meanNDCG.toFixed(3)}`);
  lines.push('');

  lines.push('With scoring:');
  lines.push(`  P@1: ${(withScoring.meanPrecisionAtK[1] * 100).toFixed(1)}%`);
  lines.push(`  MRR: ${withScoring.meanMRR.toFixed(3)}`);
  lines.push(`  NDCG: ${withScoring.meanNDCG.toFixed(3)}`);
  lines.push('');

  const p1Diff = withScoring.meanPrecisionAtK[1] - without.meanPrecisionAtK[1];
  const mrrDiff = withScoring.meanMRR - without.meanMRR;
  const ndcgDiff = withScoring.meanNDCG - without.meanNDCG;

  lines.push('Improvement:');
  lines.push(`  P@1: ${p1Diff >= 0 ? '+' : ''}${(p1Diff * 100).toFixed(1)}%`);
  lines.push(`  MRR: ${mrrDiff >= 0 ? '+' : ''}${mrrDiff.toFixed(3)}`);
  lines.push(`  NDCG: ${ndcgDiff >= 0 ? '+' : ''}${ndcgDiff.toFixed(3)}`);
  lines.push('');

  if (mrrDiff > 0.05 || p1Diff > 0.05) {
    lines.push('Conclusion: Strength/outcome scoring provides meaningful ranking improvement');
    lines.push('            when memories have diverse strength and outcome values.');
  } else {
    lines.push('Conclusion: Impact is minimal in this test case.');
  }
  lines.push('');

  return lines.join('\n');
}
