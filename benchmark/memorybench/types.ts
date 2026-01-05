/**
 * Types for memorybench integration
 * Based on supermemoryai/memorybench provider interface
 */

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  [key: string]: unknown;
}

export interface IngestOptions {
  containerTag: string;
  metadata?: Record<string, unknown>;
}

export interface IngestResult {
  documentIds: string[];
  taskIds?: string[];
}

export interface SearchOptions {
  containerTag: string;
  limit?: number;
  threshold?: number;
}

export interface UnifiedMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
  speaker?: string;
}

export interface UnifiedSession {
  sessionId: string;
  messages: UnifiedMessage[];
  metadata?: Record<string, unknown>;
}

export interface ProviderPrompts {
  answerPrompt?:
    | string
    | ((question: string, context: unknown[], questionDate?: string) => string);
  judgePrompt?: (
    question: string,
    groundTruth: string,
    hypothesis: string,
  ) => { default: string; [type: string]: string };
}

export interface Provider {
  name: string;
  prompts?: ProviderPrompts;
  initialize(config: ProviderConfig): Promise<void>;
  ingest(sessions: UnifiedSession[], options: IngestOptions): Promise<IngestResult>;
  awaitIndexing(result: IngestResult, containerTag: string): Promise<void>;
  search(query: string, options: SearchOptions): Promise<unknown[]>;
  clear(containerTag: string): Promise<void>;
}

/**
 * Alexandria-specific search result for memorybench
 */
export interface AlexandriaSearchResult {
  id: string;
  content: string;
  score: number;
  sessionId: string;
  role: 'user' | 'assistant';
  timestamp?: string;
}
