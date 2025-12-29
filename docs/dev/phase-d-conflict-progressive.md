# Phase D: Conflict Detection & Progressive Disclosure

## Overview

Phase D adds two key capabilities:
1. **Contradiction Detection** - Find conflicting memories before they cause problems
2. **Progressive Disclosure** - Start minimal, expand on uncertainty

## D1. Contradiction Detector

### Location: `src/utils/conflicts.ts`

```typescript
interface Conflict {
  memories: [MemoryObject, MemoryObject];
  type: 'direct' | 'implicit' | 'temporal';
  description: string;
  suggestedResolution: 'keep_newer' | 'keep_grounded' | 'ask_user';
}

class ContradictionDetector {
  findConflicts(memories: MemoryObject[]): Conflict[];
  checkNewMemory(candidate: MemoryObject, existing: MemoryObject[]): Conflict[];
}
```

### Detection Strategies

1. **Direct Contradiction** - Same topic, opposite statements
   - "Use tabs" vs "Use spaces"
   - Pattern: negation, antonyms, opposite values

2. **Implicit Contradiction** - Incompatible approaches
   - "Use REST API" vs "Use GraphQL"
   - Pattern: mutually exclusive choices

3. **Temporal Contradiction** - Outdated vs current
   - Old decision superseded by new one
   - Pattern: same topic, different dates, no supersedes link

### Implementation Approach

1. Group memories by semantic similarity (vector distance)
2. Within groups, check for contradiction patterns
3. Use confidence tier to suggest resolution

## D2. Progressive Disclosure

### Location: `src/retriever/progressive.ts`

```typescript
class ProgressiveRetriever {
  getMinimalContext(): ContextPack;      // ~200 tokens
  getTaskContext(query: string): ContextPack;  // ~500 tokens  
  getDeepContext(query: string): ContextPack;  // ~1500 tokens
}
```

### Level Definitions

| Level | Content | Token Budget | Use Case |
|-------|---------|--------------|----------|
| Minimal | constraints + active warnings | ~200 | Every turn |
| Task | + relevant memories for query | ~500 | Most tasks |
| Deep | + evidence, history, related | ~1500 | Complex tasks |

### What Goes in Each Level

**Minimal (~200 tokens)**
- All `constraint` type memories
- All `stale` warnings (memories needing revalidation)
- High-priority conventions

**Task (~500 tokens)**
- Minimal context
- Search results for current query
- Filtered by intent (Phase C)

**Deep (~1500 tokens)**
- Task context
- Evidence (linked events)
- Related memories (semantic neighbors)
- Historical decisions on same topic

## D3. Uncertainty Detection

### Location: `src/utils/uncertainty.ts`

Detect when agent should request more context:

```typescript
interface UncertaintySignals {
  inResponse: string[];  // "not sure", "might be", "I think"
  inQuery: string[];     // "how does", "what is", "why"
}

function detectUncertainty(text: string): boolean;
function suggestContextLevel(query: string, currentLevel: number): number;
```

## Implementation Order

### Step 1: Progressive Retriever (45 min) ✅ COMPLETE
- [x] Create `src/retriever/progressive.ts`
- [x] Implement three context levels
- [x] Add `alex pack --level minimal|task|deep`
- [x] Add `alex pack --auto` for auto-level selection

### Step 2: Contradiction Detector (60 min) ✅ COMPLETE
- [x] Create `src/utils/conflicts.ts`
- [x] Implement direct contradiction detection (negation, antonyms)
- [x] Implement implicit contradiction (exclusive choices)
- [x] Implement temporal contradiction (old vs new)
- [x] Add `alex conflicts` command

### Step 3: Uncertainty Detection (30 min) ✅ COMPLETE
- [x] Create `src/utils/uncertainty.ts`
- [x] Pattern matching for uncertainty phrases
- [x] Query complexity analysis
- [x] Context level suggestions

### Step 4: CLI Updates (30 min) ✅ COMPLETE
- [x] Update `alex pack` with `--level` and `--auto` flags
- [x] Add `alex conflicts` command
- [x] Updated context pack formatting for progressive format

### Step 5: Tests (30 min) ✅ COMPLETE
- [x] Progressive retriever tests (11 tests)
- [x] Contradiction detection tests (10 tests)
- [x] Uncertainty detection tests (16 tests)

## Expected Impact

- **Token Savings**: 60-80% reduction in default context (minimal vs full pack)
- **Conflict Prevention**: Catch contradictions before they cause confusion
- **Adaptive Context**: Right amount of context for each query
