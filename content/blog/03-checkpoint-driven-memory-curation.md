# Checkpoint-Driven Memory Curation

> "Most AI memory systems are fire hoses. We built a curator."

The naive approach to AI agent memory is simple: stream everything. Every user prompt, every tool call, every agent response—pipe it all into a vector database and retrieve what seems relevant later.

This creates a specific kind of failure: death by noise.

When you store everything, retrieval drowns in irrelevant results. The agent asked about authentication three sessions ago during exploratory debugging. Now every auth-related query surfaces that ancient, contextless snippet. Signal gets buried in accumulated noise.

We took a different approach: checkpoint-driven curation.

## The Problem With Streaming

Consider a typical coding session. The agent:

1. Reads a file to understand context
2. Tries an approach that doesn't work
3. Reads another file
4. Tries a different approach
5. Gets an error
6. Reads stack trace
7. Fixes the error
8. Refactors for clarity
9. Runs tests
10. Commits

Of these ten interactions, maybe two contain memorable information: the error that was fixed (known_fix) and the final approach chosen (decision). The other eight are exploratory scaffolding.

Streaming everything means:
- 80% of your memories are noise
- Vector similarity matches on irrelevant exploration
- Context windows fill with low-value content
- Retrieval quality degrades as memory grows

Streaming also loses something critical: *context*. When you extract a memory at step 5 (the error), you don't yet know that step 7 contains the fix. The problem and solution are fragmented across separate memory entries.

## What Is a Checkpoint?

A checkpoint is a natural pause point in the agent's workflow where we step back and ask: "What was learned in this episode?"

Checkpoints happen:
- **Every N events** (default: 10) — Automatic, regular cadence
- **On session end** — Final sweep before context evaporates
- **On significant events** — Error followed by success, user correction
- **Manually** — User triggers with `alex checkpoint`

When a checkpoint fires, we:
1. Gather all buffered events since the last checkpoint
2. Build an "episode" — a coherent narrative of what happened
3. Run tiered extraction on the episode
4. Create memory candidates with full context
5. Clear the buffer

The key insight: **extraction happens when context is complete**. After step 7 (the fix), we can see the full arc: error → investigation → solution. This is when a `known_fix` memory is most accurate.

## The Episode Model

An episode is a structured view of buffered events:

```typescript
interface Episode {
  id: string;
  sessionId: string;
  startTime: Date;
  endTime: Date;
  events: Event[];

  // Derived context
  filesAccessed: string[];
  toolsUsed: string[];
  errorsEncountered: Error[];
  userCorrections: Correction[];
}
```

When we build an episode, we're not just collecting events—we're structuring them for extraction:

```typescript
function buildEpisode(events: Event[]): Episode {
  return {
    events,
    filesAccessed: extractFilePaths(events),
    toolsUsed: extractToolNames(events),
    errorsEncountered: findErrors(events),
    userCorrections: findCorrections(events),
    // ... derived context
  };
}
```

This preprocessing makes extraction more efficient. The extractor doesn't need to parse raw events—it gets structured data about what happened.

## Tiered Extraction

Not all memories require the same extraction method. We use a tiered approach that balances cost, latency, and quality:

### Tier 0: Deterministic Patterns

Zero API calls. Pure pattern matching on structured event data.

**Error → Fix Detection:**
```typescript
function detectErrorFixes(episode: Episode): MemoryCandidate[] {
  const candidates = [];

  for (const error of episode.errorsEncountered) {
    // Look for successful resolution within 5 minutes
    const resolution = findResolution(error, episode.events, {
      windowMs: 5 * 60 * 1000,
      requireSuccess: true
    });

    if (resolution) {
      candidates.push({
        type: 'known_fix',
        content: `When ${error.message}, ${resolution.action}`,
        evidence: [error.eventId, resolution.eventId],
        confidence: 'observed'
      });
    }
  }

  return candidates;
}
```

**User Corrections:**
```typescript
function detectUserCorrections(episode: Episode): MemoryCandidate[] {
  const correctionKeywords = [
    { pattern: /\bdon't\b/i, type: 'constraint', severity: 'should' },
    { pattern: /\bnever\b/i, type: 'constraint', severity: 'must' },
    { pattern: /\balways use\b/i, type: 'convention' },
    { pattern: /\bprefer\b/i, type: 'preference' },
  ];

  return episode.userCorrections.map(correction => ({
    type: matchType(correction.text, correctionKeywords),
    content: correction.text,
    evidence: [correction.eventId],
    confidence: 'grounded' // User said it directly
  }));
}
```

**Repeated Patterns:**
```typescript
function detectRepeatedPatterns(episode: Episode): MemoryCandidate[] {
  const patterns = countPatterns(episode.events);

  return patterns
    .filter(p => p.count >= 3) // Threshold: 3+ occurrences
    .map(pattern => ({
      type: 'convention',
      content: `Pattern: ${pattern.description}`,
      evidence: pattern.eventIds,
      confidence: 'observed'
    }));
}
```

Tier 0 is fast, free, and surprisingly effective. It catches the obvious patterns without any LLM involvement.

### Tier 1: Intelligent Extraction

When Tier 0 doesn't capture everything, we escalate to Haiku (Claude's fastest model) for deeper analysis.

**The key innovation: we use Claude Code's existing OAuth token.** No separate API key required. When running inside Claude Code, Alexandria automatically retrieves the OAuth token and uses it for Haiku calls.

```typescript
async function createLLMProvider(): Promise<LLMProvider | null> {
  // Check if we have an API key configured
  if (process.env.ANTHROPIC_API_KEY) {
    return new AnthropicProvider(process.env.ANTHROPIC_API_KEY);
  }

  // Try to get Claude Code's OAuth token
  try {
    const token = await getClaudeOAuthToken();
    if (token) {
      return new OAuthProvider(token);
    }
  } catch {
    // OAuth not available
  }

  return null; // Tier 1 disabled
}
```

If an LLM provider is available, Tier 1 extracts:

```typescript
const extractionPrompt = `
Analyze this coding session episode and extract memorable knowledge.

For each memory, provide:
- Type: decision | convention | preference | known_fix
- Content: Actionable statement
- Rationale: Why this matters
- Confidence: How certain (based on evidence)

Episode:
${formatEpisode(episode)}

Extract only:
- Decisions with clear rationale
- Conventions observed 3+ times
- Fixes that solved real problems
- Strong preferences expressed

Skip:
- Exploratory steps that led nowhere
- Generic/obvious statements
- Transient, session-specific things
`;
```

Tier 1 memories are created as "pending" for human review. The extraction is intelligent but not infallible.

### Tier 2: Deep Analysis (Planned)

For complex architectural decisions or cross-session patterns, we plan to escalate to Sonnet for deeper reasoning. This tier would handle:

- Conflict detection between memories
- Cross-session pattern recognition
- Architectural decision extraction

Currently, Tier 2 runs only on explicit request, not automatically.

## The Checkpoint Flow

Here's the complete checkpoint execution:

```typescript
async function executeCheckpoint(
  sessionId: string,
  trigger: 'auto' | 'manual' | 'session_end'
): Promise<CheckpointResult> {
  const config = getConfig();
  const buffer = await getEventBuffer(sessionId);

  // Validate: need minimum events for auto-checkpoint
  if (trigger === 'auto' && buffer.length < config.minEventsForCheckpoint) {
    return { skipped: true, reason: 'insufficient_events' };
  }

  // Build episode from buffer
  const episode = buildEpisode(buffer);

  // Run Tier 0 (always)
  const tier0Results = runDeterministicExtraction(episode);

  // Run Tier 1 (if LLM available)
  let tier1Results: MemoryCandidate[] = [];
  const llm = await createLLMProvider();
  if (llm) {
    tier1Results = await runIntelligentExtraction(episode, llm);
  }

  // Combine and deduplicate
  const candidates = deduplicateCandidates([...tier0Results, ...tier1Results]);

  // Create memory objects
  const created = await createMemories(candidates, {
    reviewStatus: 'pending',
    evidenceEventIds: episode.events.map(e => e.id)
  });

  // Clear buffer and update checkpoint time
  await clearBuffer(sessionId);
  await updateLastCheckpoint(sessionId);

  return {
    skipped: false,
    tier0: tier0Results.length,
    tier1: tier1Results.length,
    created: created.length,
    pending: created.filter(m => m.reviewStatus === 'pending').length
  };
}
```

## Why Checkpoints Work

### 1. Context Is Complete

At checkpoint time, we see the full story. The error and its fix. The exploration and the decision. The confusion and the clarification.

Compare to streaming:
- **Streaming:** "Error: cannot find module 'sharp'"
- **Checkpoint:** "When sharp fails to compile on Alpine, install vips-dev first (fix discovered after npm install failed)"

The checkpoint memory is actionable. The streamed one is just noise.

### 2. Batch Processing Is Efficient

Per-event processing means:
- N LLM calls for N events
- Embedding generation on every message
- Constant database writes

Checkpoint processing means:
- 1 LLM call per episode (10 events)
- Batch embedding generation
- Fewer, larger writes

At 10 events per checkpoint, we reduce LLM costs by 10x compared to per-event extraction.

### 3. Quality Over Quantity

Streaming accumulates memories. Checkpoints curate them.

After a week of development:
- **Streaming:** 10,000 memory fragments
- **Checkpoint:** 150 curated memories

Which system retrieves better? The one where every memory was worth keeping.

### 4. Human Review Is Feasible

Reviewing 10,000 memories is impossible. Reviewing 150 is manageable. Checkpoints create reviewable quantities.

## Configuration

Alexandria's checkpoint behavior is configurable:

```bash
# Auto-checkpoint threshold (events before checkpoint)
export ALEXANDRIA_AUTO_CHECKPOINT_THRESHOLD=10

# Minimum events for auto-checkpoint to fire
export ALEXANDRIA_MIN_EVENTS_FOR_CHECKPOINT=5

# Curator mode: tier0, tier1, or auto
export ALEXANDRIA_CURATOR_MODE=auto
```

The `auto` mode uses Tier 1 when an LLM provider is available, falling back to Tier 0 otherwise.

## Manual Checkpoints

Sometimes you want to capture something immediately:

```bash
# Trigger manual checkpoint
alex checkpoint

# Checkpoint with specific trigger type
alex checkpoint --trigger significant_event

# Checkpoint with note
alex checkpoint --note "Major refactor complete"
```

Manual checkpoints are useful after:
- Completing a complex task
- Making a significant decision
- Before switching contexts
- When you want to ensure capture

## Monitoring Checkpoints

Track what's being captured:

```bash
$ alex session current
Session: abc123
Started: 2 hours ago
Events: 47
Checkpoints: 4
Memories created: 12
Pending review: 8

Last checkpoint: 15 minutes ago
Events since: 7
```

If events are accumulating without checkpoints, something might be misconfigured.

## The Curation Philosophy

Our approach reflects a philosophy: **less is more**.

Every memory competes for attention in the context window. Every low-quality memory degrades retrieval. Every redundant memory wastes tokens.

A curator's job isn't to keep everything—it's to keep what matters.

Checkpoint-driven curation enforces this discipline:
- Events buffer, waiting for context to complete
- Extraction looks for signal, not noise
- Only memorable content becomes memory
- Human review filters the remainder

The result is a memory store where everything present deserves to be there.

---

Checkpoints are the heartbeat of Alexandria. Every 10 events, we pause, extract, and curate. The result is a growing corpus of actually-useful project knowledge.

The implementation lives in `src/ingestor/checkpoint.ts`. The deterministic curator is in `src/ingestor/deterministic-curator.ts`. The intelligent extractor is in `src/ingestor/intelligent-extractor.ts`.

*The best time to capture a decision is right after it's made, when the context that led to it is still fresh.*
