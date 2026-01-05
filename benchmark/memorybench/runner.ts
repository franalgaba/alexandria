#!/usr/bin/env bun
/**
 * Standalone memorybench runner for Alexandria
 *
 * This runner can evaluate Alexandria against the same benchmarks used by
 * Supermemory's memorybench (LongMemEval, LoCoMo, ConvoMem).
 *
 * Usage:
 *   bun benchmark/memorybench/runner.ts                              # Synthetic test
 *   bun benchmark/memorybench/runner.ts --benchmark locomo           # LoCoMo dataset
 *   bun benchmark/memorybench/runner.ts --benchmark locomo --limit 50
 *   bun benchmark/memorybench/runner.ts --benchmark locomo --judge   # LLM-as-judge
 *   bun benchmark/memorybench/runner.ts --benchmark locomo --embeddings  # Vector search
 *   bun benchmark/memorybench/runner.ts --benchmark locomo --hyde    # HyDE
 *   bun benchmark/memorybench/runner.ts --benchmark locomo --rerank  # LLM reranking
 *   bun benchmark/memorybench/runner.ts --benchmark locomo --context # Session context expansion
 *   bun benchmark/memorybench/runner.ts --benchmark locomo --session-group  # Session-aware grouping
 *   bun benchmark/memorybench/runner.ts --benchmark locomo --sota --judge   # All SOTA v1 features
 *   bun benchmark/memorybench/runner.ts --benchmark locomo --sota2 --judge  # All SOTA v2 features
 *
 * Flags:
 *   --benchmark <name>  Dataset to use (locomo, synthetic)
 *   --limit <n>         Max questions to evaluate
 *   --conversations <n> Max conversations to load
 *   --embeddings        Enable vector embeddings
 *   --hyde              Enable HyDE (Hypothetical Document Embeddings)
 *   --rerank            Enable LLM-based reranking
 *   --context           Enable session context expansion
 *   --session-group     Enable session-aware result grouping (conversation flow ordering)
 *   --answer-gen        Enable LLM answer generation layer
 *   --sota              Enable SOTA v1 features (embeddings + hyde + rerank + context)
 *   --sota2             Enable SOTA v2 features (session-group + answer-gen + improved temporal)
 *   --judge             Use LLM-as-judge for scoring
 *   --json              Output results as JSON
 */

import { createAlexandriaProvider } from './provider.ts';
import { loadLoCoMo, ensureLoCoMoDataset, type BenchmarkData, type BenchmarkQuestion } from './locomo-loader.ts';
import { createLLMJudge, type LLMJudge } from './llm-judge.ts';
import type { UnifiedSession, AlexandriaSearchResult } from './types.ts';

interface EvaluationResult {
  questionId: string;
  question: string;
  groundTruth: string;
  retrieved: AlexandriaSearchResult[];
  retrievalScore: number;
  haystackHit: boolean;
  // LLM-as-judge fields
  generatedAnswer?: string;
  judgeScore?: number;
  judgeReasoning?: string;
}

interface BenchmarkResults {
  benchmark: string;
  totalQuestions: number;
  avgRetrievalScore: number;
  haystackHitRate: number;
  avgLatencyMs: number;
  // LLM-as-judge metrics
  avgJudgeScore?: number;
  tokenUsage?: { input: number; output: number };
  results: EvaluationResult[];
}

/**
 * Generate synthetic benchmark data for testing
 * In production, this would load from LongMemEval/LoCoMo datasets
 */
function generateSyntheticBenchmark(): BenchmarkData {
  const sessions: UnifiedSession[] = [
    {
      sessionId: 'session-1',
      messages: [
        { role: 'user', content: 'What is the capital of France?' },
        { role: 'assistant', content: 'The capital of France is Paris.' },
        { role: 'user', content: 'What about Germany?' },
        { role: 'assistant', content: 'The capital of Germany is Berlin.' },
      ],
    },
    {
      sessionId: 'session-2',
      messages: [
        { role: 'user', content: 'Tell me about the Eiffel Tower.' },
        {
          role: 'assistant',
          content:
            'The Eiffel Tower is a wrought-iron lattice tower on the Champ de Mars in Paris. It was constructed from 1887 to 1889.',
        },
        { role: 'user', content: 'How tall is it?' },
        {
          role: 'assistant',
          content:
            'The Eiffel Tower is 330 meters tall, including antennas.',
        },
      ],
    },
    {
      sessionId: 'session-3',
      messages: [
        { role: 'user', content: 'What programming language is Bun written in?' },
        {
          role: 'assistant',
          content: 'Bun is primarily written in Zig, with some components in C++.',
        },
        { role: 'user', content: 'Why did they choose Zig?' },
        {
          role: 'assistant',
          content:
            'Zig was chosen for its performance characteristics and memory safety features, making it suitable for systems programming.',
        },
      ],
    },
    {
      sessionId: 'session-4',
      messages: [
        { role: 'user', content: 'What is TypeScript?' },
        {
          role: 'assistant',
          content:
            'TypeScript is a strongly typed programming language that builds on JavaScript, giving you better tooling at any scale.',
        },
        { role: 'user', content: 'Who created it?' },
        {
          role: 'assistant',
          content:
            'TypeScript was created by Microsoft, led by Anders Hejlsberg who also created C#.',
        },
      ],
    },
    {
      sessionId: 'session-5',
      messages: [
        { role: 'user', content: 'Explain SQLite.' },
        {
          role: 'assistant',
          content:
            'SQLite is a C library that provides a lightweight disk-based database. It is self-contained, serverless, and zero-configuration.',
        },
        { role: 'user', content: 'What is WAL mode?' },
        {
          role: 'assistant',
          content:
            'WAL (Write-Ahead Logging) mode in SQLite provides better concurrency by allowing readers and writers to operate simultaneously.',
        },
      ],
    },
  ];

  const questions: BenchmarkQuestion[] = [
    {
      id: 'q1',
      question: 'What is the capital of France?',
      groundTruth: 'Paris',
      haystackSessionIds: ['session-1'],
      type: 'single-hop',
      category: 1,
    },
    {
      id: 'q2',
      question: 'How tall is the Eiffel Tower?',
      groundTruth: '330 meters',
      haystackSessionIds: ['session-2'],
      type: 'single-hop',
      category: 1,
    },
    {
      id: 'q3',
      question: 'What language is Bun written in?',
      groundTruth: 'Zig',
      haystackSessionIds: ['session-3'],
      type: 'single-hop',
      category: 1,
    },
    {
      id: 'q4',
      question: 'Who created TypeScript?',
      groundTruth: 'Microsoft / Anders Hejlsberg',
      haystackSessionIds: ['session-4'],
      type: 'single-hop',
      category: 1,
    },
    {
      id: 'q5',
      question: 'What does WAL stand for in SQLite?',
      groundTruth: 'Write-Ahead Logging',
      haystackSessionIds: ['session-5'],
      type: 'single-hop',
      category: 1,
    },
    {
      id: 'q6',
      question: 'What city has both the Eiffel Tower and is the capital?',
      groundTruth: 'Paris',
      haystackSessionIds: ['session-1', 'session-2'],
      type: 'multi-hop',
      category: 4,
    },
    {
      id: 'q7',
      question: 'What database format does SQLite use for better concurrency?',
      groundTruth: 'WAL mode',
      haystackSessionIds: ['session-5'],
      type: 'single-hop',
      category: 1,
    },
    {
      id: 'q8',
      question: 'What European capitals were discussed?',
      groundTruth: 'Paris and Berlin',
      haystackSessionIds: ['session-1'],
      type: 'multi-hop',
      category: 4,
    },
  ];

  return {
    name: 'synthetic-test',
    sessions,
    questions,
  };
}

/**
 * Calculate retrieval score based on whether haystack sessions were retrieved
 */
function calculateRetrievalScore(
  retrieved: AlexandriaSearchResult[],
  haystackSessionIds: string[],
): { score: number; haystackHit: boolean } {
  const retrievedSessionIds = new Set(retrieved.map((r) => r.sessionId));
  const haystackSet = new Set(haystackSessionIds);

  let hits = 0;
  for (const id of haystackSessionIds) {
    if (retrievedSessionIds.has(id)) {
      hits++;
    }
  }

  const score = haystackSessionIds.length > 0 ? hits / haystackSessionIds.length : 0;
  const haystackHit = hits > 0;

  return { score, haystackHit };
}

/**
 * Run the benchmark
 */
async function runBenchmark(
  data: BenchmarkData,
  options: {
    limit?: number;
    embeddings?: boolean;
    hyde?: boolean;
    reranking?: boolean;
    contextExpansion?: boolean;
    sessionGrouping?: boolean;
    answerGeneration?: boolean;
    judge?: LLMJudge | null;
  } = {},
): Promise<BenchmarkResults> {
  const {
    limit,
    embeddings = false,
    hyde = false,
    reranking = false,
    contextExpansion = false,
    sessionGrouping = false,
    answerGeneration = false,
    judge = null,
  } = options;
  const provider = createAlexandriaProvider();

  // Initialize with all features
  await provider.initialize({
    indexEmbeddings: embeddings,
    useHyDE: hyde,
    useReranking: reranking,
    useContextExpansion: contextExpansion,
    useSessionGrouping: sessionGrouping,
    useAnswerGeneration: answerGeneration,
  });

  const containerTag = `bench_${data.name}_${Date.now()}`;

  // Ingest all sessions
  console.log(`\nIngesting ${data.sessions.length} sessions...`);
  const ingestStart = performance.now();
  const ingestResult = await provider.ingest(data.sessions, { containerTag });
  await provider.awaitIndexing(ingestResult, containerTag);
  const ingestTime = performance.now() - ingestStart;
  console.log(`Ingest completed in ${ingestTime.toFixed(0)}ms`);

  // Evaluate questions
  const questions = limit ? data.questions.slice(0, limit) : data.questions;
  const results: EvaluationResult[] = [];
  const latencies: number[] = [];

  console.log(`\nEvaluating ${questions.length} questions${judge ? ' with LLM-as-judge' : ''}...`);

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const searchStart = performance.now();
    const retrieved = (await provider.search(q.question, {
      containerTag,
      limit: 10,
    })) as AlexandriaSearchResult[];
    const searchTime = performance.now() - searchStart;
    latencies.push(searchTime);

    const { score, haystackHit } = calculateRetrievalScore(
      retrieved,
      q.haystackSessionIds,
    );

    const result: EvaluationResult = {
      questionId: q.id,
      question: q.question,
      groundTruth: q.groundTruth,
      retrieved,
      retrievalScore: score,
      haystackHit,
    };

    // Run LLM-as-judge if available
    if (judge && retrieved.length > 0) {
      try {
        const judgeResult = await judge.evaluate(q.question, q.groundTruth, retrieved);
        result.generatedAnswer = judgeResult.generatedAnswer;
        result.judgeScore = judgeResult.score;
        result.judgeReasoning = judgeResult.reasoning;

        // Progress indicator
        if ((i + 1) % 10 === 0) {
          console.log(`  [Judge] ${i + 1}/${questions.length} evaluated...`);
        }
      } catch (error) {
        console.error(`  [Judge] Error on ${q.id}:`, error);
        result.judgeScore = 0;
      }
    }

    results.push(result);
  }

  // Cleanup
  await provider.clear(containerTag);

  // Calculate aggregate metrics
  const avgRetrievalScore =
    results.reduce((sum, r) => sum + r.retrievalScore, 0) / results.length;
  const haystackHitRate =
    results.filter((r) => r.haystackHit).length / results.length;
  const avgLatencyMs =
    latencies.reduce((sum, l) => sum + l, 0) / latencies.length;

  // Calculate judge score if applicable
  const judgedResults = results.filter((r) => r.judgeScore !== undefined);
  const avgJudgeScore = judgedResults.length > 0
    ? judgedResults.reduce((sum, r) => sum + (r.judgeScore || 0), 0) / judgedResults.length
    : undefined;

  const tokenUsage = judge ? judge.getUsage() : undefined;

  return {
    benchmark: data.name,
    totalQuestions: questions.length,
    avgRetrievalScore,
    haystackHitRate,
    avgLatencyMs,
    avgJudgeScore,
    tokenUsage: tokenUsage ? { input: tokenUsage.inputTokens, output: tokenUsage.outputTokens } : undefined,
    results,
  };
}

/**
 * Format results for display
 */
function formatResults(results: BenchmarkResults): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(`=== Alexandria Memorybench Results ===`);
  lines.push(`Benchmark: ${results.benchmark}`);
  lines.push(`Questions: ${results.totalQuestions}`);
  lines.push('');
  lines.push('Retrieval Metrics:');
  lines.push(`  Avg Retrieval Score: ${(results.avgRetrievalScore * 100).toFixed(1)}%`);
  lines.push(`  Haystack Hit Rate: ${(results.haystackHitRate * 100).toFixed(1)}%`);
  lines.push(`  Avg Latency: ${results.avgLatencyMs.toFixed(1)}ms`);

  // LLM-as-judge metrics
  if (results.avgJudgeScore !== undefined) {
    lines.push('');
    lines.push('LLM-as-Judge Metrics:');
    lines.push(`  Avg Judge Score (J-Score): ${(results.avgJudgeScore * 100).toFixed(1)}%`);
    if (results.tokenUsage) {
      lines.push(`  Token Usage: ${results.tokenUsage.input} input, ${results.tokenUsage.output} output`);
    }
  }
  lines.push('');

  lines.push('Per-Question Results:');
  for (const r of results.results) {
    const status = r.haystackHit ? '✓' : '✗';
    let line = `  ${status} ${r.questionId}: "${r.question.substring(0, 35)}..."`;
    line += ` - Retrieval: ${(r.retrievalScore * 100).toFixed(0)}%`;
    if (r.judgeScore !== undefined) {
      line += ` | J-Score: ${(r.judgeScore * 100).toFixed(0)}%`;
    }
    lines.push(line);
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);
  const benchmark = args.includes('--benchmark')
    ? args[args.indexOf('--benchmark') + 1]
    : 'synthetic';
  const limit = args.includes('--limit')
    ? parseInt(args[args.indexOf('--limit') + 1], 10)
    : undefined;
  const convLimit = args.includes('--conversations')
    ? parseInt(args[args.indexOf('--conversations') + 1], 10)
    : undefined;
  const embeddings = args.includes('--embeddings');
  const hyde = args.includes('--hyde');
  const reranking = args.includes('--rerank');
  const contextExpansion = args.includes('--context');
  const sessionGrouping = args.includes('--session-group');
  const answerGen = args.includes('--answer-gen');
  const useJudge = args.includes('--judge');
  const json = args.includes('--json');
  const sota = args.includes('--sota'); // Enable all SOTA features
  const sota2 = args.includes('--sota2'); // Enable v2 SOTA features (session-group + better temporal)

  console.log('=== Alexandria Memorybench Runner ===');
  console.log('');

  let data: BenchmarkData;

  if (benchmark === 'locomo') {
    console.log('Loading LoCoMo dataset...');
    await ensureLoCoMoDataset();
    data = await loadLoCoMo('benchmark/memorybench/data/locomo10.json', {
      conversationLimit: convLimit,
      questionLimit: limit,
    });
  } else {
    console.log('Using synthetic test data.');
    console.log('Use --benchmark locomo for LoCoMo dataset.');
    console.log('');
    data = generateSyntheticBenchmark();
  }

  // Create LLM judge if requested
  let judge: LLMJudge | null = null;
  if (useJudge) {
    judge = await createLLMJudge();
    if (!judge) {
      console.log('Warning: --judge requested but no API key available.');
      console.log('Set ANTHROPIC_API_KEY or run from Claude Code.');
    }
  }

  // Run benchmark with selected features
  const results = await runBenchmark(data, {
    limit,
    embeddings: embeddings || sota,
    hyde: hyde || sota,
    reranking: reranking || sota,
    contextExpansion: contextExpansion || sota,
    sessionGrouping: sessionGrouping || sota2,
    answerGeneration: answerGen || sota2,
    judge,
  });

  // Output results
  if (json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(formatResults(results));
  }
}

main().catch(console.error);
