/**
 * Real-time memory extractor - extracts memories as events are ingested
 * 
 * IMPORTANT: This extractor is intentionally conservative to avoid noise.
 * It focuses on high-signal patterns and requires multiple pattern matches.
 * For better extraction, use session-end summarization with LLM.
 */

import type { Database } from 'bun:sqlite';
import { VectorIndex } from '../indexes/vector.ts';
import { MemoryObjectStore } from '../stores/memory-objects.ts';
import type { Event } from '../types/events.ts';
import type { Confidence, MemoryCandidate, ObjectType } from '../types/memory-objects.ts';

// Patterns for extracting potential memory objects
// These are intentionally strict to reduce false positives
const EXTRACTION_PATTERNS: Record<ObjectType, RegExp[]> = {
  failed_attempt: [
    // Explicit failure statements with context
    /(?:tried|attempted)\s+.{10,}?\s+but\s+(?:it\s+)?(?:didn't|failed|broke)/i,
    /this\s+(?:approach|method|solution)\s+(?:doesn't|didn't)\s+work/i,
    /(?:got|getting|received)\s+(?:an?\s+)?error\s+when/i,
    // Don't match generic error messages - only insights about failures
  ],
  decision: [
    // Explicit decision statements with reasoning
    /(?:^|\.\s+)(?:I|we)\s+(?:chose|decided\s+to|will\s+use|going\s+with)\s+.{5,}\s+(?:because|since|as|for)/i,
    /(?:^|\.\s+)(?:instead\s+of|rather\s+than)\s+.{5,},?\s+(?:we|I|let's)\s+(?:use|will|should)/i,
    /(?:^|\.\s+)the\s+(?:decision|choice)\s+(?:is|was)\s+to\s+/i,
    /(?:^|\.\s+)(?:switching|switched)\s+(?:from|to)\s+.{3,}\s+(?:because|since|for)/i,
  ],
  constraint: [
    // Hard rules with explicit language
    /(?:^|\.\s+)(?:you\s+)?must\s+(?:always|never)?\s*.{5,}/i,
    /(?:^|\.\s+)(?:always|never)\s+(?:use|do|call|import|include)\s+/i,
    /(?:^|\.\s+)(?:do\s+not|don't|cannot|can't)\s+.{5,}\s+(?:because|since|or\s+else|otherwise)/i,
    /(?:^|\.\s+)(?:required|mandatory|forbidden|prohibited):\s+/i,
    /(?:^|\.\s+)this\s+(?:is|was)\s+(?:a\s+)?(?:security|breaking|critical)\s+/i,
  ],
  known_fix: [
    // Explicit fix statements
    /(?:^|\.\s+)(?:the\s+)?(?:fix|solution|workaround)\s+(?:is|was)\s+to\s+/i,
    /(?:^|\.\s+)(?:fixed|resolved|solved)\s+(?:it\s+)?by\s+/i,
    /(?:^|\.\s+)(?:the\s+)?(?:issue|problem|bug)\s+was\s+(?:that|caused\s+by)\s+/i,
    /(?:^|\.\s+)(?:it\s+)?works\s+(?:now\s+)?(?:after|when|if)\s+(?:you\s+)?/i,
    /(?:^|\.\s+)turns\s+out\s+(?:that\s+)?(?:you\s+)?(?:need|have)\s+to\s+/i,
  ],
  convention: [
    // Explicit coding standards
    /(?:^|\.\s+)(?:in\s+this\s+(?:project|codebase|repo),?\s+)?we\s+(?:always\s+)?use\s+/i,
    /(?:^|\.\s+)(?:the\s+)?(?:convention|standard|pattern)\s+(?:here\s+)?is\s+to\s+/i,
    /(?:^|\.\s+)(?:follow|following)\s+(?:the\s+)?(?:pattern|convention)\s+of\s+/i,
    /(?:^|\.\s+)(?:for\s+)?(?:naming|formatting|styling),?\s+(?:we\s+)?use\s+/i,
  ],
  preference: [
    // Explicit preferences with reasoning
    /(?:^|\.\s+)(?:I|we)\s+prefer\s+.{5,}\s+(?:because|since|as|for)/i,
    /(?:^|\.\s+).{5,}\s+is\s+(?:cleaner|simpler|better|easier)\s+(?:than|because)/i,
    /(?:^|\.\s+)(?:it's\s+)?(?:better|preferred)\s+to\s+.{5,}\s+(?:rather\s+than|instead\s+of)/i,
  ],
  environment: [
    // Explicit version/config requirements
    /(?:^|\.\s+)(?:requires?|needs?)\s+(?:version\s+)?[\w.-]+\s+(?:v?[\d.]+|or\s+(?:higher|later|above))/i,
    /(?:^|\.\s+)(?:using|running|installed)\s+(?:version\s+)?[\w.-]+\s+v?[\d.]+/i,
    /(?:^|\.\s+)(?:set|configure|add)\s+.{3,}\s+(?:in\s+)?(?:the\s+)?(?:env|environment|config)/i,
  ],
};

// Patterns that indicate content should be EXCLUDED
const EXCLUDE_PATTERNS: RegExp[] = [
  /^```/,                                    // Code block start
  /^[\s]*[{}()\[\];,][\s]*$/,               // Single punctuation
  /^[\s]*\/\//,                              // Comment line
  /^[\s]*#(?!\s)/,                           // Comment (but not markdown headers)
  /^\d+\.\s+/,                               // Numbered list items
  /^[-*]\s+/,                                // Bullet points (likely examples)
  /^(?:let\s+me|now\s+I|first|then|next)/i,  // Meta-commentary
  /^(?:here's|here\s+is)/i,                  // Introduction phrases
  /^(?:the\s+)?(?:output|result)\s+(?:is|was|shows)/i, // Output descriptions
  /(?:error|exception|traceback)\s*:/i,      // Error labels
  /at\s+[\w./<>]+:\d+/,                      // Stack trace lines
  /^\s*\|/,                                  // Table rows
  /https?:\/\/\S+/,                          // URLs
  /^\/[\w/.-]+$/,                            // File paths alone
  /^\s*import\s+/,                           // Import statements
  /^\s*(?:const|let|var|function)\s+/,       // Variable declarations
  /\(\s*\d+\s*(?:bytes?|KB|MB|ms|s)\s*\)/,   // Size/time measurements
];

// Minimum content length to consider for extraction
const MIN_CONTENT_LENGTH = 40;

// Minimum word count for meaningful content
const MIN_WORD_COUNT = 6;

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
   * Check if content should be excluded (noise, code, etc.)
   */
  private shouldExclude(content: string): boolean {
    // Check against exclusion patterns
    for (const pattern of EXCLUDE_PATTERNS) {
      if (pattern.test(content)) {
        return true;
      }
    }

    // Check minimum word count
    const words = content.split(/\s+/).filter(w => w.length > 1);
    if (words.length < MIN_WORD_COUNT) {
      return true;
    }

    // Exclude if mostly code-like (high ratio of special characters)
    const specialChars = (content.match(/[{}()\[\];:=<>]/g) || []).length;
    const alphaChars = (content.match(/[a-zA-Z]/g) || []).length;
    if (alphaChars > 0 && specialChars / alphaChars > 0.3) {
      return true;
    }

    // Exclude if it looks like a command or path
    if (/^[a-z]+\s+[a-z-]+\s*/.test(content) && !content.includes(' because') && !content.includes(' to ')) {
      return true;
    }

    return false;
  }

  /**
   * Match patterns against content
   */
  private matchPatterns(content: string, event: Event): MemoryCandidate | null {
    // First check exclusions
    if (this.shouldExclude(content)) {
      return null;
    }

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

    // Require at least 1 strong pattern match
    // (patterns are now stricter, so 1 match is meaningful)
    const confidence: Confidence = bestMatch.matchCount >= 2 ? 'high' : 'medium';

    // Skip for noisy event types unless high confidence
    if (confidence !== 'high' && (event.eventType === 'tool_output' || event.eventType === 'tool_call')) {
      return null;
    }

    // Additional validation: content should be actionable
    if (!this.isActionable(content)) {
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
   * Check if content is actionable (useful for future sessions)
   */
  private isActionable(content: string): boolean {
    // Must contain actionable verbs or clear guidance
    const actionablePatterns = [
      /\b(use|avoid|always|never|should|must|need|require|prefer)\b/i,
      /\b(because|since|to\s+(?:avoid|prevent|ensure|fix))\b/i,
      /\b(instead\s+of|rather\s+than|works?\s+when)\b/i,
      /\b(the\s+(?:fix|solution|issue|problem)\s+(?:is|was))\b/i,
    ];
    
    return actionablePatterns.some(p => p.test(content));
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
