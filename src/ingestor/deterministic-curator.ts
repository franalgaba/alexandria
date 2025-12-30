/**
 * Tier 0 Curator - Deterministic Heuristics
 * 
 * Zero-cost pattern detection for high-signal memory extraction.
 * Focuses on:
 * - Error → Resolution patterns
 * - User corrections (constraints)
 * - Repeated patterns (conventions)
 * 
 * Does NOT extract decisions or preferences (too noisy for regex).
 */

import type { Event } from '../types/events.ts';
import type { MemoryCandidate, ObjectType } from '../types/memory-objects.ts';

// Minimum occurrences to consider a pattern as convention
const CONVENTION_THRESHOLD = 3;

// Minimum time between error and success to consider it a resolution
const RESOLUTION_WINDOW_MS = 300000; // 5 minutes

export interface Episode {
  events: Event[];
  startTime: Date;
  endTime: Date;
  toolSequences: ToolSequence[];
}

interface ToolSequence {
  toolName: string;
  exitCode?: number;
  output: string;
  timestamp: Date;
  eventId: string;
}

interface ErrorResolution {
  errorEvent: Event;
  errorSignature: string;
  resolutionEvent: Event;
  resolutionDescription: string;
}

interface UserCorrection {
  content: string;
  severity: 'must' | 'should';
  context?: string;
}

interface RepeatedPattern {
  pattern: string;
  occurrences: number;
  contexts: string[];
}

export class DeterministicCurator {
  /**
   * Extract high-confidence candidates from an episode
   */
  extractCandidates(episode: Episode): MemoryCandidate[] {
    const candidates: MemoryCandidate[] = [];

    // 1. Error → Resolution patterns (known_fix)
    const resolutions = this.detectErrorResolutions(episode);
    for (const resolution of resolutions) {
      candidates.push(this.createKnownFixCandidate(resolution, episode));
    }

    // 2. User corrections (constraint)
    const corrections = this.detectUserCorrections(episode);
    for (const correction of corrections) {
      candidates.push(this.createConstraintCandidate(correction, episode));
    }

    // 3. Repeated patterns (convention)
    const patterns = this.detectRepeatedPatterns(episode);
    for (const pattern of patterns) {
      candidates.push(this.createConventionCandidate(pattern, episode));
    }

    return candidates;
  }

  /**
   * Detect error → multiple attempts → success patterns
   */
  private detectErrorResolutions(episode: Episode): ErrorResolution[] {
    const resolutions: ErrorResolution[] = [];
    const sequences = episode.toolSequences;

    for (let i = 0; i < sequences.length; i++) {
      const errorSeq = sequences[i];
      
      // Skip if not an error
      if (errorSeq.exitCode === undefined || errorSeq.exitCode === 0) {
        continue;
      }

      // Extract error signature
      const errorSig = this.extractErrorSignature(errorSeq.output);
      if (!errorSig) continue;

      // Look for successful resolution within window
      for (let j = i + 1; j < sequences.length; j++) {
        const successSeq = sequences[j];
        
        // Check if it's a success
        if (successSeq.exitCode !== 0) continue;

        // Check if within time window
        const timeDiff = successSeq.timestamp.getTime() - errorSeq.timestamp.getTime();
        if (timeDiff > RESOLUTION_WINDOW_MS) break;

        // Extract resolution description
        const resolution = this.extractResolutionDescription(
          errorSeq,
          successSeq,
          episode.events
        );

        if (resolution) {
          const errorEvent = episode.events.find(e => e.id === errorSeq.eventId);
          const successEvent = episode.events.find(e => e.id === successSeq.eventId);

          if (errorEvent && successEvent) {
            resolutions.push({
              errorEvent,
              errorSignature: errorSig,
              resolutionEvent: successEvent,
              resolutionDescription: resolution,
            });
            break; // Found resolution for this error
          }
        }
      }
    }

    return resolutions;
  }

  /**
   * Extract error signature from tool output
   */
  private extractErrorSignature(output: string): string | null {
    // Common error patterns
    const patterns = [
      // TypeScript errors
      /error TS\d+: (.+?)(?:\n|$)/,
      // Runtime errors
      /Error: (.+?)(?:\n|at\s)/,
      // Test failures
      /FAIL (.+?)(?:\n|$)/,
      // Generic errors
      /(?:error|failed|exception):\s*(.+?)(?:\n|$)/i,
    ];

    for (const pattern of patterns) {
      const match = output.match(pattern);
      if (match) {
        return match[1].trim().slice(0, 200);
      }
    }

    return null;
  }

  /**
   * Extract description of what fixed the error
   */
  private extractResolutionDescription(
    errorSeq: ToolSequence,
    successSeq: ToolSequence,
    events: Event[]
  ): string | null {
    // Look for events between error and success that describe the fix
    const errorIdx = events.findIndex(e => e.id === errorSeq.eventId);
    const successIdx = events.findIndex(e => e.id === successSeq.eventId);

    if (errorIdx === -1 || successIdx === -1) return null;

    const betweenEvents = events.slice(errorIdx + 1, successIdx);

    // Look for fix indicators in conversation
    const fixPatterns = [
      /(?:fix|fixed|solved|resolved)\s+(?:by|with|via)\s+(.+?)(?:\.|$)/i,
      /(?:the\s+)?(?:issue|problem)\s+was\s+(.+?)(?:\.|$)/i,
      /(?:changed|modified|updated|added)\s+(.+?)(?:\.|$)/i,
    ];

    for (const event of betweenEvents) {
      if (!event.content) continue;

      for (const pattern of fixPatterns) {
        const match = event.content.match(pattern);
        if (match) {
          return match[1].trim().slice(0, 300);
        }
      }
    }

    // Fallback: describe the successful tool call
    if (successSeq.toolName === 'edit' || successSeq.toolName === 'write') {
      return `Applied ${successSeq.toolName} operation`;
    }

    return null;
  }

  /**
   * Detect user corrections (strong signal for constraints)
   */
  private detectUserCorrections(episode: Episode): UserCorrection[] {
    const corrections: UserCorrection[] = [];

    // Patterns that indicate user is correcting/constraining
    const mustPatterns = [
      /(?:don't|do not|never)\s+(.{10,}?)(?:\.|$)/i,
      /(?:must|required to|have to)\s+always\s+(.{10,}?)(?:\.|$)/i,
      /(?:you\s+)?(?:must|should)\s+never\s+(.{10,}?)(?:\.|$)/i,
    ];

    const shouldPatterns = [
      /(?:please\s+)?(?:always|make sure to)\s+(.{10,}?)(?:\.|$)/i,
      /(?:you\s+)?should\s+(?:always\s+)?(.{10,}?)(?:\.|$)/i,
      /(?:instead|rather),?\s+(.{10,}?)(?:\.|$)/i,
    ];

    for (const event of episode.events) {
      if (!event.content || event.eventType !== 'turn') continue;

      // Check for "no" or correction language
      const isCorrection = /^(?:no|nope|wrong|incorrect|don't|stop)/i.test(event.content.trim());

      // Must patterns (hard constraints)
      for (const pattern of mustPatterns) {
        const match = event.content.match(pattern);
        if (match) {
          corrections.push({
            content: match[0].trim(),
            severity: 'must',
            context: isCorrection ? 'user_correction' : undefined,
          });
        }
      }

      // Should patterns (soft constraints)
      if (isCorrection) {
        for (const pattern of shouldPatterns) {
          const match = event.content.match(pattern);
          if (match) {
            corrections.push({
              content: match[0].trim(),
              severity: 'should',
              context: 'user_correction',
            });
          }
        }
      }
    }

    return corrections;
  }

  /**
   * Detect repeated patterns (conventions)
   */
  private detectRepeatedPatterns(episode: Episode): RepeatedPattern[] {
    const patterns = new Map<string, string[]>();

    // Patterns that indicate conventions
    const conventionIndicators = [
      /(?:use|using)\s+(\w+(?:\s+\w+){0,3})\s+for\s+(.+?)(?:\.|$)/i,
      /(?:name|naming)\s+(.+?)\s+(?:as|like)\s+(.+?)(?:\.|$)/i,
      /(?:follow|following)\s+(?:the\s+)?(.+?)\s+(?:pattern|convention)(?:\.|$)/i,
    ];

    for (const event of episode.events) {
      if (!event.content) continue;

      for (const pattern of conventionIndicators) {
        const match = event.content.match(pattern);
        if (match) {
          const key = match[0].toLowerCase().trim();
          const existing = patterns.get(key) || [];
          existing.push(event.content.slice(0, 200));
          patterns.set(key, existing);
        }
      }
    }

    // Filter to only patterns with multiple occurrences
    const repeated: RepeatedPattern[] = [];
    for (const [pattern, contexts] of patterns.entries()) {
      if (contexts.length >= CONVENTION_THRESHOLD) {
        repeated.push({
          pattern,
          occurrences: contexts.length,
          contexts,
        });
      }
    }

    return repeated;
  }

  /**
   * Create known_fix candidate from error resolution
   */
  private createKnownFixCandidate(
    resolution: ErrorResolution,
    episode: Episode
  ): MemoryCandidate {
    const content = `When encountering "${resolution.errorSignature}", the fix is: ${resolution.resolutionDescription}`;

    return {
      content: content.slice(0, 500),
      suggestedType: 'known_fix',
      evidenceEventIds: [resolution.errorEvent.id, resolution.resolutionEvent.id],
      evidenceExcerpt: resolution.errorSignature,
      confidence: 'high',
    };
  }

  /**
   * Create constraint candidate from user correction
   */
  private createConstraintCandidate(
    correction: UserCorrection,
    episode: Episode
  ): MemoryCandidate {
    return {
      content: correction.content.slice(0, 500),
      suggestedType: 'constraint',
      evidenceEventIds: episode.events.map(e => e.id),
      evidenceExcerpt: correction.context,
      confidence: correction.severity === 'must' ? 'high' : 'medium',
    };
  }

  /**
   * Create convention candidate from repeated pattern
   */
  private createConventionCandidate(
    pattern: RepeatedPattern,
    episode: Episode
  ): MemoryCandidate {
    const content = `Convention: ${pattern.pattern} (observed ${pattern.occurrences}x)`;

    return {
      content: content.slice(0, 500),
      suggestedType: 'convention',
      evidenceEventIds: episode.events.map(e => e.id),
      evidenceExcerpt: `Pattern repeated ${pattern.occurrences} times`,
      confidence: pattern.occurrences >= 5 ? 'high' : 'medium',
    };
  }

  /**
   * Build episode from events
   */
  buildEpisode(events: Event[]): Episode {
    if (events.length === 0) {
      throw new Error('Cannot build episode from empty events');
    }

    const toolSequences: ToolSequence[] = [];

    for (const event of events) {
      if (event.eventType === 'tool_output' && event.toolName) {
        toolSequences.push({
          toolName: event.toolName,
          exitCode: event.exitCode,
          output: event.content || '',
          timestamp: event.timestamp,
          eventId: event.id,
        });
      }
    }

    return {
      events,
      startTime: events[0].timestamp,
      endTime: events[events.length - 1].timestamp,
      toolSequences,
    };
  }
}
