# Phase C: Query Intelligence

## Goal

Make retrieval smarter by understanding query intent and routing to different strategies.

**Before:** All queries use the same retrieval strategy

**After:** 
- "why is X failing?" → prioritize failed_attempts, known_fixes
- "how do we name files?" → prioritize conventions
- "what did we decide about X?" → prioritize decisions

---

## Components to Build

### C1. Intent Classifier

Classify queries into intents using keyword/pattern matching:

```typescript
type QueryIntent = 
  | 'debugging'       // errors, failures, bugs
  | 'conventions'     // how we do things, naming, style
  | 'implementation'  // how to build, add, create
  | 'architecture'    // structure, design, patterns
  | 'history'         // what we decided, past choices
  | 'validation'      // is X still true, verify
  | 'general';        // fallback
```

**File:** `src/retriever/intent.ts`

### C2. Retrieval Router

Route to different strategies based on intent:

| Intent | Type Filters | Token Budget | Boosts |
|--------|--------------|--------------|--------|
| debugging | failed_attempt, known_fix | 1000 | grounded +50% |
| conventions | convention, preference | 500 | - |
| implementation | decision, convention | 800 | hasCodeRefs +30% |
| architecture | decision | 600 | - |
| history | decision | 500 | older memories OK |
| validation | * | 300 | grounded only |
| general | * | 800 | default |

**File:** `src/retriever/router.ts`

### C3. Scope Extraction

Extract file/module scope from query:

- "auth module" → scope: module/auth
- "in src/api.ts" → scope: file/src/api.ts
- "database code" → scope: module/database

**File:** `src/retriever/scope.ts`

---

## Implementation Order

### Step 1: Intent Classifier (45 min) ✅ COMPLETE
- [x] Create `src/retriever/intent.ts`
- [x] Pattern-based classification
- [x] Add tests (9 tests)

### Step 2: Retrieval Router (45 min) ✅ COMPLETE
- [x] Create `src/retriever/router.ts`
- [x] Define retrieval plans per intent
- [x] Integrate with HybridSearch

### Step 3: Scope Extraction (30 min) ✅ COMPLETE
- [x] Create `src/retriever/scope.ts`
- [x] Extract file/module mentions from query
- [x] Add scope boost to reranker

### Step 4: Update Search Command (30 min) ✅ COMPLETE
- [x] Show detected intent
- [x] Use router for retrieval (`--smart` flag)
- [x] Display scope matches

### Step 5: Tests (30 min) ✅ COMPLETE
- [x] Intent classification tests (9 tests)
- [x] Router tests (8 tests)
- [x] Scope extraction tests (10 tests)

---

## Example Flow

```
User: "why is the FTS5 search failing?"
                ↓
Intent Classifier: "debugging"
                ↓
Router: {
  typeFilters: ['failed_attempt', 'known_fix'],
  tokenBudget: 1000,
  boosts: { grounded: 1.5 }
}
                ↓
Search with strategy
                ↓
Results prioritize:
  1. ❌ [failed_attempt] FTS5 queries fail with periods/hyphens
  2. ✅ [known_fix] Use porter tokenizer for FTS5
```
