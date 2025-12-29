/**
 * Real-time memory extractor - extracts memories as events are ingested
 */

import type { Database } from 'bun:sqlite';
import { VectorIndex } from '../indexes/vector.ts';
import { MemoryObjectStore } from '../stores/memory-objects.ts';
import type { Event } from '../types/events.ts';
import type { Confidence, MemoryCandidate, ObjectType } from '../types/memory-objects.ts';

// Patterns for extracting potential memory objects
const EXTRACTION_PATTERNS: Record<ObjectType, RegExp[]> = {
  failed_attempt: [
    /(?:error|failed|doesn't work|broke|segfault|crash)/i,
    /(?:tried|attempted|but|however).*(?:didn't|failed|error)/i,
    /not working/i,
    /doesn't compile/i,
    /exit code [1-9]/i,
    /exception|traceback|stack trace/i,
  ],
  decision: [
    /(?:chose|decided|going with|using|switched to)/i,
    /(?:instead of|rather than|over)/i,
    /let's use/i,
    /we should|we'll/i,
    /I'll implement|the approach is/i,
  ],
  constraint: [
    /(?:must|always|never|required|cannot)/i,
    /(?:strict mode|no implicit|forbidden)/i,
    /don't ever|make sure to always/i,
    /security|vulnerability/i,
    /breaking change|deprecated/i,
  ],
  known_fix: [
    /(?:fixed by|solution:|workaround:)/i,
    /(?:the fix is|resolved by|works when)/i,
    /that fixed it|solved by/i,
    /the issue was|the problem was/i,
    /now it works|turns out/i,
  ],
  convention: [
    /(?:convention|pattern|style|format|naming)/i,
    /(?:we use|always use|standard is)/i,
    /in this codebase|our style/i,
    /following the pattern|consistent with/i,
  ],
  preference: [
    /(?:prefer|like|better|rather)/i,
    /(?:usually|typically|generally)/i,
    /cleaner|simpler|easier|more readable/i,
  ],
  environment: [
    /(?:version|node|python|bun|npm)/i,
    /(?:config|env|environment)/i,
    /requires.*version/i,
  ],
};

// Minimum content length to consider for extraction
const MIN_CONTENT_LENGTH = 30;

// Maximum memories to extract per event
const MAX_MEMORIES_PER_EVENT = 3;

export class RealtimeExtractor {
  private store: MemoryObjectStore;
  private vector: VectorIndex;
  private recentHashes: Set<string> = new Set();

  constructor(db: Database) {
    this.store = new MemoryObjectStore(db);
    this.vector = new VectorIndex(db);
  }

  /**
   * Process an event and extract memories in real-time
   */
  async processEvent(event: Event, content: string): Promise<MemoryCandidate[]> {
    if (!content || content.length < MIN_CONTENT_LENGTH) {
      return [];
    }

    const candidates = this.extractFromContent(content, event);
    const created: MemoryCandidate[] = [];

    for (const candidate of candidates.slice(0, MAX_MEMORIES_PER_EVENT)) {
      // Skip duplicates (simple hash-based dedup)
      const hash = this.simpleHash(candidate.content);
      if (this.recentHashes.has(hash)) {
        continue;
      }
      this.recentHashes.add(hash);

      // Keep recent hashes bounded
      if (this.recentHashes.size > 1000) {
        const arr = Array.from(this.recentHashes);
        this.recentHashes = new Set(arr.slice(-500));
      }

      // Check for similar existing memories
      const isDuplicate = await this.checkDuplicate(candidate.content);
      if (isDuplicate) {
        continue;
      }

      // Create the memory object (pending review)
      const obj = this.store.create({
        content: candidate.content,
        objectType: candidate.suggestedType,
        confidence: candidate.confidence,
        evidenceEventIds: candidate.evidenceEventIds,
        evidenceExcerpt: candidate.evidenceExcerpt,
        reviewStatus: 'pending',
      });

      // Index for vector search
      await this.vector.indexObject(obj.id, obj.content);

      created.push(candidate);
    }

    return created;
  }

  /**
   * Extract candidates from content
   */
  private extractFromContent(content: string, event: Event): MemoryCandidate[] {
    const candidates: MemoryCandidate[] = [];
    const sentences = this.splitIntoSentences(content);

    for (const sentence of sentences) {
      const candidate = this.matchPatterns(sentence, event);
      if (candidate) {
        candidates.push(candidate);
      }
    }

    return candidates;
  }

  /**
   * Match patterns against content
   */
  private matchPatterns(content: string, event: Event): MemoryCandidate | null {
    let bestMatch: {
      type: ObjectType;
      matchCount: number;
    } | null = null;

    for (const [type, patterns] of Object.entries(EXTRACTION_PATTERNS) as [ObjectType, RegExp[]][]) {
      let matchCount = 0;
      for (const pattern of patterns) {
        if (pattern.test(content)) {
          matchCount++;
        }
      }

      if (matchCount > 0 && (!bestMatch || matchCount > bestMatch.matchCount)) {
        bestMatch = { type, matchCount };
      }
    }

    if (!bestMatch) return null;

    // Require at least 2 pattern matches for higher confidence
    const confidence: Confidence = bestMatch.matchCount >= 3 ? 'high' : 
                                   bestMatch.matchCount >= 2 ? 'medium' : 'low';

    // Skip low confidence matches for noisy event types
    if (confidence === 'low' && (event.eventType === 'tool_output' || event.eventType === 'tool_call')) {
      return null;
    }

    return {
      content: this.cleanContent(content),
      suggestedType: bestMatch.type,
      evidenceEventIds: [event.id],
      evidenceExcerpt: content.slice(0, 200),
      confidence,
    };
  }

  /**
   * Clean and normalize content
   */
  private cleanContent(content: string): string {
    return content
      .replace(/\s+/g, ' ')
      .replace(/```[\s\S]*?```/g, '[code]')
      .trim()
      .slice(0, 500);
  }

  /**
   * Split content into sentences
   */
  private splitIntoSentences(content: string): string[] {
    const sentences = content
      .split(/(?<=[.!?])\s+|\n+/)
      .map(s => s.trim())
      .filter(s => s.length >= MIN_CONTENT_LENGTH);

    return sentences;
  }

  /**
   * Check if similar memory already exists
   */
  private async checkDuplicate(content: string): Promise<boolean> {
    try {
      const results = await this.vector.searchObjects(content, 1);
      if (results.length > 0 && results[0].score > 0.9) {
        return true;
      }
    } catch {
      // Ignore errors
    }
    return false;
  }

  /**
   * Simple hash for deduplication
   */
  private simpleHash(str: string): string {
    return str.toLowerCase().slice(0, 100).replace(/\s+/g, ' ').trim();
  }
}
