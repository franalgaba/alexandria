/**
 * Retriever - main entry point for retrieval operations
 */

import type { Database } from 'bun:sqlite';
import type { PackOptions, SearchOptions } from '../types/common.ts';
import type { LegacyContextPack, SearchResult } from '../types/retriever.ts';
import { ContextPackCompiler } from './context-pack.ts';
import { HybridSearch } from './hybrid-search.ts';
import type { RetrievalPlan } from './router.ts';

export class Retriever {
  private searcher: HybridSearch;
  private compiler: ContextPackCompiler;

  constructor(db: Database) {
    this.searcher = new HybridSearch(db);
    this.compiler = new ContextPackCompiler(db);
  }

  /**
   * Search for relevant memory objects
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    return this.searcher.search(query, options);
  }

  /**
   * Search with lexical only
   */
  searchLexical(query: string, options: SearchOptions = {}): SearchResult[] {
    return this.searcher.searchLexical(query, options);
  }

  /**
   * Search with vector only
   */
  async searchVector(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    return this.searcher.searchVector(query, options);
  }

  /**
   * Search by exact token
   */
  searchByToken(token: string, limit = 20): SearchResult[] {
    return this.searcher.searchByToken(token, limit);
  }

  /**
   * Search with a retrieval plan (smart routing)
   */
  async searchWithPlan(query: string, plan: RetrievalPlan): Promise<SearchResult[]> {
    return this.searcher.searchWithPlan(query, plan);
  }

  /**
   * Compile a context pack
   */
  async compilePack(options: PackOptions = {}): Promise<LegacyContextPack> {
    return this.compiler.compile(options);
  }

  /**
   * Compile a minimal pack (constraints only)
   */
  compileMinimalPack(): LegacyContextPack {
    return this.compiler.compileMinimal();
  }

  /**
   * Get the hybrid search instance
   */
  getSearcher(): HybridSearch {
    return this.searcher;
  }

  /**
   * Get the context pack compiler
   */
  getCompiler(): ContextPackCompiler {
    return this.compiler;
  }
}

export { ContextPackCompiler } from './context-pack.ts';
// Re-export components
export { HybridSearch } from './hybrid-search.ts';
export type { QueryIntent } from './intent.ts';
export { classifyIntent, getIntentDescription, getIntentEmoji } from './intent.ts';
export { Reranker } from './reranker.ts';
export type { RetrievalPlan } from './router.ts';
export { RetrievalRouter } from './router.ts';
export { codeRefsMatchScope, extractScope, scoreScopeMatch } from './scope.ts';
