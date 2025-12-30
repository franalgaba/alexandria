# Alexandria v2.0: Anti-Noise Architecture Specification

## Executive Summary

This document specifies the transition from Alexandria's current "real-time regex extraction" system to an **evidence-backed, checkpoint-driven, token-minimized** memory architecture based on first principles.

**Core Principle**: The context window is a cache. Everything else lives in queryable, durable stores with truth management.

---

## Current State Assessment

### ✅ What We Have (Strong Foundation)

#### 1. Storage Layer
- ✅ **Event Store** (`src/stores/events.ts`)
  - Append-only log with session tracking
  - Supports: turns, tool_output, diff, test_summary, error
  - Has `content_hash` for deduplication
  
- ✅ **Blob Store** (`src/stores/blobs.ts`)
  - Content-addressed storage for large payloads
  - Deduplication via hashing
  - Orphan cleanup mechanism

- ✅ **Memory Objects Store** (`src/stores/memory-objects.ts`)
  - Typed memory objects (decision, constraint, known_fix, etc.)
  - Status lifecycle: active/stale/superseded/retired
  - Scope hierarchy: global/project/module/file
  - Provenance via `evidenceEventIds`
  - Code references (`codeRefs`) - **schema exists but underutilized**

#### 2. Retrieval Layer
- ✅ **Hybrid Search** (`src/retriever/hybrid-search.ts`)
  - FTS5 (lexical) + Vector (semantic)
  - RRF fusion for result merging
  - Status filtering (active-only by default)

- ✅ **Reranker** (`src/retriever/reranker.ts`)
  - Task-type detection
  - Deterministic scoring rules

- ✅ **Context Pack Compiler** (`src/retriever/context-pack.ts`)
  - Token budget enforcement (default 1500)
  - Greedy packing algorithm
  - Constraints always included

#### 3. Curation Layer
- ✅ **Intelligent Extractor** (`src/ingestor/intelligent-extractor.ts`)
  - **EXISTS BUT INACTIVE BY DEFAULT**
  - Has buffer mechanism for context accumulation
  - Supports LLM providers (Ollama, Claude, OpenAI)
  - Trigger detection for learning moments

- ✅ **Staleness Checker** (`src/reviewer/staleness.ts`)
  - Manual staleness detection
  - **Does NOT auto-invalidate on code changes**

#### 4. Supporting Infrastructure
- ✅ Session tracking
- ✅ Supersession chains
- ✅ Review workflow (pending/approved/rejected)
- ✅ Confidence tiers (grounded/observed/inferred/hypothesis)

---

### ❌ What We Don't Have (Critical Gaps)

#### 1. **Event Normalization Pipeline**
- ❌ No tool output synopsis generation
- ❌ No deduplication of identical tool outputs
- ❌ No "tool episode" collapsing (call + result = one unit)
- ❌ No structured signal parsing (exit codes, file changes, error signatures)

#### 2. **Checkpoint-Reset-Rehydrate Loop**
- ❌ No checkpoint triggers (window threshold, task boundary, topic shift)
- ❌ No fresh context rehydration after checkpoint
- ❌ Still using continuous extraction instead of episodic curation

#### 3. **Active Code Truth Layer**
- ❌ No symbol index (LSP/tree-sitter)
- ❌ No automatic invalidation when linked code changes
- ❌ Code refs exist but are rarely populated
- ❌ No git commit tracking for freshness

#### 4. **Intent-Aware Retrieval Router**
- ❌ No query intent classification (debug vs. convention vs. navigation)
- ❌ No per-intent retrieval plans
- ❌ Reranker detects task type but doesn't route to different sources

#### 5. **Progressive Disclosure**
- ❌ Always generates full pack up to budget
- ❌ No "minimal → expand on uncertainty" mechanism
- ❌ No evidence snippet fetching on demand

#### 6. **Tiered Curation**
- ❌ Intelligent extractor exists but isn't the default
- ❌ No deterministic heuristics tier
- ❌ No escalation to big LLM only when needed
- ❌ **No decision stability rules** (stream of consciousness captured as decisions)

#### 7. **Micro-Review UX**
- ❌ No inline revalidation prompts
- ❌ No auto-downgrade on non-response
- ❌ Batch review exists but is manual (`alex review`)

---

## The Noise Problem Root Cause

**Current Flow (Broken)**:
```
Event → RealtimeExtractor (regex) → Memory Object (immediate write)
```

**Problems**:
1. **No Context Window**: Extractor sees one message at a time, misses episode-level patterns
2. **No Stability Check**: "I will try X" is stored as a decision, then "Actually use Y" creates a second decision
3. **Literal Matching**: `console.error(...)` triggers failure pattern 6 times
4. **No Dedup Before Write**: Each tool output creates separate memory candidates

**What Happens**:
- 117 total memories, ~70% are noise
- Examples of noise:
  - "Now let me check..." (meta-commentary)
  - `console.error("Uncaught exception:", err);` × 6
  - "But let me simplify by using `push`..." (ephemeral thought)

---

## Target Architecture (North Star)

### Layer 1: Lossless Event Store (Enhanced)

**Status**: ✅ Exists, needs enhancement

**Enhancements Needed**:
1. **Event Normalization** (pre-write):
   ```typescript
   interface NormalizedEvent extends Event {
     synopsis?: string;        // 1-3 line summary (for tool outputs)
     structuredSignals?: {     // Parsed metadata
       exitCode?: number;
       filesChanged?: string[];
       errorSignature?: string;
       testsPassed?: number;
       testsFailed?: number;
     };
     dedupeHash?: string;      // For collapsing identical tool outputs
     episodeId?: string;       // Group related events (call + result)
   }
   ```

2. **Blob Migration Policy**:
   - Tool outputs >500 chars → blob storage
   - Store synopsis inline, full content in blob
   - Event table gets `synopsis` column

**Implementation**:
- New module: `src/ingestor/normalizer.ts`
- Enhance schema: add `synopsis`, `structured_signals`, `episode_id` columns

---

### Layer 2: Memory Objects (Refined)

**Status**: ✅ Schema exists, needs behavioral changes

**Schema Changes**:
```sql
ALTER TABLE memory_objects ADD COLUMN confidence_tier TEXT 
  CHECK (confidence_tier IN ('grounded', 'observed', 'inferred', 'hypothesis'));

-- Rename confidence → legacy_confidence for backward compat
ALTER TABLE memory_objects RENAME COLUMN confidence TO legacy_confidence;

-- Add freshness tracking
ALTER TABLE memory_objects ADD COLUMN invalidation_trigger TEXT;
  -- e.g., "file:src/api.ts" or "symbol:fetchUser"
```

**Behavioral Rules** (enforced in code):
1. **Provenance Required**:
   - Cannot create `grounded` tier without `codeRefs` + recent verification
   - Cannot create `observed` tier without `evidenceEventIds`
   - `inferred` tier = extracted but unconfirmed
   - `hypothesis` tier = suggested, never use in retrieval unless explicit

2. **Decision Stability** (anti-noise):
   - Decision only written if:
     - Mentioned ≥2 times in episode OR
     - Followed by implementation (patch applied) OR
     - User explicitly confirms ("do this going forward")
   - Otherwise stays as ephemeral event

3. **Auto-Confidence Calculation**:
   ```typescript
   function calculateConfidenceTier(obj: MemoryObject): ConfidenceTier {
     if (obj.codeRefs.length > 0 && obj.lastVerifiedAt && isRecent(obj.lastVerifiedAt)) {
       return 'grounded';
     }
     if (obj.reviewStatus === 'approved' || obj.evidenceEventIds.length > 0) {
       return 'observed';
     }
     if (obj.reviewStatus === 'pending') {
       return 'inferred';
     }
     return 'hypothesis';
   }
   ```

---

### Layer 3: Checkpoint-Reset-Rehydrate Loop (NEW)

**Status**: ❌ Does not exist

**What It Replaces**: 
- Current: continuous real-time extraction
- New: episodic curation at checkpoints

**Triggers** (any of):
1. Context window usage >75%
2. Tool output burst (>10 in 2 minutes)
3. Task boundary signals:
   - Tests pass after failures
   - User says "done", "ready", "next"
   - Topic shift detected (different file/module)
4. Manual checkpoint: `alex checkpoint`

**Checkpoint Routine**:
```typescript
async function checkpoint(sessionId: string) {
  // 1. Flush buffer to event store
  await flushEventBuffer();
  
  // 2. Run tiered curator (see below)
  const extracted = await curateEpisode(sessionId);
  
  // 3. Update memory objects (merge/supersede/mark stale)
  await applyExtractions(extracted);
  
  // 4. End current LLM context (external to Alexandria)
  // Agent framework should start fresh conversation
  
  // 5. Generate fresh context pack (rehydrate)
  const pack = await compiler.compile({ sessionId });
  
  return { extracted, pack };
}
```

**Implementation**:
- New module: `src/ingestor/checkpoint.ts`
- Integrate with Claude Code hooks: detect task completion
- Add `alex checkpoint` CLI command

---

### Layer 4: Tiered Curator (NEW)

**Status**: ⚠️ Intelligent extractor exists but not default

**Architecture**:
```
Tier 0 (Deterministic) → Tier 1 (Small LLM) → Tier 2 (Big LLM - escalation only)
                ↓                 ↓                        ↓
           Candidates         Curated Objects        Conflict Resolution
```

**Tier 0: Deterministic Heuristics** (always runs, cost: $0)
```typescript
class DeterministicCurator {
  extractCandidates(episode: Event[]): MemoryCandidate[] {
    // 1. Error → Fix pattern
    const fixes = detectErrorResolution(episode);
    
    // 2. Explicit constraints (user correction)
    const constraints = detectUserCorrection(episode);
    
    // 3. Repeated patterns (≥3 occurrences)
    const conventions = detectRepeatedPatterns(episode);
    
    // NO decisions, NO preferences (too noisy for regex)
    return [...fixes, ...constraints, ...conventions];
  }
}
```

**Tier 1: Small LLM** (default, runs at checkpoints)
- Model: `llama3.2` (local) or `claude-3-haiku` (API)
- Input: Last 20-50 events from checkpoint buffer
- Prompt: Extract decisions/conventions/fixes with stability check
- Cost: ~$0.001 per checkpoint

**Tier 2: Big LLM** (escalation only)
- Model: `claude-3.5-sonnet` or `gpt-4`
- Triggers:
  - Conflicts detected among active memories
  - High-stakes episode (security, breaking change)
  - Small model confidence <0.5
- Cost: ~$0.01 per escalation

**Implementation**:
- Refactor `src/ingestor/intelligent-extractor.ts`:
  - Add Tier 0 deterministic mode
  - Make Tier 1 the default
  - Add conflict detection → Tier 2 escalation
- Add curator config:
  ```typescript
  interface CuratorConfig {
    tier0: boolean;          // default: true
    tier1: 'local' | 'api';  // default: 'local'
    tier2: 'escalate' | 'manual'; // default: 'escalate'
  }
  ```

---

### Layer 5: Code Truth Layer (NEW)

**Status**: ❌ Does not exist (biggest gap)

**Purpose**: Anchor memories to actual code, auto-invalidate on changes

**Components**:

#### 5.1 Git Integration
```typescript
// src/code/git.ts (already exists, enhance)
interface GitService {
  getCurrentCommit(): string;
  getChangedFilesSince(commit: string): string[];
  getFileAtCommit(path: string, commit: string): string | null;
  
  // NEW: Track file history
  getFileHistory(path: string, limit: number): Commit[];
  
  // NEW: Detect renames
  findRenames(oldCommit: string, newCommit: string): Map<string, string>;
}
```

#### 5.2 Symbol Extraction (Basic)
```typescript
// src/code/symbols.ts (already exists, enhance for production use)
interface SymbolExtractor {
  extractFromFile(path: string, language: string): Symbol[];
  findSymbolDefinition(symbol: string, path: string): Location | null;
  
  // For tree-sitter integration
  parseAST(content: string, language: string): ASTNode;
}
```

#### 5.3 Freshness Watcher
```typescript
// src/reviewer/freshness-watcher.ts (NEW)
class FreshnessWatcher {
  // Background process: check git every 10 seconds
  async watchForChanges() {
    const lastCommit = await getLastCheckedCommit();
    const currentCommit = await git.getCurrentCommit();
    
    if (lastCommit !== currentCommit) {
      const changed = await git.getChangedFilesSince(lastCommit);
      await invalidateAffectedMemories(changed);
    }
  }
  
  async invalidateAffectedMemories(changedFiles: string[]) {
    for (const file of changedFiles) {
      const affected = store.getByCodeRef({ path: file });
      
      for (const memory of affected) {
        if (memory.status === 'active' && memory.confidenceTier === 'grounded') {
          // Downgrade to 'observed', mark needs revalidation
          store.update(memory.id, {
            confidenceTier: 'observed',
            status: 'stale',
            invalidationTrigger: `file:${file} changed`,
          });
        }
      }
    }
  }
}
```

**Implementation Priority**:
1. ✅ Git integration (basic exists, enhance)
2. 🔄 Symbol extraction (exists but needs production hardening)
3. ⚠️ Freshness watcher (new background service)
4. 📅 LSP integration (future enhancement)

---

### Layer 6: Intent-Aware Retrieval Router (NEW)

**Status**: ❌ Does not exist

**Purpose**: Different queries need different retrieval strategies

**Intent Classification**:
```typescript
type QueryIntent = 
  | 'debug'           // "why is X failing?"
  | 'implement'       // "how do I add Y?"
  | 'navigate'        // "where is function Z?"
  | 'convention'      // "how do we name files?"
  | 'history'         // "what did we decide about X?"
  | 'validate';       // "is constraint X still true?"

function classifyIntent(query: string): QueryIntent {
  // Simple keyword-based classifier (can upgrade to ML later)
  if (/\b(error|fail|broken|bug|crash)\b/i.test(query)) return 'debug';
  if (/\b(where|find|locate)\b/i.test(query)) return 'navigate';
  if (/\b(how do we|convention|pattern|standard)\b/i.test(query)) return 'convention';
  if (/\b(why|decided|chose|instead of)\b/i.test(query)) return 'history';
  if (/\b(still true|valid|current)\b/i.test(query)) return 'validate';
  return 'implement';
}
```

**Per-Intent Retrieval Plans**:
```typescript
interface RetrievalPlan {
  sources: ('memory_objects' | 'events' | 'code_symbols' | 'code_lexical')[];
  typeFilters: ObjectType[];
  statusFilters: Status[];
  tokenBudget: number;
  boosts: {
    recentlyVerified?: number;
    hasCodeRefs?: number;
    scopeMatch?: number;
  };
}

const RETRIEVAL_PLANS: Record<QueryIntent, RetrievalPlan> = {
  debug: {
    sources: ['memory_objects', 'events'],
    typeFilters: ['known_fix', 'failed_attempt', 'constraint'],
    statusFilters: ['active'],
    tokenBudget: 1000,
    boosts: { recentlyVerified: 2.0 },
  },
  convention: {
    sources: ['memory_objects'],
    typeFilters: ['convention', 'constraint'],
    statusFilters: ['active'],
    tokenBudget: 500,
    boosts: { scopeMatch: 1.5 },
  },
  navigate: {
    sources: ['code_symbols', 'code_lexical'],
    typeFilters: [],
    statusFilters: [],
    tokenBudget: 300,
    boosts: {},
  },
  // ... etc
};
```

**Implementation**:
- New module: `src/retriever/router.ts`
- Enhance `ContextPackCompiler` to use router
- Add intent parameter to `alex pack --intent debug`

---

### Layer 7: Progressive Disclosure (NEW)

**Status**: ❌ Does not exist

**Current**: Always pack up to full budget (1500 tokens)

**Target**: Start minimal, expand on uncertainty

**Levels**:
```typescript
enum DisclosureLevel {
  MINIMAL = 'minimal',      // ~200 tokens: constraints + current goal
  TASK = 'task',            // ~500 tokens: + relevant memories
  DEEP = 'deep',            // ~1500 tokens: + evidence + history
}

interface ProgressivePack {
  level: DisclosureLevel;
  pack: ContextPack;
  canExpand: boolean;       // Are there more objects available?
  
  // If canExpand, what's next?
  nextLevel?: DisclosureLevel;
  nextObjectCount?: number;
}
```

**Usage Pattern**:
```typescript
// 1. Start minimal
const minimal = await compiler.compileProgressive({ level: 'minimal' });

// 2. Agent detects uncertainty (future: automatic)
// For now: if agent response contains "not sure", "might", "unclear"

// 3. Expand to task level
const task = await compiler.compileProgressive({ 
  level: 'task',
  query: 'specific question',
});

// 4. If still uncertain, go deep
const deep = await compiler.compileProgressive({ level: 'deep' });
```

**Implementation**:
- Enhance `src/retriever/context-pack.ts`:
  - Add `compileProgressive()`
  - Add uncertainty detection helpers
- Future: integrate with agent framework for automatic expansion

---

## Implementation Roadmap

### Phase 1: Stop the Bleeding (Week 1-2)
**Goal**: Eliminate noise from new ingestion

#### P1.1: Make Intelligent Extractor Default
- [ ] Set `useIntelligent: true` by default in `Ingestor`
- [ ] Add Tier 0 deterministic curator
- [ ] Implement decision stability rules
- [ ] **Deliverable**: New memories are curated, not raw-extracted

#### P1.2: Event Normalization
- [ ] Add `synopsis` column to events table
- [ ] Implement tool output synopsis generation
- [ ] Add deduplication by content hash
- [ ] **Deliverable**: Event store is cleaner, tool outputs are summarized

#### P1.3: Cleanup Existing Noise
- [ ] Script to identify noise patterns in existing memories
- [ ] Bulk retire obviously bad memories (console.error × 6, "Let me check...")
- [ ] **Deliverable**: Active memory count drops by ~50%, signal improves

**Success Metric**: New session creates <5 memories per 30 events (vs. current ~15)

---

### Phase 2: Checkpoint-Driven Curation (Week 2-3)
**Goal**: Replace continuous extraction with episodic curation

#### P2.1: Checkpoint Infrastructure
- [ ] Implement `Checkpoint` class with trigger detection
- [ ] Add `alex checkpoint` CLI command
- [ ] Integrate with Claude Code hooks (detect task completion)
- [ ] **Deliverable**: Can manually checkpoint and see episodic curation

#### P2.2: Buffer Management
- [ ] Enhance `IntelligentExtractor` to maintain 20-50 event buffer
- [ ] Implement checkpoint routine (flush → curate → rehydrate)
- [ ] **Deliverable**: Checkpoints produce high-quality memory objects

#### P2.3: Disable Continuous Extraction
- [ ] Make `RealtimeExtractor` opt-in only
- [ ] Default to checkpoint-driven mode
- [ ] **Deliverable**: No more per-event extraction noise

**Success Metric**: 90% of memories created at checkpoints, not per-event

---

### Phase 3: Code Truth Foundation (Week 3-4)
**Goal**: Link memories to code, enable auto-invalidation

#### P3.1: Enhance Code References
- [ ] Enhance `SymbolExtractor` for production use
- [ ] Add git commit tracking to `CodeReference`
- [ ] Implement `codeRef` auto-population in curator
- [ ] **Deliverable**: New memories have `codeRefs` when applicable

#### P3.2: Freshness Watcher
- [ ] Implement `FreshnessWatcher` background service
- [ ] Add git diff → invalidation logic
- [ ] CLI command: `alex check-freshness`
- [ ] **Deliverable**: Memories auto-downgrade when code changes

#### P3.3: Confidence Tier Calculation
- [ ] Implement auto-calculation of `confidenceTier`
- [ ] Migrate existing memories to new tier system
- [ ] Update retrieval to prioritize `grounded` tier
- [ ] **Deliverable**: Retrieval favors code-backed memories

**Success Metric**: >60% of active memories have `codeRefs`, freshness-checked

---

### Phase 4: Intelligent Retrieval (Week 4-5)
**Goal**: Right context for the right query

#### P4.1: Intent Router
- [ ] Implement intent classification
- [ ] Define per-intent retrieval plans
- [ ] Integrate router into `ContextPackCompiler`
- [ ] **Deliverable**: `alex pack --intent debug` works

#### P4.2: Progressive Disclosure
- [ ] Implement 3-level disclosure (minimal/task/deep)
- [ ] Add uncertainty detection helpers
- [ ] CLI: `alex pack --level minimal`
- [ ] **Deliverable**: Can generate context at different levels

#### P4.3: Evidence Snippet Fetching
- [ ] Implement on-demand evidence retrieval
- [ ] Add "show evidence" for specific memories
- [ ] **Deliverable**: Can expand context with supporting evidence

**Success Metric**: Average context pack size drops to ~600 tokens (vs. 1500)

---

### Phase 5: Production Hardening (Week 5-6)
**Goal**: Make it production-ready

#### P5.1: Tiered Curator Escalation
- [ ] Implement conflict detection
- [ ] Add Tier 2 (big LLM) escalation logic
- [ ] Cost tracking and budget limits
- [ ] **Deliverable**: System handles conflicts intelligently

#### P5.2: Micro-Review UX
- [ ] Inline revalidation prompts when stale memory accessed
- [ ] Auto-downgrade on non-response
- [ ] Batch review improvements
- [ ] **Deliverable**: Low-friction memory validation

#### P5.3: Monitoring & Metrics
- [ ] Dashboard: memory quality over time
- [ ] Alerts: high noise rate, low code-ref rate
- [ ] Cost tracking for LLM calls
- [ ] **Deliverable**: Observable system health

**Success Metric**: Memory accuracy >90%, avg curator cost <$0.05/session

---

## Migration Strategy

### For Existing Users

1. **Soft Migration** (default):
   - Existing memories stay in legacy mode
   - New memories use v2 architecture
   - Gradual transition over weeks

2. **Hard Migration** (opt-in):
   ```bash
   alex migrate-v2 --cleanup-noise
   ```
   - Retire noisy memories
   - Re-curate high-value memories with code refs
   - Recalculate confidence tiers

3. **Rollback**:
   - Schema changes are additive (no breaking changes)
   - Can disable v2 features via config
   ```bash
   alex config set curator.mode legacy
   ```

---

## Success Criteria

### Quantitative
- [ ] Memory accuracy: >90% (vs. unknown baseline)
- [ ] Noise rate: <10% (vs. ~70% currently)
- [ ] Avg context pack size: ~600 tokens (vs. 1500)
- [ ] Code-ref coverage: >60% of active memories
- [ ] Curator cost: <$0.05 per session

### Qualitative
- [ ] Developers trust the system (don't need to verify every memory)
- [ ] Context packs are relevant, not cluttered
- [ ] System adapts to code changes without manual intervention
- [ ] Debugging sessions reference actual fixes, not noise

---

## Open Questions

1. **Checkpoint Triggers**: How aggressive should we be?
   - Conservative: only on explicit task completion
   - Aggressive: every 20 events
   
2. **LLM Provider Default**: Local or API?
   - Local (Ollama): zero cost, slower, needs setup
   - API (Haiku): faster, small cost, always available
   
3. **Symbol Extraction Scope**: How deep?
   - Basic: top-level functions/classes
   - Advanced: full call graph, type inference
   
4. **Progressive Disclosure Trigger**: Manual or automatic?
   - Manual: user requests expansion
   - Automatic: detect uncertainty in agent response

---

## Appendix: File Changes Required

### New Files
- `src/ingestor/normalizer.ts` - Event normalization pipeline
- `src/ingestor/checkpoint.ts` - Checkpoint routine
- `src/ingestor/deterministic-curator.ts` - Tier 0 curator
- `src/retriever/router.ts` - Intent-aware routing
- `src/reviewer/freshness-watcher.ts` - Background invalidation
- `src/cli/commands/checkpoint.ts` - CLI command
- `src/cli/commands/migrate-v2.ts` - Migration script

### Modified Files
- `src/stores/schema.sql` - Add columns for v2
- `src/ingestor/intelligent-extractor.ts` - Add Tier 0/1/2 modes
- `src/retriever/context-pack.ts` - Add progressive disclosure
- `src/types/memory-objects.ts` - Add `confidenceTier`, `invalidationTrigger`
- `src/types/events.ts` - Add `synopsis`, `structuredSignals`, `episodeId`
- `src/code/git.ts` - Enhanced git operations
- `src/code/symbols.ts` - Production-ready symbol extraction

### Schema Migrations
```sql
-- Migration 001: v2 enhancements
ALTER TABLE events ADD COLUMN synopsis TEXT;
ALTER TABLE events ADD COLUMN structured_signals TEXT; -- JSON
ALTER TABLE events ADD COLUMN episode_id TEXT;

ALTER TABLE memory_objects ADD COLUMN confidence_tier TEXT 
  CHECK (confidence_tier IN ('grounded', 'observed', 'inferred', 'hypothesis'));
ALTER TABLE memory_objects ADD COLUMN invalidation_trigger TEXT;

CREATE INDEX idx_memory_code_refs ON memory_objects(code_refs);
CREATE INDEX idx_events_episode ON events(episode_id);
```

---

## Conclusion

This specification provides a clear path from the current noisy, real-time extraction system to a robust, evidence-backed, token-minimized architecture. 

**The key insight**: Memory is not a transcript summarizer. It's a truth manager with provenance, freshness, and progressive disclosure.

Implementation follows a phased approach where each phase delivers immediate value while building toward the complete vision.
