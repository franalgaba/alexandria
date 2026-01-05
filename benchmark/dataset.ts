/**
 * Benchmark dataset generator
 *
 * Creates a realistic set of memories and queries for evaluating retrieval quality.
 */

import type { ObjectType } from '../src/types/memory-objects.ts';
import type { BenchmarkDataset, BenchmarkMemory, BenchmarkQuery } from './types.ts';

/**
 * Generate the standard Alexandria benchmark dataset
 */
export function generateDataset(): BenchmarkDataset {
  const memories: BenchmarkMemory[] = [
    // === AUTHENTICATION ===
    {
      id: 'auth-001',
      content: 'Authentication: Use JWT tokens with 1-hour expiry for API authentication',
      objectType: 'decision',
      topics: ['auth', 'jwt', 'api', 'security'],
      codeRefs: ['src/auth/jwt.ts'],
    },
    {
      id: 'auth-002',
      content: 'Security: Store refresh tokens in httpOnly cookies to prevent XSS attacks',
      objectType: 'constraint',
      topics: ['auth', 'security', 'cookies', 'xss'],
      codeRefs: ['src/auth/cookies.ts'],
    },
    {
      id: 'auth-003',
      content: 'When JWT verification fails with "token expired", return 401 and trigger refresh flow',
      objectType: 'known_fix',
      topics: ['auth', 'jwt', 'error-handling'],
      codeRefs: ['src/auth/middleware.ts'],
    },
    {
      id: 'auth-004',
      content: 'Security: Never log JWT tokens or secrets to console in production',
      objectType: 'constraint',
      topics: ['auth', 'security', 'logging'],
    },
    {
      id: 'auth-005',
      content: 'Security: Use bcrypt with cost factor 12 for password hashing',
      objectType: 'convention',
      topics: ['auth', 'passwords', 'security', 'bcrypt'],
      codeRefs: ['src/auth/passwords.ts'],
    },

    // === DATABASE ===
    {
      id: 'db-001',
      content: 'Use SQLite with WAL mode for local development, PostgreSQL for production',
      objectType: 'decision',
      topics: ['database', 'sqlite', 'postgresql'],
      codeRefs: ['src/db/connection.ts'],
    },
    {
      id: 'db-002',
      content: 'Security: Always use parameterized queries to prevent SQL injection',
      objectType: 'constraint',
      topics: ['database', 'security', 'sql-injection'],
    },
    {
      id: 'db-003',
      content: 'When connection pool exhausted, increase max connections or add connection timeout',
      objectType: 'known_fix',
      topics: ['database', 'connection-pool', 'performance'],
      codeRefs: ['src/db/pool.ts'],
    },
    {
      id: 'db-004',
      content: 'Run database migrations in transactions to ensure atomicity',
      objectType: 'convention',
      topics: ['database', 'migrations'],
      codeRefs: ['src/db/migrations/'],
    },
    {
      id: 'db-005',
      content: 'Use foreign keys with ON DELETE CASCADE for referential integrity',
      objectType: 'convention',
      topics: ['database', 'schema', 'foreign-keys'],
    },

    // === TESTING ===
    {
      id: 'test-001',
      content: 'Use vitest for unit tests and playwright for e2e tests',
      objectType: 'decision',
      topics: ['testing', 'vitest', 'playwright', 'e2e'],
      codeRefs: ['vitest.config.ts', 'playwright.config.ts'],
    },
    {
      id: 'test-002',
      content: 'Mock external API calls in tests using msw (Mock Service Worker)',
      objectType: 'convention',
      topics: ['testing', 'mocking', 'api'],
      codeRefs: ['test/mocks/handlers.ts'],
    },
    {
      id: 'test-003',
      content: 'When tests flake due to timing, use waitFor with explicit conditions instead of fixed delays',
      objectType: 'known_fix',
      topics: ['testing', 'flaky-tests', 'async'],
    },
    {
      id: 'test-004',
      content: 'Each test should be independent and not rely on state from other tests',
      objectType: 'constraint',
      topics: ['testing', 'isolation'],
    },
    {
      id: 'test-005',
      content: 'Run tests in CI before merging PRs',
      objectType: 'convention',
      topics: ['testing', 'ci', 'pr'],
      codeRefs: ['.github/workflows/test.yml'],
    },

    // === ERROR HANDLING ===
    {
      id: 'err-001',
      content: 'Return structured error responses with code, message, and optional details',
      objectType: 'convention',
      topics: ['error-handling', 'api', 'responses'],
      codeRefs: ['src/utils/errors.ts'],
    },
    {
      id: 'err-002',
      content: 'Security: Never expose stack traces to clients in production',
      objectType: 'constraint',
      topics: ['error-handling', 'security'],
    },
    {
      id: 'err-003',
      content: 'Log errors with context using structured logging (JSON format)',
      objectType: 'convention',
      topics: ['error-handling', 'logging'],
      codeRefs: ['src/utils/logger.ts'],
    },
    {
      id: 'err-004',
      content: 'When unhandled promise rejection occurs, the fix is to add .catch() or wrap in try/catch',
      objectType: 'known_fix',
      topics: ['error-handling', 'async', 'promises'],
    },
    {
      id: 'err-005',
      content: 'Use custom error classes that extend Error for different error types',
      objectType: 'convention',
      topics: ['error-handling', 'typescript'],
      codeRefs: ['src/utils/errors.ts'],
    },

    // === TYPESCRIPT ===
    {
      id: 'ts-001',
      content: 'Never use any type - prefer unknown or proper typing',
      objectType: 'constraint',
      topics: ['typescript', 'types'],
    },
    {
      id: 'ts-002',
      content: 'Use strict mode in tsconfig.json',
      objectType: 'convention',
      topics: ['typescript', 'config'],
      codeRefs: ['tsconfig.json'],
    },
    {
      id: 'ts-003',
      content: 'Prefer interface over type for object shapes',
      objectType: 'preference',
      topics: ['typescript', 'types', 'style'],
    },
    {
      id: 'ts-004',
      content: 'Use branded types for IDs to prevent mixing different ID types',
      objectType: 'convention',
      topics: ['typescript', 'types', 'safety'],
      codeRefs: ['src/types/ids.ts'],
    },
    {
      id: 'ts-005',
      content: 'When TypeScript cannot find module, check tsconfig paths and baseUrl settings',
      objectType: 'known_fix',
      topics: ['typescript', 'modules', 'errors'],
      codeRefs: ['tsconfig.json'],
    },

    // === API DESIGN ===
    {
      id: 'api-001',
      content: 'Use REST with OpenAPI spec for public APIs',
      objectType: 'decision',
      topics: ['api', 'rest', 'openapi'],
      codeRefs: ['openapi.yaml'],
    },
    {
      id: 'api-002',
      content: 'Version APIs using URL path prefix (/v1/, /v2/)',
      objectType: 'convention',
      topics: ['api', 'versioning'],
      codeRefs: ['src/routes/'],
    },
    {
      id: 'api-003',
      content: 'Return 201 for resource creation, 200 for updates, 204 for deletes',
      objectType: 'convention',
      topics: ['api', 'http-status', 'rest'],
    },
    {
      id: 'api-004',
      content: 'Always validate request body using zod schemas',
      objectType: 'constraint',
      topics: ['api', 'validation', 'zod'],
      codeRefs: ['src/validators/'],
    },
    {
      id: 'api-005',
      content: 'Security: Rate limit public endpoints to 100 requests per minute per IP',
      objectType: 'constraint',
      topics: ['api', 'rate-limiting', 'security'],
      codeRefs: ['src/middleware/rate-limit.ts'],
    },

    // === BUILD & DEPLOY ===
    {
      id: 'build-001',
      content: 'Use esbuild for bundling in production',
      objectType: 'decision',
      topics: ['build', 'bundler', 'esbuild'],
      codeRefs: ['build.ts'],
    },
    {
      id: 'build-002',
      content: 'Docker images should use multi-stage builds to minimize size',
      objectType: 'convention',
      topics: ['build', 'docker', 'optimization'],
      codeRefs: ['Dockerfile'],
    },
    {
      id: 'build-003',
      content: 'Environment variables must be validated at startup',
      objectType: 'constraint',
      topics: ['build', 'config', 'environment'],
      codeRefs: ['src/config/env.ts'],
    },
    {
      id: 'build-004',
      content: 'When build fails with out of memory, increase Node max-old-space-size',
      objectType: 'known_fix',
      topics: ['build', 'memory', 'node'],
    },
    {
      id: 'build-005',
      content: 'Use semantic versioning for releases',
      objectType: 'convention',
      topics: ['build', 'versioning', 'releases'],
    },

    // === PERFORMANCE ===
    {
      id: 'perf-001',
      content: 'Use Redis for caching frequently accessed data',
      objectType: 'decision',
      topics: ['performance', 'caching', 'redis'],
      codeRefs: ['src/cache/redis.ts'],
    },
    {
      id: 'perf-002',
      content: 'Paginate list endpoints with limit and offset parameters',
      objectType: 'convention',
      topics: ['performance', 'api', 'pagination'],
    },
    {
      id: 'perf-003',
      content: 'Index database columns used in WHERE and JOIN clauses',
      objectType: 'convention',
      topics: ['performance', 'database', 'indexes'],
    },
    {
      id: 'perf-004',
      content: 'When API response time exceeds 500ms, profile with Chrome DevTools or node --prof',
      objectType: 'known_fix',
      topics: ['performance', 'profiling', 'debugging'],
    },
    {
      id: 'perf-005',
      content: 'Use connection pooling for database connections',
      objectType: 'convention',
      topics: ['performance', 'database', 'connection-pool'],
      codeRefs: ['src/db/pool.ts'],
    },
  ];

  const queries: BenchmarkQuery[] = [
    // Simple topic queries
    {
      id: 'q-001',
      query: 'How should I handle authentication?',
      relevantMemoryIds: ['auth-001', 'auth-002', 'auth-003', 'auth-004', 'auth-005'],
      relevanceGrades: { 'auth-001': 3, 'auth-002': 3, 'auth-003': 2, 'auth-004': 2, 'auth-005': 2 },
      topic: 'auth',
    },
    {
      id: 'q-002',
      query: 'database connection issues',
      relevantMemoryIds: ['db-001', 'db-003', 'perf-005'],
      relevanceGrades: { 'db-001': 2, 'db-003': 3, 'perf-005': 2 },
      topic: 'database',
    },
    {
      id: 'q-003',
      query: 'how to write tests',
      relevantMemoryIds: ['test-001', 'test-002', 'test-003', 'test-004', 'test-005'],
      relevanceGrades: { 'test-001': 3, 'test-002': 2, 'test-003': 2, 'test-004': 2, 'test-005': 2 },
      topic: 'testing',
    },

    // Error-specific queries
    {
      id: 'q-004',
      query: 'JWT token expired error',
      relevantMemoryIds: ['auth-003'],
      relevanceGrades: { 'auth-003': 3 },
      topic: 'auth',
    },
    {
      id: 'q-005',
      query: 'tests are flaky and failing randomly',
      relevantMemoryIds: ['test-003', 'test-004'],
      relevanceGrades: { 'test-003': 3, 'test-004': 2 },
      topic: 'testing',
    },
    {
      id: 'q-006',
      query: 'unhandled promise rejection',
      relevantMemoryIds: ['err-004'],
      relevanceGrades: { 'err-004': 3 },
      topic: 'error-handling',
    },

    // Type-specific queries
    {
      id: 'q-007',
      query: 'what constraints should I follow for security?',
      relevantMemoryIds: ['auth-002', 'auth-004', 'db-002', 'err-002', 'api-004', 'api-005'],
      relevanceGrades: {
        'auth-002': 3,
        'auth-004': 3,
        'db-002': 3,
        'err-002': 2,
        'api-004': 2,
        'api-005': 2,
      },
      expectedTypes: ['constraint'],
    },
    {
      id: 'q-008',
      query: 'known fixes for common errors',
      relevantMemoryIds: ['auth-003', 'db-003', 'test-003', 'err-004', 'ts-005', 'build-004', 'perf-004'],
      relevanceGrades: {
        'auth-003': 3,
        'db-003': 3,
        'test-003': 3,
        'err-004': 3,
        'ts-005': 3,
        'build-004': 3,
        'perf-004': 3,
      },
      expectedTypes: ['known_fix'],
    },

    // Cross-topic queries
    {
      id: 'q-009',
      query: 'security best practices',
      relevantMemoryIds: ['auth-002', 'auth-004', 'auth-005', 'db-002', 'err-002', 'api-005'],
      relevanceGrades: {
        'auth-002': 3,
        'auth-004': 3,
        'auth-005': 2,
        'db-002': 3,
        'err-002': 2,
        'api-005': 2,
      },
    },
    {
      id: 'q-010',
      query: 'API design patterns',
      relevantMemoryIds: ['api-001', 'api-002', 'api-003', 'api-004', 'api-005', 'err-001'],
      relevanceGrades: {
        'api-001': 3,
        'api-002': 3,
        'api-003': 3,
        'api-004': 2,
        'api-005': 2,
        'err-001': 2,
      },
    },

    // Code ref queries
    {
      id: 'q-011',
      query: 'what do I need to know about src/auth/',
      relevantMemoryIds: ['auth-001', 'auth-002', 'auth-003', 'auth-005'],
      relevanceGrades: { 'auth-001': 3, 'auth-002': 3, 'auth-003': 3, 'auth-005': 3 },
    },
    {
      id: 'q-012',
      query: 'tsconfig.json configuration',
      relevantMemoryIds: ['ts-002', 'ts-005'],
      relevanceGrades: { 'ts-002': 3, 'ts-005': 2 },
    },

    // Performance queries
    {
      id: 'q-013',
      query: 'how to improve performance',
      relevantMemoryIds: ['perf-001', 'perf-002', 'perf-003', 'perf-004', 'perf-005', 'db-003'],
      relevanceGrades: {
        'perf-001': 3,
        'perf-002': 2,
        'perf-003': 3,
        'perf-004': 2,
        'perf-005': 3,
        'db-003': 2,
      },
      topic: 'performance',
    },
    {
      id: 'q-014',
      query: 'caching strategy',
      relevantMemoryIds: ['perf-001'],
      relevanceGrades: { 'perf-001': 3 },
    },

    // Build queries
    {
      id: 'q-015',
      query: 'build failing out of memory',
      relevantMemoryIds: ['build-004'],
      relevanceGrades: { 'build-004': 3 },
    },
    {
      id: 'q-016',
      query: 'docker deployment',
      relevantMemoryIds: ['build-002', 'build-003'],
      relevanceGrades: { 'build-002': 3, 'build-003': 2 },
    },

    // TypeScript queries
    {
      id: 'q-017',
      query: 'typescript type safety',
      relevantMemoryIds: ['ts-001', 'ts-002', 'ts-003', 'ts-004'],
      relevanceGrades: { 'ts-001': 3, 'ts-002': 2, 'ts-003': 2, 'ts-004': 3 },
    },
    {
      id: 'q-018',
      query: 'cannot find module error',
      relevantMemoryIds: ['ts-005'],
      relevanceGrades: { 'ts-005': 3 },
    },

    // Password/bcrypt query
    {
      id: 'q-019',
      query: 'how to hash passwords',
      relevantMemoryIds: ['auth-005'],
      relevanceGrades: { 'auth-005': 3 },
    },

    // Logging query
    {
      id: 'q-020',
      query: 'logging best practices',
      relevantMemoryIds: ['auth-004', 'err-003'],
      relevanceGrades: { 'auth-004': 2, 'err-003': 3 },
    },
  ];

  return {
    name: 'alexandria-standard-v1',
    description: 'Standard benchmark dataset for Alexandria retrieval quality evaluation',
    memories,
    queries,
    metadata: {
      createdAt: new Date().toISOString(),
      version: '1.0.0',
    },
  };
}

/**
 * Get memories by topic
 */
export function getMemoriesByTopic(
  dataset: BenchmarkDataset,
  topic: string,
): BenchmarkMemory[] {
  return dataset.memories.filter((m) => m.topics.includes(topic));
}

/**
 * Get all unique topics in dataset
 */
export function getTopics(dataset: BenchmarkDataset): string[] {
  const topics = new Set<string>();
  for (const memory of dataset.memories) {
    for (const topic of memory.topics) {
      topics.add(topic);
    }
  }
  return Array.from(topics).sort();
}

/**
 * Get dataset statistics
 */
export function getDatasetStats(dataset: BenchmarkDataset): {
  memoryCount: number;
  queryCount: number;
  topicCount: number;
  typeDistribution: Record<ObjectType, number>;
  avgRelevantPerQuery: number;
} {
  const typeDistribution: Record<string, number> = {};
  for (const memory of dataset.memories) {
    typeDistribution[memory.objectType] = (typeDistribution[memory.objectType] || 0) + 1;
  }

  const totalRelevant = dataset.queries.reduce(
    (sum, q) => sum + q.relevantMemoryIds.length,
    0,
  );

  return {
    memoryCount: dataset.memories.length,
    queryCount: dataset.queries.length,
    topicCount: getTopics(dataset).length,
    typeDistribution: typeDistribution as Record<ObjectType, number>,
    avgRelevantPerQuery: totalRelevant / dataset.queries.length,
  };
}
