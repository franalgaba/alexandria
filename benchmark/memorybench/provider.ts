/**
 * Alexandria provider for memorybench (core retriever)
 *
 * Uses the core Alexandria retriever instead of a custom pipeline.
 * Messages are stored as memory objects and retrieved via HybridSearch.
 */

import type { Database } from 'bun:sqlite';
import { extractFacts, formatFactContent } from '../../src/facts/extractor.ts';
import { VectorIndex } from '../../src/indexes/vector.ts';
import { Retriever } from '../../src/retriever/index.ts';
import { getMemoryConnection } from '../../src/stores/connection.ts';
import { MemoryObjectStore } from '../../src/stores/memory-objects.ts';
import type {
  AlexandriaSearchResult,
  IngestOptions,
  IngestResult,
  Provider,
  ProviderConfig,
  SearchOptions,
  UnifiedSession,
} from './types.ts';

interface MessageMeta {
  sessionId: string;
  role: 'user' | 'assistant';
  timestamp?: string;
}

interface SessionTimeline {
  sessionId: string;
  dateTime?: string;
  messageIds: string[];
}

interface FactRecord {
  id: string;
  content: string;
  subject: string;
  predicate: string;
  object: string;
  time?: string;
  sessionId: string;
  role: 'user' | 'assistant';
  timestamp?: string;
}

interface FactMatch {
  fact: FactRecord;
  score: number;
}

/**
 * Map of container tags to their database instances
 */
const containerDatabases = new Map<string, Database>();

/**
 * Map of container tags to their vector indexes
 */
const vectorIndexes = new Map<string, VectorIndex>();

/**
 * Map of container tags to message metadata (memoryId -> meta)
 */
const messageIndexes = new Map<string, Map<string, MessageMeta>>();

/**
 * Session timelines for optional context expansion / grouping
 */
const sessionTimelines = new Map<string, SessionTimeline[]>();

/**
 * Extracted facts per container
 */
const factRecordsByContainer = new Map<string, FactRecord[]>();

export class AlexandriaProvider implements Provider {
  name = 'alexandria';

  private config: ProviderConfig | null = null;
  private indexEmbeddings = false;
  private useContextExpansion = false;
  private useSessionGrouping = false;

  /**
   * Custom prompts for answer generation
   */
  prompts = {
    answerPrompt: (
      question: string,
      context: AlexandriaSearchResult[],
      questionDate?: string,
    ): string => {
      const contextText = context
        .map((c) => `[${c.role}]: ${c.content}`)
        .join('\n\n');

      return `Based on the following conversation history, answer the question.

Conversation History:
${contextText}

${questionDate ? `Current date: ${questionDate}\n` : ''}
Question: ${question}

Answer concisely based only on the information provided above.`;
    },
  };

  /**
   * Initialize the provider
   */
  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    this.indexEmbeddings = config.indexEmbeddings === true;
    this.useContextExpansion = config.useContextExpansion === true;
    this.useSessionGrouping = config.useSessionGrouping === true;

    const features = [
      this.indexEmbeddings ? 'embeddings' : null,
      this.useContextExpansion ? 'context-expansion' : null,
      this.useSessionGrouping ? 'session-grouping' : null,
    ]
      .filter(Boolean)
      .join(', ') || 'none';

    console.log(`[Alexandria] Initialized (features: ${features})`);
  }

  /**
   * Ingest sessions into Alexandria
   */
  async ingest(
    sessions: UnifiedSession[],
    options: IngestOptions,
  ): Promise<IngestResult> {
    const { containerTag } = options;

    const db = this.getDatabase(containerTag);
    const store = new MemoryObjectStore(db);

    // Create and store vector index if embeddings enabled
    let vectorIndex: VectorIndex | null = null;
    if (this.indexEmbeddings) {
      vectorIndex = new VectorIndex(db);
      vectorIndexes.set(containerTag, vectorIndex);
    }

    const messageIndex = new Map<string, MessageMeta>();
    messageIndexes.set(containerTag, messageIndex);

    const timelines: SessionTimeline[] = [];
    sessionTimelines.set(containerTag, timelines);
    const factRecords: FactRecord[] = [];
    factRecordsByContainer.set(containerTag, factRecords);

    const documentIds: string[] = [];
    let factCount = 0;

    for (const session of sessions) {
      const timeline: SessionTimeline = {
        sessionId: session.sessionId,
        dateTime: session.metadata?.dateTime as string | undefined,
        messageIds: [],
      };

      for (const message of session.messages) {
        const created = store.create({
          content: message.content,
          objectType: 'environment',
        });

        documentIds.push(created.id);
        timeline.messageIds.push(created.id);
        messageIndex.set(created.id, {
          sessionId: session.sessionId,
          role: message.role,
          timestamp: message.timestamp,
        });

        const facts = extractFacts(message.content, {
          speaker: message.speaker,
          sessionDate: message.timestamp,
          maxFacts: 2,
        });

        for (const fact of facts) {
          const factContent = formatFactContent(fact);
          const factMemory = store.create({
            content: `Fact: ${factContent}`,
            objectType: 'environment',
            confidence: fact.confidence,
            evidenceEventIds: [created.id],
            evidenceExcerpt: message.content.slice(0, 200),
          });

          documentIds.push(factMemory.id);
          messageIndex.set(factMemory.id, {
            sessionId: session.sessionId,
            role: 'assistant',
            timestamp: message.timestamp,
          });
          factRecords.push({
            id: factMemory.id,
            content: factMemory.content,
            subject: fact.subject,
            predicate: fact.predicate,
            object: fact.object,
            time: fact.time,
            sessionId: session.sessionId,
            role: 'assistant',
            timestamp: message.timestamp,
          });
          factCount += 1;

          if (vectorIndex) {
            await vectorIndex.indexObject(factMemory.id, factMemory.content);
          }
        }

        if (vectorIndex) {
          await vectorIndex.indexObject(created.id, created.content);
        }
      }

      timelines.push(timeline);
    }

    console.log(
      `[Alexandria] Ingested ${sessions.length} sessions, ${documentIds.length} messages (${factCount} facts)`,
    );

    return { documentIds };
  }

  /**
   * Wait for indexing to complete
   */
  async awaitIndexing(result: IngestResult, containerTag: string): Promise<void> {
    console.log(`[Alexandria] Indexing complete for ${containerTag}`);
  }

  /**
   * Search using core Alexandria retriever
   */
  async search(
    query: string,
    options: SearchOptions,
  ): Promise<AlexandriaSearchResult[]> {
    const { containerTag, limit = 10 } = options;

    const db = this.getDatabase(containerTag);
    const retriever = new Retriever(db);
    const store = new MemoryObjectStore(db);
    const messageIndex = messageIndexes.get(containerTag);
    const factRecords = factRecordsByContainer.get(containerTag) ?? [];

    if (!messageIndex) {
      return [];
    }

    const searchLimit = this.useContextExpansion || this.useSessionGrouping ? limit * 3 : limit;
    const querySignals = getQuerySignals(query);
    const results = await retriever.search(query, {
      limit: searchLimit,
      skipReinforcement: true,
    });

    let mapped = results
      .map((result) => this.mapResult(result.object.id, result.object.content, result.score, messageIndex))
      .filter((result): result is AlexandriaSearchResult => Boolean(result));

    if (querySignals.useFacts && factRecords.length > 0) {
      const factMatches = selectFactMatches(query, factRecords, limit * 2);
      const factResults = factMatchesToResults(factMatches);
      mapped = mergeResults(mapped, factResults);

      const hint = synthesizeAnswerHint(query, factMatches, querySignals);
      if (hint) {
        mapped = mergeResults([hint], mapped);
      }
    }

    if (querySignals.useDiversity) {
      mapped = diversifyBySession(mapped);
    }

    if (this.useContextExpansion) {
      mapped = await this.expandWithSessionContext(mapped, containerTag, store, limit * 2);
    }

    if (this.useSessionGrouping) {
      mapped = this.groupResultsBySession(mapped, containerTag, store);
    }

    return mapped
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Clear all data for a container
   */
  async clear(containerTag: string): Promise<void> {
    const db = containerDatabases.get(containerTag);
    if (db) {
      db.close();
      containerDatabases.delete(containerTag);
    }
    vectorIndexes.delete(containerTag);
    messageIndexes.delete(containerTag);
    sessionTimelines.delete(containerTag);
    factRecordsByContainer.delete(containerTag);
    console.log(`[Alexandria] Cleared container ${containerTag}`);
  }

  /**
   * Get or create database for a container
   */
  private getDatabase(containerTag: string): Database {
    let db = containerDatabases.get(containerTag);
    if (!db) {
      db = getMemoryConnection();
      containerDatabases.set(containerTag, db);
    }
    return db;
  }

  /**
   * Expand results with adjacent messages from the same session
   */
  private async expandWithSessionContext(
    results: AlexandriaSearchResult[],
    containerTag: string,
    store: MemoryObjectStore,
    maxResults: number,
  ): Promise<AlexandriaSearchResult[]> {
    const timelines = sessionTimelines.get(containerTag);
    const messageIndex = messageIndexes.get(containerTag);

    if (!timelines || !messageIndex) {
      return results;
    }

    const expandedResults: AlexandriaSearchResult[] = [];
    const seenIds = new Set<string>();

    for (const result of results) {
      if (!seenIds.has(result.id)) {
        expandedResults.push(result);
        seenIds.add(result.id);
      }
    }

    for (const result of results) {
      const timeline = timelines.find((t) => t.sessionId === result.sessionId);
      if (!timeline) continue;

      const messageIndexInTimeline = timeline.messageIds.indexOf(result.id);
      if (messageIndexInTimeline === -1) continue;

      const adjacentIndices = [messageIndexInTimeline - 1, messageIndexInTimeline + 1];
      for (const adjIdx of adjacentIndices) {
        if (adjIdx >= 0 && adjIdx < timeline.messageIds.length) {
          const messageId = timeline.messageIds[adjIdx];
          if (seenIds.has(messageId)) continue;

          const message = store.get(messageId);
          const meta = messageIndex.get(messageId);
          if (message && meta) {
            expandedResults.push({
              id: message.id,
              content: message.content,
              score: result.score * 0.7,
              sessionId: meta.sessionId,
              role: meta.role,
              timestamp: meta.timestamp,
            });
            seenIds.add(messageId);
          }
        }
      }
    }

    return expandedResults
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);
  }

  /**
   * Group results by session and order messages in conversation flow
   */
  private groupResultsBySession(
    results: AlexandriaSearchResult[],
    containerTag: string,
    store: MemoryObjectStore,
  ): AlexandriaSearchResult[] {
    const timelines = sessionTimelines.get(containerTag);
    const messageIndex = messageIndexes.get(containerTag);

    if (!timelines || !messageIndex) {
      return results;
    }

    const sessionGroups = new Map<string, AlexandriaSearchResult[]>();
    const sessionScores = new Map<string, number>();

    for (const result of results) {
      if (!sessionGroups.has(result.sessionId)) {
        sessionGroups.set(result.sessionId, []);
        sessionScores.set(result.sessionId, 0);
      }
      sessionGroups.get(result.sessionId)!.push(result);
      sessionScores.set(result.sessionId, Math.max(sessionScores.get(result.sessionId)!, result.score));
    }

    const groupedResults: AlexandriaSearchResult[] = [];
    const sortedSessions = [...sessionGroups.entries()].sort(
      (a, b) => sessionScores.get(b[0])! - sessionScores.get(a[0])!,
    );

    for (const [sessionId, sessionResults] of sortedSessions) {
      const timeline = timelines.find((t) => t.sessionId === sessionId);
      if (!timeline) {
        groupedResults.push(...sessionResults);
        continue;
      }

      const matchedIndices = sessionResults
        .map((r) => timeline.messageIds.indexOf(r.id))
        .filter((i) => i !== -1)
        .sort((a, b) => a - b);

      if (matchedIndices.length === 0) {
        groupedResults.push(...sessionResults);
        continue;
      }

      const startIdx = Math.max(0, matchedIndices[0] - 2);
      const endIdx = Math.min(timeline.messageIds.length - 1, matchedIndices[matchedIndices.length - 1] + 2);

      for (let i = startIdx; i <= endIdx; i++) {
        const messageId = timeline.messageIds[i];
        const existingResult = sessionResults.find((r) => r.id === messageId);
        if (existingResult) {
          groupedResults.push(existingResult);
          continue;
        }

        const message = store.get(messageId);
        const meta = messageIndex.get(messageId);
        if (message && meta) {
          groupedResults.push({
            id: message.id,
            content: message.content,
            score: sessionScores.get(sessionId)! * 0.5,
            sessionId: meta.sessionId,
            role: meta.role,
            timestamp: meta.timestamp,
          });
        }
      }
    }

    return groupedResults;
  }

  private mapResult(
    id: string,
    content: string,
    score: number,
    messageIndex: Map<string, MessageMeta>,
  ): AlexandriaSearchResult | null {
    const meta = messageIndex.get(id);
    if (!meta) {
      return null;
    }

    return {
      id,
      content,
      score,
      sessionId: meta.sessionId,
      role: meta.role,
      timestamp: meta.timestamp,
    };
  }

}

export function createAlexandriaProvider(): Provider {
  return new AlexandriaProvider();
}

function mergeResults(
  base: AlexandriaSearchResult[],
  extra: AlexandriaSearchResult[],
): AlexandriaSearchResult[] {
  const merged = new Map<string, AlexandriaSearchResult>();
  for (const result of [...base, ...extra]) {
    const existing = merged.get(result.id);
    if (!existing || existing.score < result.score) {
      merged.set(result.id, result);
    }
  }
  return Array.from(merged.values());
}

function factMatchesToResults(matches: FactMatch[]): AlexandriaSearchResult[] {
  return matches.map(({ fact, score }) => ({
    id: fact.id,
    content: fact.content,
    score,
    sessionId: fact.sessionId,
    role: fact.role,
    timestamp: fact.timestamp,
  }));
}

function selectFactMatches(
  query: string,
  facts: FactRecord[],
  limit: number,
): FactMatch[] {
  const names = extractNames(query);
  const keywords = extractKeywords(query);
  const signals = getQuerySignals(query);

  return facts
    .map((fact) => {
      const score = scoreFact(fact, names, keywords, signals);
      return { fact, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function synthesizeAnswerHint(
  query: string,
  matches: FactMatch[],
  signals: ReturnType<typeof getQuerySignals>,
): AlexandriaSearchResult | null {
  if (matches.length === 0) {
    return null;
  }

  const lower = query.toLowerCase();
  if (signals.isCounting) {
    return null;
  }

  const chosen = pickHintFact(matches, lower, signals);
  if (!chosen) {
    return null;
  }

  const hintContent = chosen.content.replace(/^Fact:\s*/i, '');
  return {
    id: `${chosen.id}_hint`,
    content: `Hint: ${hintContent}`,
    score: chosen.score + 2,
    sessionId: chosen.sessionId,
    role: 'assistant',
    timestamp: chosen.timestamp,
  };
}

function pickHintFact(
  matches: FactMatch[],
  queryLower: string,
  signals: ReturnType<typeof getQuerySignals>,
): FactMatch['fact'] & { score: number } | null {
  const wantsIdentity = /identity|identify|identifies/.test(queryLower);
  const wantsField = /field|career|job|work|profession/.test(queryLower);

  const ordered = matches
    .map((match) => match)
    .sort((a, b) => b.score - a.score);

  for (const match of ordered) {
    const content = match.fact.content.toLowerCase();
    if (wantsIdentity && content.includes('identity')) {
      return { ...match.fact, score: match.score };
    }
    if (wantsField && content.includes('field')) {
      return { ...match.fact, score: match.score };
    }
  }

  if (signals.isTemporal) {
    const temporal = ordered.find((match) => Boolean(match.fact.time));
    if (temporal) {
      return { ...temporal.fact, score: temporal.score };
    }
  }

  return ordered[0] ? { ...ordered[0].fact, score: ordered[0].score } : null;
}

function extractNames(query: string): string[] {
  const matches = query.match(/\b[A-Z][a-z]+\b/g) ?? [];
  const exclude = new Set(['What', 'When', 'Where', 'Why', 'How', 'Which', 'Who']);
  return matches.filter((name) => !exclude.has(name)).map((name) => name.toLowerCase());
}

function extractKeywords(query: string): string[] {
  const tokens = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const stopwords = new Set([
    'what', 'when', 'where', 'why', 'how', 'which', 'who', 'did', 'does', 'do', 'is', 'are',
    'was', 'were', 'be', 'been', 'being', 'the', 'a', 'an', 'to', 'of', 'in', 'on', 'for',
    'with', 'and', 'or', 'but', 'about', 'into', 'during', 'after', 'before', 'over', 'under',
    'between', 'both', 'compare', 'versus', 'vs', 'together', 'relationship', 'likely',
  ]);

  return tokens.filter((token) => token.length >= 3 && !stopwords.has(token));
}

function scoreFact(
  fact: FactRecord,
  names: string[],
  keywords: string[],
  signals: ReturnType<typeof getQuerySignals>,
): number {
  let score = 0;
  const content = fact.content.toLowerCase();

  if (names.length > 0) {
    const subject = fact.subject.toLowerCase();
    if (names.includes(subject)) {
      score += 3;
    }
  }

  for (const keyword of keywords) {
    if (content.includes(keyword)) {
      score += 1;
    }
  }

  if (signals.isCounting && fact.predicate === 'went_to') {
    score += 2;
  }

  if (signals.isMultiHop && names.length > 1) {
    const subject = fact.subject.toLowerCase();
    if (names.includes(subject)) {
      score += 1;
    }
  }

  return score;
}

function getQuerySignals(query: string): {
  isCounting: boolean;
  isMultiHop: boolean;
  isTemporal: boolean;
  useFacts: boolean;
  useDiversity: boolean;
} {
  const lower = query.toLowerCase();
  const isCounting = /how many|number of|times\b|count\b/.test(lower);
  const isMultiHop = /and|both|compare|versus|vs\b|together|relationship|between/.test(lower);
  const isTemporal =
    /when|what date|what time|how long ago|before|after|during|last\s+\w+|next\s+\w+/.test(
      lower,
    );
  return {
    isCounting,
    isMultiHop,
    isTemporal,
    useFacts: isCounting || isMultiHop || isTemporal,
    useDiversity: isCounting || isMultiHop || isTemporal,
  };
}

function diversifyBySession(
  results: AlexandriaSearchResult[],
): AlexandriaSearchResult[] {
  const primary: AlexandriaSearchResult[] = [];
  const rest: AlexandriaSearchResult[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    if (seen.has(result.sessionId)) {
      rest.push(result);
      continue;
    }
    primary.push(result);
    seen.add(result.sessionId);
  }

  return primary.concat(rest);
}
