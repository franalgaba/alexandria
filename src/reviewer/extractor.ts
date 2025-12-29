/**
 * Extractor - extract memory candidates from events
 */

import type { Database } from 'bun:sqlite';
import { EventStore } from '../stores/events.ts';
import type { Event } from '../types/events.ts';
import type { Confidence, MemoryCandidate, ObjectType } from '../types/memory-objects.ts';

// Patterns for extracting potential memory objects
const EXTRACTION_PATTERNS: Record<ObjectType, RegExp[]> = {
  failed_attempt: [
    /(?:error|failed|doesn't work|broke|segfault|crash)/i,
    /(?:tried|attempted|but|however).*(?:didn't|failed|error)/i,
    /not working/i,
    /doesn't compile/i,
    /broke the build/i,
    /exit code [1-9]/i,
    /exception|traceback|stack trace/i,
    /undefined is not|cannot read property/i,
  ],
  decision: [
    /(?:chose|decided|going with|using|switched to)/i,
    /(?:instead of|rather than|over)/i,
    /let's use/i,
    /we should/i,
    /going forward/i,
    /I'll implement/i,
    /the approach is/i,
    /we'll go with/i,
  ],
  constraint: [
    /(?:must|always|never|required|cannot)/i,
    /(?:strict mode|no implicit|forbidden)/i,
    /don't ever/i,
    /make sure to always/i,
    /critical/i,
    /security|vulnerability|cve-/i,
    /breaking change/i,
    /deprecated/i,
  ],
  known_fix: [
    /(?:fixed by|solution:|workaround:|use .* instead)/i,
    /(?:the fix is|resolved by|works when)/i,
    /that fixed it/i,
    /solved by/i,
    /the issue was/i,
    /turns out/i,
    /the problem was/i,
    /now it works/i,
  ],
  convention: [
    /(?:convention|pattern|style|format|naming)/i,
    /(?:we use|always use|standard is)/i,
    /in this codebase/i,
    /our style/i,
    /following the pattern/i,
    /consistent with/i,
    /as we do in/i,
  ],
  preference: [
    /(?:prefer|like|better|rather)/i,
    /(?:usually|typically|generally)/i,
    /i prefer/i,
    /works better/i,
    /cleaner|simpler|easier/i,
    /more readable/i,
  ],
  environment: [
    /(?:version|node|python|bun|npm)/i,
    /(?:config|env|environment)/i,
    /running on/i,
    /using version/i,
    /requires.*version/i,
    /installed|package\.json/i,
  ],
};

// Confidence thresholds based on pattern match strength
const CONFIDENCE_MAP: Record<number, Confidence> = {
  1: 'low',
  2: 'medium',
  3: 'high',
};

export class Extractor {
  private eventStore: EventStore;

  constructor(db: Database) {
    this.eventStore = new EventStore(db);
  }

  /**
   * Extract memory candidates from a session's events
   */
  extractFromSession(sessionId: string): MemoryCandidate[] {
    const events = this.eventStore.getBySession(sessionId);
    return this.extractFromEvents(events);
  }

  /**
   * Extract memory candidates from a list of events
   */
  extractFromEvents(events: Event[]): MemoryCandidate[] {
    const candidates: MemoryCandidate[] = [];

    for (const event of events) {
      const content = this.eventStore.getContent(event);
      if (!content) continue;

      const eventCandidates = this.extractFromContent(content, event.id);
      candidates.push(...eventCandidates);
    }

    return this.deduplicateCandidates(candidates);
  }

  /**
   * Extract candidates from a single piece of content
   */
  extractFromContent(content: string, eventId?: string): MemoryCandidate[] {
    const candidates: MemoryCandidate[] = [];

    // Split into sentences for better extraction
    const sentences = this.splitIntoSentences(content);

    for (const sentence of sentences) {
      const candidate = this.matchPatterns(sentence, eventId);
      if (candidate) {
        candidates.push(candidate);
      }
    }

    return candidates;
  }

  /**
   * Match patterns against content
   */
  private matchPatterns(content: string, eventId?: string): MemoryCandidate | null {
    let bestMatch: {
      type: ObjectType;
      matchCount: number;
      content: string;
    } | null = null;

    for (const [type, patterns] of Object.entries(EXTRACTION_PATTERNS) as [
      ObjectType,
      RegExp[],
    ][]) {
      let matchCount = 0;
      for (const pattern of patterns) {
        if (pattern.test(content)) {
          matchCount++;
        }
      }

      if (matchCount > 0 && (!bestMatch || matchCount > bestMatch.matchCount)) {
        bestMatch = {
          type,
          matchCount,
          content: this.extractRelevantPortion(content),
        };
      }
    }

    if (!bestMatch) return null;

    const confidence = CONFIDENCE_MAP[Math.min(bestMatch.matchCount, 3)] || 'low';

    return {
      content: bestMatch.content,
      suggestedType: bestMatch.type,
      evidenceEventIds: eventId ? [eventId] : [],
      evidenceExcerpt: content.slice(0, 200),
      confidence,
    };
  }

  /**
   * Extract the relevant portion of content
   */
  private extractRelevantPortion(content: string): string {
    // Clean up and truncate
    const cleaned = content
      .replace(/\s+/g, ' ')
      .replace(/```[\s\S]*?```/g, '[code block]')
      .trim();

    // Limit to reasonable length
    return cleaned.slice(0, 500);
  }

  /**
   * Split content into sentences
   */
  private splitIntoSentences(content: string): string[] {
    // Simple sentence splitting
    const sentences = content
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 10);

    // Also consider line breaks as sentence boundaries
    const lines = content
      .split(/\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 10);

    // Combine and deduplicate
    const all = [...new Set([...sentences, ...lines])];

    return all;
  }

  /**
   * Deduplicate similar candidates
   */
  private deduplicateCandidates(candidates: MemoryCandidate[]): MemoryCandidate[] {
    const unique: MemoryCandidate[] = [];
    const seen = new Set<string>();

    for (const candidate of candidates) {
      // Create a simple hash of the content
      const hash = this.simpleHash(candidate.content.toLowerCase());

      if (!seen.has(hash)) {
        seen.add(hash);
        unique.push(candidate);
      }
    }

    return unique;
  }

  /**
   * Simple string hash for deduplication
   */
  private simpleHash(str: string): string {
    // Take first 50 chars and normalize
    const normalized = str.slice(0, 50).replace(/\s+/g, ' ').trim();
    return normalized;
  }
}
