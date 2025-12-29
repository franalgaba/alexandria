/**
 * Alexandria - Local-first memory system for coding agents
 *
 * Main entry point for library usage
 */

export {
  cosineSimilarity,
  generateEmbedding,
  generateEmbeddings,
  getEmbeddingDimension,
  isModelLoaded,
  isModelLoading,
  preloadModel,
} from './indexes/embeddings.ts';
// Indexes
export { type FTSEventResult, FTSIndex, type FTSObjectResult } from './indexes/fts.ts';
export { VectorIndex, type VectorSearchResult } from './indexes/vector.ts';
export { classifyEventType } from './ingestor/event-types.ts';
// Ingestor
export { type IngestOptions, Ingestor } from './ingestor/index.ts';
export {
  extractCommands,
  extractErrorCodes,
  extractFilePaths,
  extractVersions,
  parseTestOutput,
  sanitizeContent,
} from './ingestor/parsers.ts';
export { ContextPackCompiler } from './retriever/context-pack.ts';
export { HybridSearch } from './retriever/hybrid-search.ts';
// Retriever
export { Retriever } from './retriever/index.ts';
export { Reranker, type RerankerOptions } from './retriever/reranker.ts';
export { Extractor } from './reviewer/extractor.ts';
// Reviewer
export { ReviewPipeline, type ReviewPipelineResult } from './reviewer/index.ts';
export { type MergeCandidate, Merger } from './reviewer/merger.ts';
export { type ReviewAction, ReviewQueue } from './reviewer/queue.ts';
export { Superseder, type SupersessionCandidate } from './reviewer/superseder.ts';
export { BlobStore } from './stores/blobs.ts';
// Stores
export {
  closeConnection,
  getAlexandriaHome,
  getConnection,
  getCurrentProjectInfo,
  getDbPath,
  getDbPathForProject,
  getMemoryConnection,
  hasVectorSupport,
  isUsingGlobalDatabase,
  listProjectDatabases,
} from './stores/connection.ts';
export { EventStore } from './stores/events.ts';
export { type ListOptions, MemoryObjectStore } from './stores/memory-objects.ts';
export { SessionStore } from './stores/sessions.ts';
// Types
export * from './types/index.ts';
export {
  formatContextPack,
  formatList,
  formatMemoryObject,
  formatSearchResults,
} from './utils/format.ts';
// Utils
export { generateId, generateShortId } from './utils/id.ts';
export {
  type ExtractedToken,
  estimateTokens,
  extractTokens,
  hashContent,
  type TokenType,
} from './utils/tokens.ts';
