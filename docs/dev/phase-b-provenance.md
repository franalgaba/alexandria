# Phase B: Provenance Enforcement

## Goal

Ensure memories have proper evidence backing, and auto-calculate confidence based on evidence quality.

**Before:** All memories have user-assigned confidence (`high`, `medium`, `low`)

**After:** Confidence is calculated from evidence:
- Has code refs + recently verified → `grounded`
- Has event evidence → `observed`  
- No evidence → `hypothesis`

---

## Components to Build

### B1. Confidence Tiers

Replace arbitrary confidence levels with semantic tiers based on evidence:

```typescript
type ConfidenceTier = 
  | 'grounded'    // Linked to code, recently verified
  | 'observed'    // Has event evidence, no code link
  | 'inferred'    // Extracted by AI, not user-confirmed
  | 'hypothesis'; // No evidence, user-suggested

// Staleness is separate - a grounded memory can become stale
```

**File:** Update `src/types/memory-objects.ts`

### B2. Auto-Calculate Confidence

When creating/updating memories, calculate confidence from evidence:

```typescript
function calculateConfidence(memory: {
  codeRefs?: CodeReference[];
  evidenceEventIds?: string[];
  reviewStatus: ReviewStatus;
  lastVerifiedAt?: Date;
}): ConfidenceTier {
  const hasCodeRefs = memory.codeRefs && memory.codeRefs.length > 0;
  const hasEvents = memory.evidenceEventIds && memory.evidenceEventIds.length > 0;
  const isVerified = memory.lastVerifiedAt !== undefined;
  const isApproved = memory.reviewStatus === 'approved';
  
  if (hasCodeRefs && isVerified && isApproved) {
    return 'grounded';
  }
  if (hasEvents || isApproved) {
    return 'observed';
  }
  if (memory.reviewStatus === 'pending') {
    return 'inferred';
  }
  return 'hypothesis';
}
```

**File:** `src/utils/confidence.ts`

### B3. Retrieval Priority

Use confidence tier in search ranking:

```
grounded  → boost 2.0x (most reliable)
observed  → boost 1.5x
inferred  → boost 1.0x (default)
hypothesis → boost 0.5x (lowest priority)
```

**Update:** `src/retriever/reranker.ts`

### B4. Context Pack Warnings

Show confidence in context pack output:

```
=== Alexandria Context Pack ===

🚫 Constraints (always apply):
   • Always run tests before committing

💡 Verified Memories:
   ✅ [grounded] Use bun:sqlite for database - src/stores/connection.ts
   👁️ [observed] FTS5 needs special character escaping

⚠️ Unverified (use with caution):
   💭 [hypothesis] Consider using sqlite-vec for vectors
```

### B5. CLI Enhancements

Update `alex list` to show confidence tier:

```bash
$ alex list
ID     | Type     | Content              | Confidence | Code Refs
-------|----------|----------------------|------------|----------
mjp... | decision | Use bun:sqlite       | grounded   | 1 file
mjp... | fix      | Escape FTS5 chars    | observed   | -
mjp... | decision | Try sqlite-vec       | hypothesis | -
```

---

## Implementation Order

### Step 1: Update Types (15 min) ✅ COMPLETE
- [x] Add `ConfidenceTier` type
- [x] Keep old `Confidence` for backwards compatibility
- [x] Add `confidenceTier` field to MemoryObject

### Step 2: Confidence Calculator (30 min) ✅ COMPLETE
- [x] Create `src/utils/confidence.ts`
- [x] Implement `calculateConfidenceTier()`
- [x] Add auto-calculation on create/update

### Step 3: Update Reranker (30 min) ✅ COMPLETE
- [x] Add confidence tier boosts
- [x] Prefer grounded over observed over hypothesis

### Step 4: Update Context Pack (30 min) ✅ COMPLETE
- [x] Group by confidence tier
- [x] Show tier indicators in output

### Step 5: Update CLI (30 min) ✅ COMPLETE
- [x] Update `alex list` to show confidence tier
- [x] Update `alex show` to explain confidence

### Step 6: Tests (30 min) ✅ COMPLETE
- [x] Test confidence calculation (12 tests)
- [x] Test reranker with tiers
- [x] Test context pack grouping

---

## Migration Strategy

Existing memories will get confidence calculated on first access:
1. Has `codeRefs` + `lastVerifiedAt` → `grounded`
2. Has `evidenceEventIds` → `observed`
3. `reviewStatus === 'approved'` → `observed`
4. `reviewStatus === 'pending'` → `inferred`
5. Otherwise → `hypothesis`

No database migration needed - calculate on read, update on write.
