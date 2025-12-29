# Alexandria Gap Analysis: Current vs. Best System

## Executive Summary

Alexandria has **solid foundations** but is missing critical components for a truly robust memory system. The main gaps are:

1. **No code truth layer** - Memories aren't linked to actual code
2. **No freshness invalidation** - No auto-staleness when code changes  
3. **Weak provenance** - Evidence links exist but aren't enforced
4. **No query classification** - All retrievals use same strategy
5. **Missing memory types** - No interface/contract or roadmap types

---

## Component-by-Component Analysis

### 1. Lossless Ground Truth Store

| Feature | Best System | Alexandria | Gap |
|---------|-------------|------------|-----|
| Append-only event log | ✅ | ✅ `EventStore` | - |
| Conversation turns | ✅ | ⚠️ Partial (tool outputs only) | Need full turn capture |
| Tool calls/results | ✅ | ✅ PostToolUse hook | - |
| Diffs/patches | ✅ | ❌ Not captured | Need Edit hook |
| Test runs, stack traces | ✅ | ⚠️ Only if in Bash output | Need structured parsing |
| Environment info | ✅ | ⚠️ Basic | Need version extraction |
| Out-of-band blob storage | ✅ | ✅ `BlobStore` | - |
| Content hashing | ✅ | ✅ Deduplication | - |
| Pointers to full content | ✅ | ✅ `blob_id` reference | - |

**Score: 7/10** - Good foundation, missing conversation turns and structured event parsing.

---

### 2. Curated Memory Objects

| Feature | Best System | Alexandria | Gap |
|---------|-------------|------------|-----|
| Status lifecycle | `active/superseded/stale/retired` | ✅ Same | - |
| Scope hierarchy | `global→workspace→project→module→file` | ⚠️ `global/project` only | Need finer scopes |
| Freshness policy | "invalidate if X changes" | ❌ None | **Critical gap** |
| Provenance (event links) | ✅ Required | ⚠️ Optional, rarely set | Need enforcement |
| Code refs (file/symbol/commit) | ✅ Required | ❌ None | **Critical gap** |
| Confidence tiers | `grounded/decision/hypothesis` | ⚠️ `certain/high/medium/low` | Needs semantic alignment |

**Memory Types:**

| Type | Best System | Alexandria | Gap |
|------|-------------|------------|-----|
| Decisions | ✅ with alternatives + rationale | ⚠️ Basic content only | Need structured format |
| Constraints | ✅ | ✅ | - |
| Conventions | ✅ | ✅ | - |
| Known fixes | ✅ symptom → resolution | ⚠️ Basic | Need structured format |
| Failed attempts | ✅ "don't retry X" | ✅ | - |
| Interface/contract claims | ✅ with schema evidence | ❌ None | **New type needed** |
| Current plan/roadmap | ✅ small, mutable | ❌ None | **New type needed** |

**Score: 5/10** - Types exist but lack structure, provenance, and code linkage.

---

### 3. Code Truth Layer

| Feature | Best System | Alexandria | Gap |
|---------|-------------|------------|-----|
| Symbol/LSP/AST index | ✅ | ❌ None | **Critical gap** |
| Commit-aware snapshots | ✅ | ❌ None | **Critical gap** |
| Contract extraction | OpenAPI, protobuf, GraphQL | ❌ None | New component |
| CI/runtime signals | Test results, lint, perf | ❌ None | New component |
| Memory→code links | file + symbol + commit | ❌ None | **Critical gap** |
| Auto-invalidation on change | ✅ | ❌ None | **Critical gap** |

**Score: 0/10** - Completely missing. This is the biggest gap.

---

### 4. Query Understanding

| Feature | Best System | Alexandria | Gap |
|---------|-------------|------------|-----|
| Intent classification | conventions/debugging/code-truth/decisions | ❌ None | New component |
| Retrieval plan selection | Different strategies per intent | ❌ Single strategy | Need router |
| "Need conventions?" detection | ✅ | ❌ | Part of classifier |
| "Need debugging history?" | ✅ | ❌ | Part of classifier |
| "Need exact code truth?" | ✅ | ❌ | Part of classifier |

**Score: 1/10** - Only basic task type detection in reranker.

---

### 5. Hybrid Retrieval

| Feature | Best System | Alexandria | Gap |
|---------|-------------|------------|-----|
| Lexical (BM25/FTS) | ✅ | ✅ FTS5 with porter | - |
| Vector search | ✅ | ⚠️ In-memory fallback | Need sqlite-vec |
| Structural search | symbols, call graph | ❌ None | Needs code layer |
| Time/recency filters | ✅ | ⚠️ Basic | Need temporal boost |
| Status filters | ✅ | ✅ | - |
| RRF fusion | ✅ | ✅ | - |

**Score: 6/10** - Core retrieval works, missing structural search.

---

### 6. Reranking + Conflict Resolution

| Feature | Best System | Alexandria | Gap |
|---------|-------------|------------|-----|
| Status priority | `active > stale > superseded` | ✅ | - |
| Grounding priority | `grounded > ungrounded` | ⚠️ Confidence only | Need provenance check |
| Recency priority | most recently confirmed | ⚠️ Basic | Need "last confirmed" |
| Scope match priority | tighter > general | ❌ None | Need scope scoring |
| Contradiction detection | ✅ | ❌ None | **Important gap** |
| Resolution step | pick newer grounded / micro-confirm | ❌ None | Need conflict resolver |
| LLM/cross-encoder rerank | ✅ | ❌ Rule-based only | Optional improvement |

**Score: 4/10** - Basic reranking exists, no conflict handling.

---

### 7. Context Pack Compiler

| Feature | Best System | Alexandria | Gap |
|---------|-------------|------------|-----|
| Token budget enforcement | ✅ 800-1500 tokens | ✅ 1500 default | - |
| Active Truth Header | goal + constraints + plan + conventions | ⚠️ Constraints only | Need goal/plan |
| Task-specific memory | 3-10 objects max | ✅ Greedy packing | - |
| Evidence excerpts | shortest proving snippet | ⚠️ Optional excerpt | Need smarter extraction |
| Pointers not artifacts | event/commit refs | ❌ None | Need reference format |
| Progressive disclosure | start minimal, expand on uncertainty | ❌ Single pack | **Important gap** |

**Score: 6/10** - Packing works, missing progressive disclosure.

---

### 8. Reviewer Loop

| Feature | Best System | Alexandria | Gap |
|---------|-------------|------------|-----|
| Candidate extraction | ✅ | ✅ `Extractor` | - |
| Deduplication/merge | ✅ | ✅ `Merger` | - |
| Provenance attachment | ✅ | ⚠️ Optional | Need enforcement |
| Scope assignment | ✅ | ⚠️ Basic | Need auto-detection |
| Status/tier assignment | ✅ | ✅ | - |

**Score: 7/10** - Good, needs provenance enforcement.

---

### 9. Revalidation & Decay

| Feature | Best System | Alexandria | Gap |
|---------|-------------|------------|-----|
| File/symbol change → stale | ✅ | ❌ None | **Critical gap** |
| Time-based decay | N weeks → downgrade | ❌ None | New feature |
| Contradiction → supersede | ✅ | ❌ None | Need detector |
| History preservation | never overwrite | ✅ Supersession chain | - |

**Score: 2/10** - History preserved, no auto-invalidation.

---

### 10. Developer Confirmation

| Feature | Best System | Alexandria | Gap |
|---------|-------------|------------|-----|
| Inline micro-review | "still true?" prompts | ❌ None | New UX |
| Batch review | with defaults | ✅ `alex review` | - |
| Ignore → stale | auto-downgrade | ❌ None | Need decay |
| Low friction | ✅ | ⚠️ CLI only | Need inline prompts |

**Score: 4/10** - Batch review works, no inline.

---

## Overall Scores

| Component | Score | Priority |
|-----------|-------|----------|
| 1. Ground Truth Store | 7/10 | Medium |
| 2. Memory Objects | 5/10 | High |
| 3. Code Truth Layer | 0/10 | **Critical** |
| 4. Query Understanding | 1/10 | High |
| 5. Hybrid Retrieval | 6/10 | Medium |
| 6. Reranking | 4/10 | Medium |
| 7. Context Pack | 6/10 | Medium |
| 8. Reviewer Loop | 7/10 | Low |
| 9. Revalidation | 2/10 | **Critical** |
| 10. Confirmation UX | 4/10 | Low |

**Overall: 42/100**

---

## Critical Path: What to Build Next

### Phase A: Code Truth Foundation (High Impact)
1. **Code reference model** - Link memories to files/symbols/commits
2. **Git integration** - Track commits, detect changes
3. **File watcher** - Detect when linked files change → mark stale
4. **Symbol extraction** - Basic AST parsing for key languages

### Phase B: Provenance & Freshness (High Impact)
1. **Require evidence** - Memories without provenance get low confidence
2. **Last confirmed timestamp** - When was this last verified?
3. **Auto-staleness** - If linked code changed, mark needs-revalidation
4. **Decay policy** - Time-based confidence reduction

### Phase C: Query Intelligence (Medium Impact)
1. **Intent classifier** - What kind of query is this?
2. **Retrieval router** - Different strategies for different intents
3. **Scope matcher** - Boost memories matching query scope

### Phase D: Conflict & Progressive (Medium Impact)
1. **Contradiction detector** - Find conflicting active memories
2. **Resolution prompts** - Ask user to resolve
3. **Progressive disclosure** - Start minimal, expand on demand

### Phase E: Structured Types (Lower Impact)
1. **Decision format** - Alternatives, rationale, tradeoffs
2. **Interface/contract type** - Schema + evidence
3. **Plan/roadmap type** - Current state, mutable

---

## Minimal Viable "Best System"

If we had to pick the absolute essentials:

1. ✅ Memory objects with status + scope + provenance (partial)
2. ❌ **Freshness invalidation when code changes** (missing)
3. ✅ Hybrid retrieval + reranking (works)
4. ✅ Token-budgeted context pack (works)
5. ⚠️ Progressive disclosure (missing)
6. ✅ Out-of-band tool traces (works)

**The single biggest gap is #2: Code-aware freshness.**

Without it, memories rot silently as the codebase evolves.
