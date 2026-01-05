/**
 * Checkpoint System - Replace continuous extraction with episodic curation
 *
 * Implements the Checkpoint-Reset-Rehydrate loop:
 * 1. Detect checkpoint triggers (window pressure, task completion, etc.)
 * 2. Flush event buffer to store
 * 3. Run tiered curator on episode
 * 4. Update memory objects
 * 5. Generate fresh context pack (rehydration ready)
 *
 * Tiered Curation:
 * - Tier 0: Deterministic patterns (always runs, no API needed)
 * - Tier 1: Haiku extraction (if Claude OAuth available)
 * - Tier 2: Full LLM with conflict detection (future)
 */

import type { Database } from 'bun:sqlite';
import { FTSIndex } from '../indexes/fts.ts';
import { EventStore } from '../stores/events.ts';
import { MemoryObjectStore } from '../stores/memory-objects.ts';
import { SessionStore } from '../stores/sessions.ts';
import type { Event } from '../types/events.ts';
import type { MemoryCandidate } from '../types/memory-objects.ts';
import { getAnthropicApiKey } from '../utils/claude-auth.ts';
import { type Conflict, ConflictDetector } from './conflict-detector.ts';
import { DeterministicCurator, type Episode } from './deterministic-curator.ts';
import { ClaudeProvider, IntelligentExtractor, type LLMProvider } from './intelligent-extractor.ts';

/**
 * Create LLM provider from available credentials
 * Priority: 1. Provided config, 2. ANTHROPIC_API_KEY, 3. Claude OAuth token
 */
async function createLLMProvider(configProvider?: LLMProvider): Promise<LLMProvider | undefined> {
  // Use provided provider if available
  if (configProvider) {
    return configProvider;
  }

  // Try to get API key (checks env var then Claude OAuth)
  const apiKey = await getAnthropicApiKey();
  if (apiKey) {
    return new ClaudeProvider(apiKey, 'claude-3-5-haiku-20241022');
  }

  return undefined;
}

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
  conflictsDetected: number;
  conflictsPending: number;
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
  curatorMode: 'tier0', // Start conservative, upgraded to tier1 if LLM available
};

const SIMILARITY_THRESHOLD = 0.8;

export class Checkpoint {
  private db: Database;
  private eventStore: EventStore;
  private memoryStore: MemoryObjectStore;
  private fts: FTSIndex;
  private sessionStore: SessionStore;
  private deterministicCurator: DeterministicCurator;
  private intelligentExtractor: IntelligentExtractor;
  private config: CheckpointConfig;
  private llmAvailable: boolean = false;

  // Event buffer (pending checkpoint)
  private buffer: Event[] = [];
  private lastCheckpointTime: Date = new Date();

  /**
   * Create a checkpoint instance with auto-detected LLM provider
   * Use this instead of constructor for automatic tier1 detection
   */
  static async create(db: Database, config: Partial<CheckpointConfig> = {}): Promise<Checkpoint> {
    // Auto-detect LLM provider if not specified
    const llmProvider = await createLLMProvider(config.llmProvider);

    // Upgrade to tier1 if LLM is available and mode is not explicitly set
    const finalConfig = { ...config };
    if (llmProvider && !config.curatorMode) {
      finalConfig.curatorMode = 'tier1';
      finalConfig.llmProvider = llmProvider;
    }

    const checkpoint = new Checkpoint(db, finalConfig);
    checkpoint.llmAvailable = !!llmProvider;
    return checkpoint;
  }

  constructor(db: Database, config: Partial<CheckpointConfig> = {}) {
    this.db = db;
    this.eventStore = new EventStore(db);
    this.memoryStore = new MemoryObjectStore(db);
    this.fts = new FTSIndex(db);
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
   * Load events from a session into the buffer
   * Used when checkpoint is called from CLI (events already in database)
   * If sinceCheckpoint is provided, only loads events after that timestamp
   */
  loadSessionEvents(sessionId: string, sinceCheckpoint?: Date): number {
    const events = sinceCheckpoint
      ? this.eventStore.getBySessionSince(sessionId, sinceCheckpoint)
      : this.eventStore.getBySession(sessionId);
    this.buffer = events;
    return events.length;
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
        conflictsDetected: 0,
        conflictsPending: 0,
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
        conflictsDetected: 0,
        conflictsPending: 0,
        rehydrationReady: false,
      };
    }

    // 2. Build episode from buffer
    const episode = this.deterministicCurator.buildEpisode(this.buffer);

    // 3. Run tiered curator
    const candidates = await this.curate(episode);

    // 4. Apply extractions (create/update memory objects, detect conflicts in tier2)
    const { created, updated, conflictsDetected, conflictsPending } = await this.applyExtractions(
      candidates,
      episode,
    );

    // 5. Clear buffer and update checkpoint time
    const episodeEventCount = this.buffer.length;
    this.buffer = [];
    this.lastCheckpointTime = new Date();

    const duration = Date.now() - startTime;
    console.debug(
      `Checkpoint completed in ${duration}ms: ${created} created, ${updated} updated, ${conflictsDetected} conflicts`,
    );

    // Notify user about pending conflicts
    if (conflictsPending > 0) {
      console.log(
        `\n⚠️  ${conflictsPending} conflict(s) need human review. Run: alex conflicts --interactive\n`,
      );
    }

    return {
      trigger,
      episodeEventCount,
      candidatesExtracted: candidates.length,
      memoriesCreated: created,
      memoriesUpdated: updated,
      conflictsDetected,
      conflictsPending,
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
      (e) => e.eventType === 'tool_output' && e.timestamp.getTime() >= windowStart,
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
    const overlap = new Set([...oldPaths].filter((p) => recentPaths.has(p)));

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
    let candidates: MemoryCandidate[];

    switch (this.config.curatorMode) {
      case 'tier0':
        // Deterministic only
        candidates = this.deterministicCurator.extractCandidates(episode);
        break;

      case 'tier1':
        // Small LLM (intelligent extractor)
        candidates = await this.curateWithIntelligent(episode);
        break;

      case 'tier2':
        // Big LLM (future: add escalation logic)
        candidates = await this.curateWithIntelligent(episode);
        break;

      default:
        candidates = this.deterministicCurator.extractCandidates(episode);
    }

    // Extract and attach code refs to all candidates
    const codeRefs = this.deterministicCurator.extractCodeRefs(episode);
    if (codeRefs.length > 0) {
      for (const candidate of candidates) {
        // Merge with any existing code refs
        candidate.codeRefs = [...(candidate.codeRefs || []), ...codeRefs];
      }
    }

    return candidates;
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
          // Convert ExtractedMemory to MemoryCandidate
          for (const em of extracted) {
            tier1Candidates.push({
              content: em.content,
              suggestedType: em.type,
              evidenceEventIds: em.evidenceEventIds,
              evidenceExcerpt: em.reasoning,
              confidence: em.confidence,
            });
          }
        }
      }

      // Flush any buffered extractions
      const flushed = await this.intelligentExtractor.flushBuffer();
      for (const em of flushed) {
        tier1Candidates.push({
          content: em.content,
          suggestedType: em.type,
          evidenceEventIds: em.evidenceEventIds,
          evidenceExcerpt: em.reasoning,
          confidence: em.confidence,
        });
      }
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
    return this.getContentKey(candidate.content);
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
   * In tier2 mode, detects conflicts and queues them for human review
   */
  private async applyExtractions(
    candidates: MemoryCandidate[],
    episode: Episode,
  ): Promise<{
    created: number;
    updated: number;
    conflictsDetected: number;
    conflictsPending: number;
  }> {
    let created = 0;
    let updated = 0;
    let conflictsDetected = 0;
    let conflictsPending = 0;

    // Use conflict detection in tier2 mode
    const useConflictDetection = this.config.curatorMode === 'tier2';
    const conflictDetector = useConflictDetection ? new ConflictDetector(this.db) : null;

    for (const candidate of candidates) {
      // In tier2, check for conflicts first
      if (conflictDetector) {
        const conflicts = conflictDetector.detectConflicts(candidate);

        if (conflicts.length > 0) {
          conflictsDetected += conflicts.length;

          // High-severity conflicts need human review
          const highSeverity = conflicts.filter((c) => c.severity === 'high');
          if (highSeverity.length > 0) {
            conflictsPending += highSeverity.length;
            // Don't auto-create memory - wait for human review
            continue;
          }

          // Auto-resolve low/medium severity
          for (const conflict of conflicts) {
            conflictDetector.resolveConflict(conflict.id, {
              option: conflict.suggestedResolution,
              resolvedBy: 'auto',
              reason: 'Auto-resolved (low/medium severity)',
            });
          }
        }
      }

      // Check for similar existing memory
      const similar = await this.findSimilarMemory(candidate);

      if (similar) {
        // Update existing memory (merge evidence)
        const updatedEventIds = Array.from(
          new Set([...similar.evidenceEventIds, ...candidate.evidenceEventIds]),
        );

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
          reviewStatus: this.shouldAutoApprove(candidate) ? 'approved' : 'pending',
          codeRefs: candidate.codeRefs,
        });

        created++;
      }
    }

    return { created, updated, conflictsDetected, conflictsPending };
  }

  /**
   * Find similar existing memory (simple content similarity)
   */
  private async findSimilarMemory(candidate: MemoryCandidate) {
    const candidateKey = this.getCandidateKey(candidate);
    const candidates = this.findCandidateMemories(candidate);

    for (const memory of candidates) {
      if (memory.objectType !== candidate.suggestedType) continue;

      const memoryKey = this.getContentKey(memory.content);

      // Simple similarity: same prefix
      if (candidateKey === memoryKey) {
        return memory;
      }

      const similarity = this.calculateSimilarity(candidate.content, memory.content);
      if (similarity >= SIMILARITY_THRESHOLD) {
        return memory;
      }
    }

    return null;
  }

  /**
   * Determine whether a memory can be auto-approved
   */
  private shouldAutoApprove(candidate: MemoryCandidate): boolean {
    const hasEvidence = candidate.evidenceEventIds.length > 0;
    const hasCodeRefs = !!(candidate.codeRefs && candidate.codeRefs.length > 0);
    const isHighConfidence = candidate.confidence === 'high' || candidate.confidence === 'certain';
    return isHighConfidence && (hasEvidence || hasCodeRefs);
  }

  /**
   * Find likely candidate memories for deduplication
   */
  private findCandidateMemories(candidate: MemoryCandidate) {
    const ftsResults = this.fts.searchObjects(candidate.content, ['active'], 10);
    if (ftsResults.length > 0) {
      return ftsResults.map((r) => r.object);
    }

    return this.memoryStore.list({ status: ['active'], limit: 200 });
  }

  /**
   * Normalize content for quick comparison
   */
  private getContentKey(content: string): string {
    return content.toLowerCase().slice(0, 100).replace(/\s+/g, ' ').trim();
  }

  /**
   * Calculate content similarity (simple Jaccard-like)
   */
  private calculateSimilarity(a: string, b: string): number {
    const tokensA = new Set(this.tokenize(a));
    const tokensB = new Set(this.tokenize(b));

    if (tokensA.size === 0 || tokensB.size === 0) return 0;

    const intersection = new Set([...tokensA].filter((x) => tokensB.has(x)));
    const union = new Set([...tokensA, ...tokensB]);

    return intersection.size / union.size;
  }

  /**
   * Tokenize text for comparison
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2);
  }

  /**
   * Get buffer statistics
   */
  getBufferStats() {
    const toolOutputs = this.buffer.filter((e) => e.eventType === 'tool_output').length;
    const errors = this.buffer.filter((e) => e.eventType === 'error').length;
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
