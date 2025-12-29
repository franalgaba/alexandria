# Alexandria v2 Roadmap: Towards the Best System

## Current State: v1.0 (42/100)

We have a working memory system with:
- ✅ Event ingestion and storage
- ✅ Memory objects with types, status, confidence
- ✅ Hybrid search (FTS5 + vector)
- ✅ Token-budgeted context packs
- ✅ Claude Code hooks
- ✅ Review workflow

## Target State: v2.0 (85+/100)

A code-aware, self-validating memory system that:
- Links memories to actual code (files, symbols, commits)
- Auto-invalidates when code changes
- Detects and resolves contradictions
- Uses progressive disclosure for minimal tokens
- Provides structured provenance for all claims

---

## Phase A: Code Truth Foundation (Week 1-2)

### A1. Code Reference Model

Add to `MemoryObject`:

```typescript
interface CodeReference {
  type: 'file' | 'symbol' | 'commit' | 'line_range';
  path?: string;           // file path relative to project root
  symbol?: string;         // function/class/variable name
  commitHash?: string;     // git commit when this was true
  lineRange?: [number, number];
  lastVerifiedAt?: Date;   // when we last confirmed this
  contentHash?: string;    // hash of the referenced content
}

interface MemoryObject {
  // ... existing fields
  codeRefs: CodeReference[];      // NEW: links to code
  lastVerifiedAt?: Date;          // NEW: when last confirmed true
  invalidationTrigger?: string;   // NEW: "file:src/api.ts" or "symbol:fetchUser"
}
```

### A2. Git Integration

New module: `src/code/git.ts`

```typescript
interface GitInfo {
  currentCommit: string;
  branch: string;
  changedFiles: string[];      // files changed since a given commit
  fileAtCommit(path: string, commit: string): string | null;
}

// Functions:
getCurrentCommit(): string
getChangedFilesSince(commit: string): string[]
getFileContentAtCommit(path: string, commit: string): string
```

### A3. File Watcher Service

New module: `src/code/watcher.ts`

```typescript
// Watch for file changes and trigger staleness checks
class FileWatcher {
  watch(projectRoot: string): void;
  onFileChange(callback: (path: string) => void): void;
  
  // When a file changes, find memories that reference it
  // and mark them as "needs_revalidation"
}
```

### A4. Staleness Checker

New module: `src/reviewer/staleness.ts`

```typescript
class StalenessChecker {
  // Run periodically or on file change
  checkAll(): StaleMemory[];
  
  // Check if a specific memory's code refs are still valid
  check(memory: MemoryObject): {
    isStale: boolean;
    reason?: string;  // "file changed", "symbol removed", etc.
  };
  
  // Mark stale and optionally notify
  markStale(memoryId: string, reason: string): void;
}
```

### A5. Database Schema Updates

```sql
-- Add columns to memory_objects
ALTER TABLE memory_objects ADD COLUMN code_refs TEXT;  -- JSON array
ALTER TABLE memory_objects ADD COLUMN last_verified_at TEXT;
ALTER TABLE memory_objects ADD COLUMN invalidation_trigger TEXT;

-- New table for tracking file states
CREATE TABLE file_snapshots (
  path TEXT NOT NULL,
  commit_hash TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  PRIMARY KEY (path, commit_hash)
);

-- Index for finding memories by file reference
CREATE INDEX idx_memory_code_refs ON memory_objects(code_refs);
```

---

## Phase B: Provenance Enforcement (Week 2-3)

### B1. Evidence Requirements

Update memory creation to require evidence:

```typescript
interface CreateMemoryInput {
  content: string;
  objectType: ObjectType;
  // Evidence is now REQUIRED for certain types
  evidence: {
    eventIds?: string[];        // conversation events
    codeRefs?: CodeReference[]; // code links
    excerpt?: string;           // supporting text
  };
}

// Confidence is AUTO-CALCULATED based on evidence:
// - Has code refs + recent verification = "grounded" 
// - Has event IDs only = "observed"
// - No evidence = "hypothesis" (low priority in retrieval)
```

### B2. Confidence Tiers

Replace `certain/high/medium/low` with semantic tiers:

```typescript
type ConfidenceTier = 
  | 'grounded'    // Linked to code, recently verified
  | 'observed'    // Seen in conversation, no code link
  | 'inferred'    // Extracted by AI, not confirmed
  | 'hypothesis'  // Suggested, never confirmed
  | 'stale';      // Was grounded, code has changed
```

### B3. Revalidation Prompts

When stale memory is accessed:

```typescript
interface RevalidationPrompt {
  memory: MemoryObject;
  reason: string;           // "src/api.ts changed since this was confirmed"
  currentCodeSnippet?: string;
  options: ['still_true', 'needs_update', 'no_longer_applies'];
}

// In context pack output:
// ⚠️ [NEEDS REVALIDATION] "Use fetchUser() for API calls"
//    Reason: src/api.ts changed. Still true? [Y/n/update]
```

---

## Phase C: Query Intelligence (Week 3-4)

### C1. Intent Classifier

New module: `src/retriever/intent.ts`

```typescript
type QueryIntent = 
  | 'conventions'      // "how do we name files?"
  | 'debugging'        // "why is X failing?"
  | 'implementation'   // "how do I add Y?"
  | 'architecture'     // "what's the structure of Z?"
  | 'history'          // "what did we decide about X?"
  | 'validation';      // "is X still true?"

function classifyIntent(query: string): QueryIntent;
```

### C2. Retrieval Router

Different strategies per intent:

```typescript
class RetrievalRouter {
  route(intent: QueryIntent, query: string): RetrievalPlan;
}

interface RetrievalPlan {
  // Which stores to query
  sources: ('memories' | 'events' | 'code')[];
  
  // Type filters
  typeFilters: ObjectType[];
  
  // Boost factors
  boosts: {
    recentlyVerified?: number;
    hasCodeRefs?: number;
    matchesScope?: number;
  };
  
  // Token budget for this query type
  tokenBudget: number;
}

// Examples:
// 'conventions' → memories only, types=[convention], budget=500
// 'debugging' → memories + events, types=[known_fix, failed_attempt], budget=1000
// 'validation' → memories + code, require code_refs, budget=300
```

### C3. Scope Matching

```typescript
interface ScopeMatch {
  // Query mentions "auth module" → boost memories scoped to auth/
  extractScopeFromQuery(query: string): Scope | null;
  
  // Score how well a memory's scope matches the query scope
  scoreScopeMatch(memoryScope: Scope, queryScope: Scope): number;
}
```

---

## Phase D: Conflict & Progressive (Week 4-5)

### D1. Contradiction Detector

```typescript
class ContradictionDetector {
  // Find memories that contradict each other
  findConflicts(memories: MemoryObject[]): Conflict[];
  
  // Check if new memory contradicts existing
  checkNewMemory(candidate: MemoryCandidate): Conflict[];
}

interface Conflict {
  memories: [MemoryObject, MemoryObject];
  type: 'direct' | 'implicit' | 'temporal';
  description: string;
  suggestedResolution: 'keep_newer' | 'keep_grounded' | 'ask_user';
}
```

### D2. Progressive Disclosure

Replace single context pack with progressive system:

```typescript
class ProgressiveRetriever {
  // Level 1: Minimal (constraints + active warnings)
  getMinimalContext(): ContextPack;  // ~200 tokens
  
  // Level 2: Task-relevant (add relevant memories)
  getTaskContext(query: string): ContextPack;  // ~500 tokens
  
  // Level 3: Deep (add evidence, history)
  getDeepContext(query: string): ContextPack;  // ~1500 tokens
  
  // The agent starts with L1, upgrades on uncertainty
}
```

### D3. Uncertainty Detection

```typescript
// Detect when the agent should request more context
interface UncertaintySignals {
  // In agent's response
  phrases: ['not sure', 'might be', 'I think', 'could be'];
  
  // In query
  exploratoryPatterns: ['how does', 'what is', 'why'];
  
  // Action: if uncertainty detected, offer to retrieve more
}
```

---

## Phase E: Structured Types (Week 5-6)

### E1. Decision Type Enhancement

```typescript
interface DecisionMemory extends MemoryObject {
  objectType: 'decision';
  structured: {
    decision: string;
    alternatives: string[];
    rationale: string;
    tradeoffs?: string[];
    decidedAt: Date;
    decidedBy?: string;  // "team", "user", "inferred"
  };
}

// Storage: JSON in content field, parsed on read
// Display: formatted nicely in context pack
```

### E2. Interface/Contract Type

```typescript
interface ContractMemory extends MemoryObject {
  objectType: 'contract';
  structured: {
    name: string;           // "User API"
    type: 'api' | 'schema' | 'interface' | 'protocol';
    definition: string;     // OpenAPI spec, TypeScript interface, etc.
    codeRef: CodeReference; // where it's defined
  };
}
```

### E3. Plan/Roadmap Type

```typescript
interface PlanMemory extends MemoryObject {
  objectType: 'plan';
  structured: {
    goal: string;
    steps: { description: string; status: 'done' | 'current' | 'pending' }[];
    updatedAt: Date;
  };
  
  // Special behavior: only ONE active plan per scope
  // New plan supersedes old automatically
}
```

---

## Implementation Priority

### Must Have (v2.0)
1. **A1-A4**: Code references and staleness checking
2. **B1-B2**: Provenance enforcement and confidence tiers  
3. **C1-C2**: Intent classification and retrieval routing
4. **D2**: Progressive disclosure

### Should Have (v2.1)
1. **A5**: File watcher for real-time invalidation
2. **B3**: Inline revalidation prompts
3. **D1**: Contradiction detection
4. **E1**: Structured decision type

### Nice to Have (v2.2)
1. **C3**: Scope matching
2. **D3**: Uncertainty detection
3. **E2-E3**: Contract and plan types
4. Symbol-level AST parsing
5. CI/test integration

---

## Metrics for Success

| Metric | Current | Target |
|--------|---------|--------|
| Memory accuracy (% still true) | Unknown | >90% |
| Stale memory detection | 0% | >80% |
| Context tokens per query | ~1500 fixed | ~500 average |
| Time to find relevant memory | ~200ms | <100ms |
| Contradiction rate | Unknown | <5% |
| Developer review time | ~30s/memory | <10s/memory |

---

## Technical Decisions

### Why not use a full LSP?
- Too heavy for initial version
- Start with git + file hashes
- Add symbol extraction later (tree-sitter)

### Why not use LLM for reranking?
- Latency (~500ms+ per query)
- Cost at scale
- Rule-based works well for structured memory
- Can add as optional enhancement

### Why progressive disclosure?
- Most queries need <500 tokens of context
- Full pack wastes tokens on irrelevant memories
- Agent can request more when uncertain

### Why require provenance?
- Memories without evidence rot fastest
- Code refs enable auto-invalidation
- Builds trust in the system
