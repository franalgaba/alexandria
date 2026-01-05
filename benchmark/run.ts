#!/usr/bin/env bun
/**
 * Benchmark CLI - run retrieval quality benchmarks
 *
 * Usage:
 *   bun benchmark/run.ts                    # Run with defaults
 *   bun benchmark/run.ts --mode lexical     # Lexical only
 *   bun benchmark/run.ts --no-strength      # Disable strength scoring
 *   bun benchmark/run.ts --compare          # Compare all modes
 *   bun benchmark/run.ts --strength-impact  # Test strength/outcome scoring impact
 */

import { generateDataset, getDatasetStats } from './dataset.ts';
import { compareResults, formatResults, runBenchmark, runStrengthImpactTest } from './runner.ts';

async function main() {
  const args = process.argv.slice(2);
  const mode = args.includes('--mode')
    ? args[args.indexOf('--mode') + 1]
    : 'hybrid';
  const useStrength = !args.includes('--no-strength');
  const compareAll = args.includes('--compare');
  const strengthImpact = args.includes('--strength-impact');
  const showDetails = args.includes('--details');
  const json = args.includes('--json');
  const indexEmbeddings = args.includes('--embeddings');

  // Generate dataset
  const dataset = generateDataset();
  const stats = getDatasetStats(dataset);

  if (!json) {
    console.log('');
    console.log('=== Alexandria Retrieval Benchmark ===');
    console.log('');
    console.log('Dataset Stats:');
    console.log(`  Memories: ${stats.memoryCount}`);
    console.log(`  Queries: ${stats.queryCount}`);
    console.log(`  Topics: ${stats.topicCount}`);
    console.log(`  Avg relevant per query: ${stats.avgRelevantPerQuery.toFixed(1)}`);
    console.log('');
    console.log('Type Distribution:');
    for (const [type, count] of Object.entries(stats.typeDistribution)) {
      console.log(`  ${type}: ${count}`);
    }
  }

  if (strengthImpact) {
    // Run strength/outcome impact test
    if (!json) {
      console.log('');
      console.log('Running strength/outcome scoring impact test...');
    }

    const { withScoring, withoutScoring, analysis } = await runStrengthImpactTest(dataset);

    if (json) {
      console.log(JSON.stringify({ withScoring, withoutScoring }, null, 2));
    } else {
      console.log(formatResults(withoutScoring));
      console.log(formatResults(withScoring));
      console.log(analysis);
    }
    return;
  }

  if (compareAll) {
    // Run all configurations and compare
    if (!json) {
      console.log('');
      console.log('Running benchmark with all configurations...');
    }

    const configs = [
      { searchMode: 'hybrid' as const, useStrengthScoring: false, useOutcomeScoring: false },
      { searchMode: 'hybrid' as const, useStrengthScoring: true, useOutcomeScoring: true },
      { searchMode: 'lexical' as const, useStrengthScoring: false, useOutcomeScoring: false },
      { searchMode: 'vector' as const, useStrengthScoring: false, useOutcomeScoring: false },
    ];

    const results = [];
    for (const config of configs) {
      const result = await runBenchmark(dataset, config);
      results.push(result);
      if (!json) {
        console.log(formatResults(result));
      }
    }

    if (json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      // Compare baseline (no strength) vs with strength
      console.log(compareResults(results[0], results[1]));
    }
  } else {
    // Single run
    if (!json) {
      console.log('');
      console.log(`Running benchmark (mode=${mode}, strength=${useStrength}, embeddings=${indexEmbeddings})...`);
      if (indexEmbeddings) {
        console.log('Note: Indexing embeddings will take a few seconds...');
      }
    }

    const searchMode = mode as 'hybrid' | 'lexical' | 'vector';
    const result = await runBenchmark(dataset, {
      searchMode,
      useStrengthScoring: useStrength,
      useOutcomeScoring: useStrength,
      indexEmbeddings,
    });

    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatResults(result));

      if (showDetails) {
        console.log('Per-Query Details:');
        for (const qm of result.queryMetrics) {
          const query = dataset.queries.find((q) => q.id === qm.queryId);
          console.log(`  ${qm.queryId}: "${query?.query.substring(0, 40)}..."`);
          console.log(`    Found: ${qm.relevantFound}/${qm.totalRelevant}, MRR: ${qm.mrr.toFixed(2)}, NDCG: ${qm.ndcg.toFixed(2)}`);
        }
      }
    }
  }
}

main().catch(console.error);
