/**
 * Ingestor - main entry point for ingesting events
 */

import type { Database } from 'bun:sqlite';
import { FTSIndex } from '../indexes/fts.ts';
import { VectorIndex } from '../indexes/vector.ts';
import { EventStore } from '../stores/events.ts';
import type { Event, EventType } from '../types/events.ts';
import { Checkpoint, type CheckpointConfig, type CheckpointTrigger } from './checkpoint.ts';
import { classifyEventType } from './event-types.ts';
import { IntelligentExtractor, type LLMProvider } from './intelligent-extractor.ts';
import { extractFilePaths, sanitizeContent } from './parsers.ts';
import { RealtimeExtractor } from './realtime-extractor.ts';

export interface IngestOptions {
  /** Skip embedding generation (faster, but no vector search) */
  skipEmbedding?: boolean;
  /** Sanitize content to remove sensitive data */
  sanitize?: boolean;
  /** Override event type detection */
  eventType?: EventType;
  /** Skip real-time memory extraction (use checkpoint-based instead) */
  skipExtraction?: boolean;
  /** Use intelligent (LLM-based) extraction instead of pattern matching */
  useIntelligentExtraction?: boolean;
  /** Use checkpoint-based curation (recommended, replaces real-time extraction) */
  useCheckpoints?: boolean;
}

export interface IngestResult {
  event: Event;
  memoriesExtracted: number;
}

export interface IngestorOptions {
  llmProvider?: LLMProvider;
  useIntelligent?: boolean;
  useCheckpoints?: boolean;
  checkpointConfig?: Partial<CheckpointConfig>;
}

export class Ingestor {
  private eventStore: EventStore;
  private ftsIndex: FTSIndex;
  private vectorIndex: VectorIndex;
  private realtimeExtractor: RealtimeExtractor;
  private intelligentExtractor: IntelligentExtractor;
  private checkpoint: Checkpoint;
  private useIntelligent: boolean;
  private useCheckpoints: boolean;

  /**
   * Create an Ingestor with auto-detected LLM provider for Haiku extraction.
   * Use this instead of constructor for automatic tier1 detection.
   */
  static async create(db: Database, options?: IngestorOptions): Promise<Ingestor> {
    // Create checkpoint with auto-detected LLM
    const checkpoint = await Checkpoint.create(db, {
      llmProvider: options?.llmProvider,
      ...options?.checkpointConfig,
    });

    return new Ingestor(db, options, checkpoint);
  }

  constructor(db: Database, options?: IngestorOptions, checkpoint?: Checkpoint) {
    this.eventStore = new EventStore(db);
    this.ftsIndex = new FTSIndex(db);
    this.vectorIndex = new VectorIndex(db);
    this.realtimeExtractor = new RealtimeExtractor(db);
    this.intelligentExtractor = new IntelligentExtractor(db, options?.llmProvider);
    this.checkpoint =
      checkpoint ??
      new Checkpoint(db, {
        llmProvider: options?.llmProvider,
        ...options?.checkpointConfig,
      });
    this.useIntelligent = options?.useIntelligent ?? false;
    this.useCheckpoints = options?.useCheckpoints ?? true; // Default to checkpoint mode (v2.0)
  }

  /**
   * Ingest a generic event
   */
  async ingest(
    sessionId: string,
    content: string,
    options: IngestOptions & {
      toolName?: string;
      filePath?: string;
      exitCode?: number;
    } = {},
  ): Promise<Event> {
    // Sanitize if requested
    const finalContent = options.sanitize ? sanitizeContent(content) : content;

    // Determine event type
    const eventType =
      options.eventType ??
      classifyEventType(finalContent, {
        toolName: options.toolName,
        exitCode: options.exitCode,
        filePath: options.filePath,
      });

    // Extract file path if not provided
    let filePath = options.filePath;
    if (!filePath && (eventType === 'diff' || eventType === 'error')) {
      const paths = extractFilePaths(finalContent);
      filePath = paths[0];
    }

    // Store event (FTS auto-updated via trigger)
    const event = this.eventStore.append({
      sessionId,
      timestamp: new Date(),
      eventType,
      content: finalContent,
      toolName: options.toolName,
      filePath,
      exitCode: options.exitCode,
    });

    // Generate and store embedding (async, but we await it)
    if (!options.skipEmbedding && finalContent) {
      try {
        await this.vectorIndex.indexEvent(event.id, finalContent);
      } catch (error) {
        console.debug('Failed to generate embedding:', error);
        // Don't fail the ingest if embedding fails
      }
    }

    // Memory extraction strategy
    let memoriesExtracted = 0;
    const useCheckpoints = options.useCheckpoints ?? this.useCheckpoints;

    if (!options.skipExtraction && finalContent) {
      if (useCheckpoints) {
        // Checkpoint-based: add to buffer, auto-checkpoint on triggers
        try {
          const trigger = await this.checkpoint.addEvent(event);
          if (trigger) {
            console.debug('Auto-checkpoint triggered:', trigger.type);
          }
        } catch (error) {
          console.debug('Failed to add event to checkpoint buffer:', error);
        }
      } else {
        // Legacy: real-time extraction
        try {
          const useIntelligent = options.useIntelligentExtraction ?? this.useIntelligent;

          if (useIntelligent) {
            const extracted = await this.intelligentExtractor.processEvent(event, finalContent);
            memoriesExtracted = extracted.length;
          } else {
            const extracted = await this.realtimeExtractor.processEvent(event, finalContent);
            memoriesExtracted = extracted.length;
          }
        } catch (error) {
          console.debug('Failed to extract memories:', error);
        }
      }
    }

    return event;
  }

  /**
   * Manually trigger a checkpoint
   */
  async triggerCheckpoint(reason?: string) {
    return this.checkpoint.executeManual(reason);
  }

  /**
   * Get checkpoint buffer statistics
   */
  getCheckpointStats() {
    return this.checkpoint.getBufferStats();
  }

  /**
   * Load events from a session into the checkpoint buffer
   * Used when checkpoint is called from CLI (events already stored in database)
   * If sinceCheckpoint is provided, only loads events after that timestamp
   */
  loadSessionForCheckpoint(sessionId: string, sinceCheckpoint?: Date): number {
    return this.checkpoint.loadSessionEvents(sessionId, sinceCheckpoint);
  }

  /**
   * Flush the intelligent extractor buffer (call on session end)
   */
  async flushExtractor(): Promise<number> {
    try {
      const extracted = await this.intelligentExtractor.flushBuffer();
      return extracted.length;
    } catch (error) {
      console.debug('Failed to flush extractor:', error);
      return 0;
    }
  }

  /**
   * Flush checkpoint buffer (call on session end)
   * Returns checkpoint result if buffer had events, null otherwise
   */
  async flushCheckpoint(reason: string = 'Session end') {
    const stats = this.checkpoint.getBufferStats();
    if (stats.events > 0) {
      return this.checkpoint.executeManual(reason);
    }
    return null;
  }

  /**
   * Ingest a tool output event
   */
  async ingestToolOutput(
    sessionId: string,
    toolName: string,
    output: string,
    exitCode?: number,
    options: IngestOptions = {},
  ): Promise<Event> {
    return this.ingest(sessionId, output, {
      ...options,
      toolName,
      exitCode,
      eventType: 'tool_output',
    });
  }

  /**
   * Ingest a conversation turn
   */
  async ingestTurn(
    sessionId: string,
    role: 'user' | 'assistant',
    content: string,
    options: IngestOptions = {},
  ): Promise<Event> {
    const prefixedContent = `[${role}]: ${content}`;
    return this.ingest(sessionId, prefixedContent, {
      ...options,
      eventType: 'turn',
    });
  }

  /**
   * Ingest a diff event
   */
  async ingestDiff(
    sessionId: string,
    diff: string,
    filePath?: string,
    options: IngestOptions = {},
  ): Promise<Event> {
    return this.ingest(sessionId, diff, {
      ...options,
      filePath,
      eventType: 'diff',
    });
  }

  /**
   * Ingest an error event
   */
  async ingestError(
    sessionId: string,
    error: string,
    exitCode?: number,
    options: IngestOptions = {},
  ): Promise<Event> {
    return this.ingest(sessionId, error, {
      ...options,
      exitCode,
      eventType: 'error',
    });
  }

  /**
   * Ingest a test summary event
   */
  async ingestTestSummary(
    sessionId: string,
    summary: string,
    options: IngestOptions = {},
  ): Promise<Event> {
    return this.ingest(sessionId, summary, {
      ...options,
      eventType: 'test_summary',
    });
  }

  /**
   * Batch ingest multiple events
   */
  async ingestBatch(
    sessionId: string,
    events: Array<{
      content: string;
      options?: IngestOptions & {
        toolName?: string;
        filePath?: string;
        exitCode?: number;
      };
    }>,
  ): Promise<Event[]> {
    const results: Event[] = [];

    for (const event of events) {
      const result = await this.ingest(sessionId, event.content, event.options);
      results.push(result);
    }

    return results;
  }

  /**
   * Get access to underlying stores for advanced operations
   */
  getEventStore(): EventStore {
    return this.eventStore;
  }

  getFTSIndex(): FTSIndex {
    return this.ftsIndex;
  }

  getVectorIndex(): VectorIndex {
    return this.vectorIndex;
  }

  getRealtimeExtractor(): RealtimeExtractor {
    return this.realtimeExtractor;
  }

  getIntelligentExtractor(): IntelligentExtractor {
    return this.intelligentExtractor;
  }
}

export {
  Checkpoint,
  type CheckpointConfig,
  type CheckpointResult,
  type CheckpointTrigger,
} from './checkpoint.ts';
export { DeterministicCurator } from './deterministic-curator.ts';
export {
  ClaudeProvider,
  IntelligentExtractor,
  type LLMProvider,
  OllamaProvider,
  OpenAIProvider,
} from './intelligent-extractor.ts';
// Re-export
export { RealtimeExtractor } from './realtime-extractor.ts';
