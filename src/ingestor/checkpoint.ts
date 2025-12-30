/**
 * Checkpoint System - Replace continuous extraction with episodic curation
 * 
 * Implements the Checkpoint-Reset-Rehydrate loop:
 * 1. Detect checkpoint triggers (window pressure, task completion, etc.)
 * 2. Flush event buffer to store
 * 3. Run tiered curator on episode
 * 4. Update memory objects
 * 5. Generate fresh context pack (rehydration ready)
 */

import type { Database } from 'bun:sqlite';
import { EventStore } from '../stores/events.ts';
import { MemoryObjectStore } from '../stores/memory-objects.ts';
import { SessionStore } from '../stores/sessions.ts';
import type { Event } from '../types/events.ts';
import type { MemoryCandidate } from '../types/memory-objects.ts';
import { DeterministicCurator, type Episode } from './deterministic-curator.ts';
import { IntelligentExtractor, type LLMProvider } from './intelligent-extractor.ts';

export interface CheckpointTrigger {
  type: 'manual' | 'window_pressure' | 'task_complete' | 'topic_shift' | 'tool_burst';
  reason: string;
  metadata?: Record<string, any>;
}

export interface CheckpointResult {
  trigger: CheckpointTrigger;
  episodeEventCount: number;
  candidatesExtracted: number;
  memoriesCreated: number;
  memoriesUpdated: number;
  rehydrationReady: boolean;
}

export interface CheckpointConfig {
  // Window pressure threshold (0-1, as fraction of typical max)
  windowPressureThreshold: number;
  
  // Tool burst: number of tool outputs in time window
  toolBurstCount: number;
  toolBurstWindowMs: number;
  
  // Minimum events before checkpoint (avoid checkpointing too early)
  minEventsForCheckpoint: number;
  
  // Curator mode
  curatorMode: 'tier0' | 'tier1' | 'tier2';
  
  // LLM provider for tier1/tier2
  llmProvider?: LLMProvider;
}

const DEFAULT_CONFIG: CheckpointConfig = {
  windowPressureThreshold: 0.75,
  toolBurstCount: 10,
  toolBurstWindowMs: 120000, // 2 minutes
  minEventsForCheckpoint: 5,
  curatorMode: 'tier0', // Start conservative
};

export class Checkpoint {
  private db: Database;
  private eventStore: EventStore;
  private memoryStore: MemoryObjectStore;
  private sessionStore: SessionStore;
  private deterministicCurator: DeterministicCurator;
  private intelligentExtractor: IntelligentExtractor;
  private config: CheckpointConfig;
  
  // Event buffer (pending checkpoint)
  private buffer: Event[] = [];
  private lastCheckpointTime: Date = new Date();

  constructor(db: Database, config: Partial<CheckpointConfig> = {}) {
    this.db = db;
    this.eventStore = new EventStore(db);
    this.memoryStore = new MemoryObjectStore(db);
    this.sessionStore = new SessionStore(db);
    this.deterministicCurator = new DeterministicCurator();
    this.intelligentExtractor = new IntelligentExtractor(db, config.llmProvider);
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Add event to buffer and check for automatic checkpoint triggers
   */
  async addEvent(event: Event): Promise<CheckpointTrigger | null> {
    this.buffer.push(event);

    // Check for automatic triggers
    const trigger = this.detectTrigger();
    if (trigger) {
      await this.execute(trigger);
      return trigger;
    }

    return null;
  }

  /**
   * Manually trigger a checkpoint
   */
  async executeManual(reason: string = 'Manual checkpoint'): Promise<CheckpointResult> {
    const trigger: CheckpointTrigger = {
      type: 'manual',
      reason,
    };
    return this.execute(trigger);
  }

  /**
   * Execute checkpoint routine
   */
  async execute(trigger: CheckpointTrigger): Promise<CheckpointResult> {
    const startTime = Date.now();

    // 1. Validate buffer (skip for manual checkpoints)
    if (trigger.type !== 'manual' && this.buffer.length < this.config.minEventsForCheckpoint) {
      console.debug(`Skipping checkpoint: only ${this.buffer.length} events in buffer`);
      return {
        trigger,
        episodeEventCount: 0,
        candidatesExtracted: 0,
        memoriesCreated: 0,
        memoriesUpdated: 0,
        rehydrationReady: false,
      };
    }

    // Manual checkpoints need at least 1 event
    if (this.buffer.length === 0) {
      console.debug('Skipping checkpoint: buffer is empty');
      return {
        trigger,
        episodeEventCount: 0,
        candidatesExtracted: 0,
        memoriesCreated: 0,
        memoriesUpdated: 0,
        rehydrationReady: false,
      };
    }

    // 2. Build episode from buffer
    const episode = this.deterministicCurator.buildEpisode(this.buffer);

    // 3. Run tiered curator
    const candidates = await this.curate(episode);

    // 4. Apply extractions (create/update memory objects)
    const { created, updated } = await this.applyExtractions(candidates, episode);

    // 5. Clear buffer and update checkpoint time
    const episodeEventCount = this.buffer.length;
    this.buffer = [];
    this.lastCheckpointTime = new Date();

    const duration = Date.now() - startTime;
    console.debug(`Checkpoint completed in ${duration}ms: ${created} created, ${updated} updated`);

    return {
      trigger,
      episodeEventCount,
      candidatesExtracted: candidates.length,
      memoriesCreated: created,
      memoriesUpdated: updated,
      rehydrationReady: true,
    };
  }

  /**
   * Detect automatic checkpoint triggers
   */
  private detectTrigger(): CheckpointTrigger | null {
    if (this.buffer.length === 0) return null;

    // 1. Tool burst detection
    const toolBurst = this.detectToolBurst();
    if (toolBurst) {
      return {
        type: 'tool_burst',
        reason: `${toolBurst.count} tool outputs in ${toolBurst.windowMs}ms`,
        metadata: { count: toolBurst.count },
      };
    }

    // 2. Task completion signals
    const taskComplete = this.detectTaskCompletion();
    if (taskComplete) {
      return {
        type: 'task_complete',
        reason: taskComplete.signal,
        metadata: { signal: taskComplete.signal },
      };
    }

    // 3. Topic shift detection
    const topicShift = this.detectTopicShift();
    if (topicShift) {
      return {
        type: 'topic_shift',
        reason: topicShift.reason,
        metadata: { from: topicShift.from, to: topicShift.to },
      };
    }

    return null;
  }

  /**
   * Detect tool output burst
   */
  private detectToolBurst(): { count: number; windowMs: number } | null {
    const now = Date.now();
    const windowStart = now - this.config.toolBurstWindowMs;

    const recentToolOutputs = this.buffer.filter(
      e => e.eventType === 'tool_output' && e.timestamp.getTime() >= windowStart
    );

    if (recentToolOutputs.length >= this.config.toolBurstCount) {
      return {
        count: recentToolOutputs.length,
        windowMs: this.config.toolBurstWindowMs,
      };
    }

    return null;
  }

  /**
   * Detect task completion signals
   */
  private detectTaskCompletion(): { signal: string } | null {
    // Look for explicit completion signals in recent events
    const recentEvents = this.buffer.slice(-5); // Last 5 events
    
    const completionPatterns = [
      /(?:tests?\s+(?:are\s+)?(?:passing|passed|pass))/i,
      /(?:done|finished|complete|ready)/i,
      /(?:successfully\s+(?:built|compiled|deployed))/i,
      /(?:all\s+(?:tests?|checks?)\s+passed)/i,
    ];

    for (const event of recentEvents) {
      if (!event.content) continue;

      for (const pattern of completionPatterns) {
        if (pattern.test(event.content)) {
          return { signal: pattern.source };
        }
      }

      // Test success in tool output
      if (event.eventType === 'tool_output' && event.exitCode === 0) {
        if (/test|spec/i.test(event.toolName || '')) {
          return { signal: 'test_passed' };
        }
      }
    }

    return null;
  }

  /**
   * Detect topic shift (change in file/module being worked on)
   */
  private detectTopicShift(): { reason: string; from?: string; to?: string } | null {
    if (this.buffer.length < 10) return null;

    // Extract file paths from recent events
    const getFilePaths = (events: Event[]): Set<string> => {
      const paths = new Set<string>();
      for (const e of events) {
        if (e.filePath) paths.add(e.filePath);
      }
      return paths;
    };

    const oldEvents = this.buffer.slice(0, this.buffer.length - 5);
    const recentEvents = this.buffer.slice(-5);

    const oldPaths = getFilePaths(oldEvents);
    const recentPaths = getFilePaths(recentEvents);

    // Check for significant shift
    const overlap = new Set([...oldPaths].filter(p => recentPaths.has(p)));
    
    if (oldPaths.size > 0 && recentPaths.size > 0 && overlap.size === 0) {
      const from = Array.from(oldPaths)[0];
      const to = Array.from(recentPaths)[0];
      return {
        reason: 'Working file changed',
        from,
        to,
      };
    }

    return null;
  }

  /**
   * Run tiered curator on episode
   */
  private async curate(episode: Episode): Promise<MemoryCandidate[]> {
    switch (this.config.curatorMode) {
      case 'tier0':
        // Deterministic only
        return this.deterministicCurator.extractCandidates(episode);

      case 'tier1':
        // Small LLM (intelligent extractor)
        return this.curateWithIntelligent(episode);

      case 'tier2':
        // Big LLM (future: add escalation logic)
        return this.curateWithIntelligent(episode);

      default:
        return this.deterministicCurator.extractCandidates(episode);
    }
  }

  /**
   * Curate with intelligent extractor (Tier 1/2)
   */
  private async curateWithIntelligent(episode: Episode): Promise<MemoryCandidate[]> {
    // First get deterministic candidates (always useful)
    const tier0Candidates = this.deterministicCurator.extractCandidates(episode);

    // Then add intelligent extraction
    const tier1Candidates: MemoryCandidate[] = [];
    
    try {
      // Process each event through intelligent extractor
      for (const event of episode.events) {
        if (event.content) {
          const extracted = await this.intelligentExtractor.processEvent(event, event.content);
          tier1Candidates.push(...extracted);
        }
      }

      // Flush any buffered extractions
      const flushed = await this.intelligentExtractor.flushBuffer();
      tier1Candidates.push(...flushed);
    } catch (error) {
      console.error('Intelligent extraction failed, falling back to tier0:', error);
      return tier0Candidates;
    }

    // Merge and deduplicate
    return this.mergeCandidates(tier0Candidates, tier1Candidates);
  }

  /**
   * Merge candidates from different tiers, preferring higher-confidence ones
   */
  private mergeCandidates(...candidateSets: MemoryCandidate[][]): MemoryCandidate[] {
    const merged = new Map<string, MemoryCandidate>();

    for (const candidates of candidateSets) {
      for (const candidate of candidates) {
        const key = this.getCandidateKey(candidate);
        const existing = merged.get(key);

        if (!existing || this.compareConfidence(candidate.confidence, existing.confidence) > 0) {
          merged.set(key, candidate);
        }
      }
    }

    return Array.from(merged.values());
  }

  /**
   * Get deduplication key for candidate
   */
  private getCandidateKey(candidate: MemoryCandidate): string {
    return candidate.content.toLowerCase().slice(0, 100).replace(/\s+/g, ' ').trim();
  }

  /**
   * Compare confidence levels
   */
  private compareConfidence(a: string, b: string): number {
    const order = ['certain', 'high', 'medium', 'low'];
    return order.indexOf(b) - order.indexOf(a);
  }

  /**
   * Apply extractions to memory store
   */
  private async applyExtractions(
    candidates: MemoryCandidate[],
    episode: Episode
  ): Promise<{ created: number; updated: number }> {
    let created = 0;
    let updated = 0;

    for (const candidate of candidates) {
      // Check for similar existing memory
      const similar = await this.findSimilarMemory(candidate);

      if (similar) {
        // Update existing memory (merge evidence)
        const updatedEventIds = Array.from(new Set([
          ...similar.evidenceEventIds,
          ...candidate.evidenceEventIds,
        ]));

        this.memoryStore.update(similar.id, {
          evidenceEventIds: updatedEventIds,
        });

        updated++;
      } else {
        // Create new memory
        this.memoryStore.create({
          content: candidate.content,
          objectType: candidate.suggestedType,
          confidence: candidate.confidence,
          evidenceEventIds: candidate.evidenceEventIds,
          evidenceExcerpt: candidate.evidenceExcerpt,
          reviewStatus: candidate.confidence === 'high' ? 'approved' : 'pending',
          codeRefs: candidate.codeRefs,
        });

        created++;
      }
    }

    return { created, updated };
  }

  /**
   * Find similar existing memory (simple content similarity)
   */
  private async findSimilarMemory(candidate: MemoryCandidate) {
    // Simple approach: look for exact type + similar content
    const allMemories = this.memoryStore.list({ status: ['active'] });
    
    const candidateKey = this.getCandidateKey(candidate);
    
    for (const memory of allMemories) {
      if (memory.objectType !== candidate.suggestedType) continue;
      
      const memoryKey = memory.content.toLowerCase().slice(0, 100).replace(/\s+/g, ' ').trim();
      
      // Simple similarity: same prefix
      if (candidateKey === memoryKey) {
        return memory;
      }
    }

    return null;
  }

  /**
   * Get buffer statistics
   */
  getBufferStats() {
    const toolOutputs = this.buffer.filter(e => e.eventType === 'tool_output').length;
    const errors = this.buffer.filter(e => e.eventType === 'error').length;
    const age = Date.now() - this.lastCheckpointTime.getTime();

    return {
      events: this.buffer.length,
      toolOutputs,
      errors,
      age,
      lastCheckpoint: this.lastCheckpointTime,
    };
  }

  /**
   * Clear buffer without checkpointing (for testing)
   */
  clearBuffer() {
    this.buffer = [];
  }
}
