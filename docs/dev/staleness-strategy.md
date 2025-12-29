# Staleness Detection Strategy

## Problem

Checking file content hashes causes constant false positives during active development:
- User saves file → memory marked stale
- User saves again → still stale
- User is just iterating, not done yet

## Solution: Commit-Based Staleness

### Core Principle

**Memories are validated against commits, not file contents.**

A memory is "stale" when:
1. The referenced file has been modified in a commit AFTER the memory's `verifiedAtCommit`
2. The referenced file has been deleted

A memory is NOT stale when:
- File has uncommitted changes (user is still working)
- File hasn't changed since the memory's commit

### Data Model

```typescript
interface CodeReference {
  type: 'file' | 'symbol' | 'line_range';
  path: string;
  symbol?: string;
  lineRange?: [number, number];
  
  // Commit-based tracking (PRIMARY)
  verifiedAtCommit: string;  // Commit hash when last verified
  
  // Content hash (SECONDARY - for uncommitted detection)
  contentHash?: string;      // Optional, for detecting uncommitted changes
}
```

### When to Check

| Event | Action | Rationale |
|-------|--------|-----------|
| Session start | Check all, warn about stale | Good checkpoint, not disruptive |
| `alex check` | Full check with details | On-demand, user-initiated |
| Post-commit | Auto-verify unchanged files | Commit = stable checkpoint |
| Memory retrieval | Lazy check, add warning | Just-in-time, efficient |

### NOT When to Check

| Event | Why Not |
|-------|---------|
| File save | Too noisy, user is still working |
| File watcher | Constant invalidation |
| Every tool use | Performance overhead |

### Staleness Levels

```
┌─────────────────────────────────────────────────────────────────┐
│ VERIFIED                                                         │
│ File unchanged since verifiedAtCommit                           │
│ → Show normally in context                                       │
└─────────────────────────────────────────────────────────────────┘
                              ↓ file changed in new commit
┌─────────────────────────────────────────────────────────────────┐
│ NEEDS REVIEW                                                     │
│ File changed in commit after verifiedAtCommit                   │
│ → Show with ⚠️ warning, still include in context                │
└─────────────────────────────────────────────────────────────────┘
                              ↓ file deleted OR confirmed wrong
┌─────────────────────────────────────────────────────────────────┐
│ STALE                                                            │
│ Memory definitely outdated                                       │
│ → Exclude from context, prompt for update/retire                 │
└─────────────────────────────────────────────────────────────────┘
```

### Implementation

#### 1. Check Logic

```typescript
function checkStaleness(memory: MemoryObject): StalenessLevel {
  for (const ref of memory.codeRefs) {
    // Check if file exists
    if (!fileExists(ref.path)) {
      return 'stale'; // File deleted
    }
    
    // Check if file changed since verified commit
    const changedFiles = getChangedFilesSince(ref.verifiedAtCommit);
    if (changedFiles.includes(ref.path)) {
      return 'needs_review'; // Changed in a commit
    }
  }
  
  return 'verified';
}
```

#### 2. Session Start Hook

```javascript
// On session start:
// 1. Run alex check --quiet
// 2. Include warnings in context pack

const staleCount = checkAll().filter(r => r.isStale).length;
if (staleCount > 0) {
  console.log(`⚠️ ${staleCount} memories may be outdated`);
}
```

#### 3. Post-Commit Hook (Optional)

```bash
#!/bin/bash
# .git/hooks/post-commit

# Get files changed in this commit
CHANGED=$(git diff-tree --no-commit-id --name-only -r HEAD)

# Auto-verify memories that reference unchanged files
alex check --auto-verify-unchanged

# Notify about memories that need review
alex check --changed-only
```

#### 4. Context Pack Output

```
=== Alexandria Context Pack ===

🚫 Constraints:
   • Always run tests before committing

⚠️ Needs Verification (1):
   • [decision] Use fetchUser() - src/api.ts changed in commit abc123

💡 Verified Memories:
   • [convention] Use TypeScript strict mode
   • [known_fix] Add retry logic for API calls
```

### User Workflow

```
1. User works on code, saves frequently
   → Memories stay "verified" (no commit yet)

2. User commits
   → Post-commit hook runs
   → Unchanged file memories: auto-verified to new commit
   → Changed file memories: marked "needs_review"

3. User starts new session
   → Session hook shows: "⚠️ 2 memories need verification"
   → Context pack includes warnings

4. User runs `alex check`
   → Sees detailed list of what changed
   → Can verify, update, or retire each memory

5. User runs `alex verify <id>`
   → Memory updated to current commit
   → Back to "verified" status
```

### Benefits

1. **No noise during development** - Only commits trigger checks
2. **Clear checkpoints** - Commits are natural verification points
3. **Lazy checking** - Don't check until actually needed
4. **Auto-healing** - Post-commit hook auto-verifies unchanged files
5. **User control** - Can always run `alex check` manually

### Migration

For existing memories with `contentHash`:
1. Keep contentHash as fallback for repos without commits
2. Prefer `verifiedAtCommit` when available
3. On next verify, set `verifiedAtCommit` to current HEAD
