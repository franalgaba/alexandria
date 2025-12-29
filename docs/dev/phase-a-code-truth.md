# Phase A: Code Truth Foundation

## Goal

Link memories to actual code so they auto-invalidate when the code changes.

**Before:** Memory says "Use fetchUser()" → code changes to getUser() → memory is silently wrong

**After:** Memory linked to `src/api.ts:fetchUser` → file changes → memory marked "stale" → Claude warned

---

## Components to Build

### A1. Code Reference Model

**File:** `src/types/code-refs.ts`

```typescript
type CodeRefType = 'file' | 'symbol' | 'line_range' | 'commit';

interface CodeReference {
  type: CodeRefType;
  path: string;                    // relative to project root
  symbol?: string;                 // function/class/variable name
  lineRange?: [number, number];    // start, end lines
  commitHash?: string;             // git commit when captured
  contentHash?: string;            // hash of referenced content
}
```

**Changes to `MemoryObject`:**
```typescript
interface MemoryObject {
  // ... existing fields
  codeRefs: CodeReference[];       // NEW
  lastVerifiedAt?: Date;           // NEW - when last confirmed true
}
```

**Database migration:**
```sql
ALTER TABLE memory_objects ADD COLUMN code_refs TEXT DEFAULT '[]';
ALTER TABLE memory_objects ADD COLUMN last_verified_at TEXT;
```

---

### A2. Git Integration

**File:** `src/code/git.ts`

Core functions:
```typescript
// Get current HEAD commit hash
function getCurrentCommit(projectPath?: string): string | null;

// Get list of files changed since a commit
function getChangedFilesSince(commit: string, projectPath?: string): string[];

// Get file content at a specific commit
function getFileAtCommit(path: string, commit: string, projectPath?: string): string | null;

// Check if path is in a git repo
function isGitRepo(projectPath?: string): boolean;

// Get the project root (where .git is)
function getGitRoot(startPath?: string): string | null;
```

**Implementation approach:**
- Use `child_process.execSync` to run git commands
- Cache results for performance
- Graceful fallback if not in git repo

---

### A3. Content Hashing

**File:** `src/code/hashing.ts`

```typescript
// Hash file content for change detection
function hashFileContent(path: string): string | null;

// Hash a code snippet
function hashSnippet(content: string): string;

// Check if file content matches a known hash
function contentMatches(path: string, expectedHash: string): boolean;
```

**Implementation:**
- Use SHA-256 truncated to 16 chars
- Normalize whitespace before hashing (optional)
- Handle file not found gracefully

---

### A4. Staleness Checker

**File:** `src/reviewer/staleness.ts`

```typescript
interface StalenessResult {
  memoryId: string;
  isStale: boolean;
  reason?: string;
  changedRefs?: CodeReference[];
}

class StalenessChecker {
  constructor(db: Database);
  
  // Check all memories with code refs
  checkAll(): StalenessResult[];
  
  // Check a single memory
  check(memory: MemoryObject): StalenessResult;
  
  // Mark memory as stale with reason
  markStale(memoryId: string, reason: string): void;
  
  // Mark memory as verified (reset staleness)
  markVerified(memoryId: string): void;
}
```

**Logic:**
1. Get all memories with `codeRefs.length > 0`
2. For each code ref:
   - If type=file: check if file hash changed
   - If type=symbol: check if symbol still exists (future)
   - If type=commit: check if file changed since that commit
3. If any ref changed → mark stale

---

### A5. CLI Commands

**New commands:**

```bash
# Check all memories for staleness
alex check
# Output:
# ⚠️ 3 memories need revalidation:
#   - [decision] "Use fetchUser for API" - src/api.ts changed
#   - [convention] "Use tabs for indent" - .editorconfig changed
#   - [known_fix] "Fix with retries" - src/retry.ts deleted

# Mark a memory as verified (still true)
alex verify <id>
# Output:
# ✓ Marked as verified: mjpr7l57_wz4aje

# Add code reference to existing memory
alex link <id> --file src/api.ts
alex link <id> --file src/api.ts --symbol fetchUser
alex link <id> --file src/api.ts --lines 10-25

# Show memory with code refs
alex show <id>
# Output:
# 🎯 [decision] Use fetchUser() for all API calls
#    Status: active
#    Confidence: high
#    Code refs:
#      📄 src/api.ts (hash: a1b2c3d4)
#      🔧 src/api.ts:fetchUser
#    Last verified: 2 days ago
#    Created: 5 days ago
```

**Updates to existing commands:**

```bash
# alex add now supports --file and --symbol
alex add "Use fetchUser for API calls" --type decision --file src/api.ts --approve

# alex list shows staleness warnings
alex list
# ID     | Type     | Content                    | Status | Stale
# -------|----------|----------------------------|--------|------
# mjp... | decision | Use fetchUser for API...   | active | ⚠️ YES
# mjp... | fix      | Retry on timeout           | active | 

# alex pack warns about stale memories
alex pack
# ⚠️ Warning: 2 memories in pack may be stale
# Run `alex check` for details
```

---

### A6. Hook Updates

**Update `context-hook.js`:**
- Run staleness check before generating pack
- Add warnings for stale memories in output

**Update `save-hook.js`:**
- Extract file paths from tool outputs
- Auto-link memories to mentioned files (optional, future)

---

## File Structure

```
src/
├── code/                      # NEW directory
│   ├── git.ts                 # Git operations
│   ├── hashing.ts             # Content hashing
│   └── index.ts               # Exports
├── reviewer/
│   ├── staleness.ts           # NEW: Staleness checker
│   └── ... existing files
├── types/
│   ├── code-refs.ts           # NEW: CodeReference types
│   └── memory-objects.ts      # Updated with codeRefs
├── cli/commands/
│   ├── check.ts               # NEW: alex check
│   ├── verify.ts              # NEW: alex verify
│   ├── link.ts                # NEW: alex link
│   ├── show.ts                # NEW: alex show
│   └── ... existing files
```

---

## Implementation Order

### Step 1: Types & Schema (30 min) ✅ COMPLETE
- [x] Create `src/types/code-refs.ts`
- [x] Update `src/types/memory-objects.ts` 
- [x] Update database schema in `connection.ts`
- [x] Update `MemoryObjectStore` to handle new fields

### Step 2: Git Integration (1 hour) ✅ COMPLETE
- [x] Create `src/code/git.ts`
- [x] Implement `getCurrentCommit()`
- [x] Implement `getChangedFilesSince()`
- [x] Implement `getGitRoot()`
- [x] Add tests

### Step 3: Content Hashing (30 min) ✅ COMPLETE
- [x] Create `src/code/hashing.ts`
- [x] Implement `hashFileContent()`
- [x] Implement `contentMatches()`
- [x] Add tests

### Step 4: Staleness Checker (1 hour) ✅ COMPLETE
- [x] Create `src/reviewer/staleness.ts`
- [x] Implement `StalenessChecker` class
- [x] Implement `checkAll()` and `check()`
- [x] Implement `markStale()` and `markVerified()`
- [x] Add tests

### Step 5: CLI Commands (1.5 hours) ✅ COMPLETE
- [x] Implement `alex check`
- [x] Implement `alex verify`
- [x] Implement `alex link`
- [x] Implement `alex show`
- [x] Update `alex add` with `--file` and `--symbol`
- [ ] Update `alex list` with staleness column (optional)
- [ ] Update `alex pack` with staleness warning (optional)

### Step 6: Hook Updates (30 min)
- [ ] Update context-hook to warn about stale
- [ ] Test end-to-end flow

### Step 7: Tests & Polish (1 hour) ✅ COMPLETE
- [x] Integration tests for full flow (54 tests passing)
- [x] Edge cases (no git, file deleted, etc.)
- [ ] Documentation updates

---

## Example Flow

### Creating a Linked Memory

```bash
# User adds a memory with file reference
$ alex add "Always use retry logic in API calls" --type convention --file src/utils/api.ts --approve

✓ Added memory: mjpr8abc_def123
📏 [convention] Always use retry logic in API calls
   Code refs: src/utils/api.ts (hash: a1b2c3d4, commit: abc123)
   Status: active, verified just now
```

### Detecting Staleness

```bash
# Later, someone modifies the file
$ git diff src/utils/api.ts
-export function fetchWithRetry() { ... }
+export function fetchWithBackoff() { ... }

# User runs check
$ alex check

⚠️ 1 memory needs revalidation:

  📏 [convention] Always use retry logic in API calls
     Reason: src/utils/api.ts changed (commit abc123 → def456)
     Changed: fetchWithRetry → fetchWithBackoff
     
  Actions:
    alex verify mjpr8abc  # Still true
    alex edit mjpr8abc    # Update content
    alex retire mjpr8abc  # No longer applies
```

### Context Pack with Warnings

```bash
$ alex pack

=== Alexandria Context Pack ===

⚠️ WARNING: 1 memory may be outdated (run `alex check`)

🚫 Constraints (always apply):
   • Always run tests before committing

💡 Relevant Memories:
   ⚠️ [convention] Always use retry logic in API calls  ← NEEDS VERIFICATION
   ✅ [known_fix] Use exponential backoff for rate limits
   🎯 [decision] Use axios over fetch for HTTP

📊 Token usage: 180/1500
```

---

## Success Criteria

1. **Memories can be linked to files**
   - `alex add --file` works
   - `alex link` works on existing memories
   
2. **Changes are detected**
   - `alex check` finds stale memories
   - Correctly identifies which file changed
   
3. **Warnings are visible**
   - `alex list` shows staleness
   - `alex pack` warns about stale memories
   - Context hook includes warnings
   
4. **Verification works**
   - `alex verify` marks memory as current
   - Updates `lastVerifiedAt` timestamp
   
5. **Tests pass**
   - Git operations work
   - Staleness detection works
   - Edge cases handled (no git, deleted files)

---

## Future Enhancements (Not in Phase A)

- Symbol-level tracking (needs AST parsing)
- Auto-linking from conversation (extract file mentions)
- File watcher for real-time invalidation
- Commit message parsing for context
- CI integration for test-linked memories
