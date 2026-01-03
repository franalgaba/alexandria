# Git-Aware Staleness Detection

> "Your code changed. Does your AI still know what it's talking about?"

Here's a scenario that plays out constantly:

1. Three weeks ago, your agent learned: "Rate limiting is implemented in `src/middleware/rateLimit.ts` at line 42"
2. Last week, someone refactored the middleware
3. Today, your agent confidently references line 42
4. Line 42 is now an import statement

The memory was correct when created. The codebase evolved. The memory became a subtle source of errors.

This is the staleness problem, and it's one of the hardest challenges in coding agent memory.

## What Can Become Stale?

Code changes in many ways:

**File deleted.** The entire file is gone. Memory references a ghost.

**File renamed/moved.** The code exists but at a different path.

**Line content changed.** Same file, but line 42 now contains different code.

**Symbol renamed.** The function `createRateLimiter` is now `buildRateLimiter`.

**Logic refactored.** The symbol exists, but the behavior described in the memory no longer applies.

**Semantic drift.** The code looks similar but does something subtly different.

Each type requires different detection strategies.

## Code References as Anchors

The foundation of staleness detection is precise code references:

```typescript
interface CodeReference {
  type: 'file' | 'symbol' | 'line_range';
  path: string;              // Relative to project root
  symbol?: string;           // Function, class, or variable name
  lineRange?: [number, number];
  verifiedAtCommit?: string; // Git commit when verified
  contentHash?: string;      // Hash of referenced content
}
```

When creating a memory, we attach references to the specific code it describes:

```typescript
const memory = {
  content: "Rate limiting uses a sliding window algorithm",
  codeRefs: [
    {
      type: 'symbol',
      path: 'src/middleware/rateLimit.ts',
      symbol: 'createRateLimiter',
      verifiedAtCommit: 'abc123',
      contentHash: 'sha256:def456...'
    }
  ]
};
```

These references are verifiable. We can check: Does this file exist? Has the content changed? Is the symbol still there?

## The Detection Algorithm

Staleness detection runs when you ask for it (`alex check`) or on session start:

```typescript
async function checkStaleness(memory: Memory): Promise<StalenessResult> {
  const results: RefCheck[] = [];

  for (const ref of memory.codeRefs) {
    const check = await checkReference(ref);
    results.push(check);
  }

  // If any reference is stale, the memory might be stale
  const staleRefs = results.filter(r => r.status !== 'valid');

  if (staleRefs.length === 0) {
    return { status: 'valid' };
  }

  return {
    status: 'potentially_stale',
    staleRefs,
    suggestion: generateSuggestion(staleRefs)
  };
}
```

For each reference type, different checks apply:

### File References

```typescript
async function checkFileRef(ref: CodeReference): Promise<RefCheck> {
  // Does the file exist?
  if (!await fileExists(ref.path)) {
    // Try to find a renamed/moved file with similar content
    const similar = await findSimilarFile(ref.contentHash);
    if (similar) {
      return {
        status: 'moved',
        oldPath: ref.path,
        newPath: similar.path,
        confidence: similar.confidence
      };
    }
    return { status: 'deleted' };
  }

  // Has the content changed?
  const currentHash = await hashFile(ref.path);
  if (currentHash !== ref.contentHash) {
    return { status: 'modified', diff: await getDiff(ref) };
  }

  return { status: 'valid' };
}
```

### Symbol References

```typescript
async function checkSymbolRef(ref: CodeReference): Promise<RefCheck> {
  // Does the file exist?
  if (!await fileExists(ref.path)) {
    return { status: 'file_deleted' };
  }

  // Find the symbol in the current file
  const symbols = await extractSymbols(ref.path);
  const match = symbols.find(s => s.name === ref.symbol);

  if (!match) {
    // Symbol might be renamed - look for similar
    const similar = findSimilarSymbol(symbols, ref.symbol);
    if (similar) {
      return {
        status: 'renamed',
        oldName: ref.symbol,
        newName: similar.name,
        confidence: similar.confidence
      };
    }
    return { status: 'symbol_removed' };
  }

  // Symbol exists - check if content changed
  const currentHash = hashSymbolContent(match);
  if (currentHash !== ref.contentHash) {
    return { status: 'modified', changes: describeChanges(ref, match) };
  }

  return { status: 'valid' };
}
```

### Line Range References

```typescript
async function checkLineRangeRef(ref: CodeReference): Promise<RefCheck> {
  if (!await fileExists(ref.path)) {
    return { status: 'file_deleted' };
  }

  // Get current content at the line range
  const currentLines = await readLines(ref.path, ref.lineRange);
  const currentHash = hashContent(currentLines.join('\n'));

  if (currentHash !== ref.contentHash) {
    // Content changed - try to find where it moved
    const originalContent = await getContentAtCommit(
      ref.path,
      ref.verifiedAtCommit,
      ref.lineRange
    );

    const newLocation = await findContent(ref.path, originalContent);
    if (newLocation) {
      return {
        status: 'moved',
        oldRange: ref.lineRange,
        newRange: newLocation,
        confidence: 'high'
      };
    }

    return { status: 'modified' };
  }

  return { status: 'valid' };
}
```

## Git Integration

For projects using git (most of them), we can leverage git history:

### Tracking Commits

When a memory is created or verified, we record the current commit:

```typescript
async function recordVerification(memory: Memory): Promise<void> {
  const currentCommit = await git.getCurrentCommit();

  for (const ref of memory.codeRefs) {
    ref.verifiedAtCommit = currentCommit;
    ref.contentHash = await hashRefContent(ref);
  }

  memory.lastVerifiedAt = new Date();
}
```

### Detecting Changes

On session start, we check if referenced files have changed since verification:

```typescript
async function getChangedFiles(since: string): Promise<string[]> {
  const result = await exec(`git diff --name-only ${since}..HEAD`);
  return result.split('\n').filter(Boolean);
}

async function checkMemoriesAgainstGit(): Promise<StaleMemory[]> {
  const memories = await getActiveMemories();
  const stale: StaleMemory[] = [];

  for (const memory of memories) {
    for (const ref of memory.codeRefs) {
      if (!ref.verifiedAtCommit) continue;

      const changedFiles = await getChangedFiles(ref.verifiedAtCommit);
      if (changedFiles.includes(ref.path)) {
        stale.push({
          memory,
          ref,
          reason: 'file_changed_since_verification'
        });
      }
    }
  }

  return stale;
}
```

### Handling Branches

Branch divergence complicates staleness:

```
      main: A --- B --- C
             \
    feature:  D --- E --- F (memory created here)

    Question: Is the memory valid on main?
```

We track the branch context and warn when applying memories across branches:

```typescript
async function checkBranchContext(memory: Memory): Promise<BranchCheck> {
  const createdOnBranch = memory.metadata?.branch;
  const currentBranch = await git.getCurrentBranch();

  if (createdOnBranch && createdOnBranch !== currentBranch) {
    // Check if the branches have diverged
    const diverged = await git.haveDiverged(createdOnBranch, currentBranch);
    if (diverged) {
      return {
        status: 'branch_diverged',
        warning: `Memory created on ${createdOnBranch}, current branch is ${currentBranch}`
      };
    }
  }

  return { status: 'ok' };
}
```

## The Review Workflow

Staleness detection creates work—someone needs to decide what to do with stale memories. We provide several options:

### Automatic Marking

```bash
$ alex check
Checking 47 memories against current code...

⚠️  3 memories reference changed code:

1. [known_fix] "Sharp compilation: install vips-dev first"
   File: docker/Dockerfile (modified at line 23)
   Action: [v]erify [s]upersede [r]etire [i]gnore

2. [decision] "Use bcrypt for password hashing"
   Symbol: src/auth/password.ts:hashPassword (renamed to hash)
   Action: [v]erify [s]upersede [r]etire [i]gnore

3. [convention] "API responses use camelCase"
   File: src/api/response.ts (deleted)
   Action: [v]erify [s]upersede [r]etire [i]gnore
```

### Response Options

**Verify:** The memory is still accurate despite code changes. Update the code references to current state.

```bash
> v
✓ Updated code reference to current commit
  Symbol: hashPassword → hash (auto-updated)
  Memory remains active
```

**Supersede:** The memory is outdated. Create a new memory that replaces it.

```bash
> s
Enter new memory content:
> "Use argon2 for password hashing (migrated from bcrypt in v2.0)"
✓ Created new memory, marked old as superseded
```

**Retire:** The memory is no longer relevant. Archive it.

```bash
> r
✓ Memory retired (removed from active retrieval)
```

**Ignore:** Skip for now, check again later.

```bash
> i
✓ Skipped (will check again next session)
```

## Surfacing Staleness to the Agent

When the agent retrieves memories, stale ones come with warnings:

```typescript
async function retrieveWithStalenessCheck(
  query: string
): Promise<AnnotatedMemory[]> {
  const memories = await search(query);

  return Promise.all(memories.map(async memory => {
    const staleness = await checkStaleness(memory);

    return {
      ...memory,
      staleness: staleness.status,
      warning: staleness.status !== 'valid'
        ? `⚠️ References code that has changed since ${memory.lastVerifiedAt}`
        : null
    };
  }));
}
```

The agent sees:

```markdown
## Relevant Memories

- [decision] Use SQLite for local-first storage
  ✓ Verified 2 days ago

- [known_fix] Sharp compilation: install vips-dev first
  ⚠️ References Dockerfile which has changed. Verify before applying.

- [convention] API responses use camelCase
  ⚠️ Referenced file deleted. May be outdated.
```

The agent can then decide whether to apply the memory directly, verify first, or skip it.

## Performance Considerations

Staleness detection can be expensive:

- File system access for each reference
- Git operations for commit comparison
- Symbol extraction for symbol references

We optimize with:

### Caching

```typescript
const fileHashCache = new Map<string, { hash: string; mtime: number }>();

async function hashFile(path: string): Promise<string> {
  const stat = await fs.stat(path);
  const cached = fileHashCache.get(path);

  if (cached && cached.mtime === stat.mtimeMs) {
    return cached.hash;
  }

  const content = await fs.readFile(path);
  const hash = crypto.createHash('sha256').update(content).digest('hex');

  fileHashCache.set(path, { hash, mtime: stat.mtimeMs });
  return hash;
}
```

### Batch Processing

Instead of checking each memory individually, we group by file:

```typescript
async function batchCheck(memories: Memory[]): Promise<CheckResult[]> {
  // Group memories by referenced file
  const byFile = groupBy(memories, m => m.codeRefs[0]?.path);

  // Check each file once
  const fileStatuses = await Promise.all(
    Object.entries(byFile).map(async ([path, mems]) => {
      const status = await checkFile(path);
      return { path, status, memories: mems };
    })
  );

  // Apply file status to memories
  return flatMap(fileStatuses, ({ status, memories }) =>
    memories.map(m => ({ memory: m, status }))
  );
}
```

### Incremental Checks

We track the last check time and only re-check after changes:

```typescript
async function shouldRecheck(memory: Memory): Promise<boolean> {
  if (!memory.lastCheckedAt) return true;

  // Check if any referenced files changed since last check
  for (const ref of memory.codeRefs) {
    const mtime = await getFileMtime(ref.path);
    if (mtime > memory.lastCheckedAt) return true;
  }

  return false;
}
```

## Current Limitations

Staleness detection isn't perfect:

**Semantic changes aren't detected.** If someone changes the algorithm inside a function without changing its signature, we might not catch it. The symbol exists, the content hash changed, but we can't know if the memory's claim is still true.

**Refactoring across files.** If code moves from one file to another, we can sometimes track it through content hashing, but it's not reliable.

**Logic that spans multiple files.** A memory about "how authentication works" might reference one file, but authentication spans many files. Changes to unreferenced files can invalidate the memory.

**Performance overhead.** Deep staleness checking is slow. We balance thoroughness with speed.

These are hard problems. We're iterating on solutions.

## Best Practices

For memory authors:

**Include symbol references when possible.** Symbols are more stable than line numbers. `createRateLimiter` survives refactoring better than "line 42".

**Reference the most stable anchor.** A function name is more stable than a line range. A file is more stable than a line.

**Be specific about scope.** "Rate limiting uses sliding window" is easier to verify than "the middleware is complex".

**Update proactively.** If you refactor code, run `alex check` and update affected memories.

For system integrators:

**Run checks on session start.** Catch staleness before the agent uses outdated memories.

**Surface warnings, don't block.** Let the agent decide whether to use a potentially stale memory.

**Make verification easy.** One-command updates encourage maintenance.

---

Staleness detection is what separates memory from hallucination. A memory system that can't tell you if its knowledge is still accurate is just making things up with extra steps.

The implementation lives in `src/reviewer/staleness.ts`. The git integration is in `src/code/git.ts`. Symbol extraction uses `src/code/symbols.ts`.

*Your code changed. Your AI should know.*
