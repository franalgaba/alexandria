/**
 * Ingestor - main entry point for ingesting events
 */

import type { Database } from 'bun:sqlite';
import { FTSIndex } from '../indexes/fts.ts';
import { VectorIndex } from '../indexes/vector.ts';
import { EventStore } from '../stores/events.ts';
import type { Event, EventType } from '../types/events.ts';
import { classifyEventType } from './event-types.ts';
import { extractFilePaths, sanitizeContent } from './parsers.ts';
import { RealtimeExtractor } from './realtime-extractor.ts';

export interface IngestOptions {
  /** Skip embedding generation (faster, but no vector search) */
  skipEmbedding?: boolean;
  /** Sanitize content to remove sensitive data */
  sanitize?: boolean;
  /** Override event type detection */
  eventType?: EventType;
  /** Skip real-time memory extraction */
  skipExtraction?: boolean;
}

export interface IngestResult {
  event: Event;
  memoriesExtracted: number;
}

export class Ingestor {
  private eventStore: EventStore;
  private ftsIndex: FTSIndex;
  private vectorIndex: VectorIndex;
  private realtimeExtractor: RealtimeExtractor;

  constructor(db: Database) {
    this.eventStore = new EventStore(db);
    this.ftsIndex = new FTSIndex(db);
    this.vectorIndex = new VectorIndex(db);
    this.realtimeExtractor = new RealtimeExtractor(db);
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

    // Real-time memory extraction
    let memoriesExtracted = 0;
    if (!options.skipExtraction && finalContent) {
      try {
        const extracted = await this.realtimeExtractor.processEvent(event, finalContent);
        memoriesExtracted = extracted.length;
      } catch (error) {
        console.debug('Failed to extract memories:', error);
      }
    }

    return event;
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
}

// Re-export
export { RealtimeExtractor } from './realtime-extractor.ts';
