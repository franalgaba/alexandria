# Phase F: Advanced Features

## Overview

Advanced features for code awareness:

1. ~~**A5: File Watcher**~~ - SKIPPED (commit-based staleness is better)
2. **B3: Inline Revalidation Prompts** - Show prompts in context pack ✅
3. **Symbol-level AST Parsing** - Regex-based symbol extraction ✅

## F1. File Watcher - SKIPPED

**Decision:** Use commit-based staleness instead of file watching.

Reasons:
- File saves during development cause constant false positives
- Commits are natural checkpoints for validation
- Already implemented via `alex check` and post-commit hooks

See `docs/staleness-strategy.md` for full rationale.

## F2. Inline Revalidation Prompts ✅

### Purpose
When retrieving memories, show which ones need revalidation.

### Implementation

```typescript
// src/utils/revalidation.ts
interface RevalidationPrompt {
  memory: MemoryObject;
  reasons: string[];
  suggestedAction: 'verify' | 'update' | 'retire';
  priority: number;
}

function generatePrompts(memories, stalenessResults): RevalidationPrompt[];
```

### Context Pack Output

```
=== Alexandria Context Pack ===

⚠️  NEEDS REVALIDATION:

  🗑️ "Old API function"
     Reason: File deleted: src/api.ts
     Action: alex retire mjr123

  🔍 "Use fetchUser() for calls"  
     Reason: File changed since verification
     Action: alex verify mjr456

🚫 Constraints:
   ...
```

### Interactive Review Command

```bash
alex revalidate
```

Shows each stale memory with interactive options:
```
[1/3]

🎯 [decision] Test memory content

⚠️  Reasons:
   • File deleted: src/api.ts

🗑️ Suggested: retire

Options:
  [v] verify  - mark as still valid
  [r] retire  - remove from active use
  [s] skip    - review later
  [q] quit    - exit review

Choice: _
```

## F3. Symbol-level AST Parsing

### Purpose
Extract symbols (functions, classes, variables) from code for precise code references.

### Implementation

```typescript
// src/code/symbols.ts
interface Symbol {
  name: string;
  kind: 'function' | 'class' | 'variable' | 'interface' | 'type';
  path: string;
  line: number;
  endLine: number;
}

class SymbolExtractor {
  extract(filePath: string): Symbol[];
  findSymbol(filePath: string, symbolName: string): Symbol | null;
}
```

### Supported Languages (via tree-sitter)
- TypeScript/JavaScript
- Python
- Rust
- Go

### CLI Enhancement

```bash
# Link to specific symbol
alex link <id> --file src/api.ts --symbol fetchUser

# Show with symbol info
alex show <id>
# Code References:
#   🔧 src/api.ts:fetchUser (line 42-58)
```

## Implementation Order

### Step 1: File Watcher - SKIPPED
- Commit-based staleness is better approach

### Step 2: Revalidation Prompts (30 min) ✅ COMPLETE
- [x] Create `src/utils/revalidation.ts`
- [x] Update context pack format
- [x] Show prompts at top of pack output
- [x] Suggest actions (verify/update/retire)
- [x] Add `alex revalidate` interactive CLI command
- [x] Create Claude Code plugin (`integrations/claude-code/`)
- [x] Create pi-coding-agent hooks (`integrations/pi/hooks/`)

### Step 3: Symbol Extraction (60 min) ✅ COMPLETE
- [x] Create `src/code/symbols.ts` with regex-based extraction
- [x] Support TypeScript/JavaScript and Python
- [x] Add `alex symbols` command
- [x] Update `alex link` to verify symbols exist
- [x] Extract functions, classes, interfaces, types

### Step 4: Tests (30 min) ✅ COMPLETE
- [x] Symbol extraction tests (10 tests)
- [x] Revalidation prompt tests (7 tests)
