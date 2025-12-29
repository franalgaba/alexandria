---
name: alexandria
description: Persistent memory system. ALWAYS run `alex pack` at the start of EVERY conversation to load context. Store failures, decisions, and fixes.
---

# Alexandria Memory System

You have access to a persistent memory system with hybrid search (lexical + semantic).

## 🚨 CRITICAL: Start Every Session

**At the START of every conversation**, run this to load context:

```bash
alex pack --format text
```

This gives you:
- Previous session context
- Active constraints (MUST follow)
- Relevant memories for the current task

## When to Search Memory

BEFORE attempting anything that might have issues:

```bash
alex search "sharp alpine"      # Before using sharp
alex search "docker build"      # Before Docker work
alex search "authentication"    # Before auth work
```

## When to Store Memory

### After a Failure
```bash
alex add "sharp 0.33.5 throws SIGSEGV on Alpine Linux in Docker" \
    --type failed_attempt --approve
```

### After Finding a Fix
```bash
alex add "Use vips-dev package instead of sharp for Alpine" \
    --type known_fix --approve
```

### After Making a Decision
```bash
alex add "Using Clerk for authentication instead of Auth0 - better DX" \
    --type decision --approve
```

### For Constraints (Must Follow)
```bash
alex add "Never use any type in TypeScript files" \
    --type constraint --approve
```

## Memory Types Quick Reference

| Type | Use For |
|------|---------|
| `failed_attempt` | Errors, crashes, things that didn't work |
| `known_fix` | Solutions that worked |
| `decision` | Choices with rationale |
| `constraint` | Rules that must never be broken |
| `convention` | Patterns to follow |
| `preference` | Style preferences |
| `environment` | Versions, configs, paths |

## Commands

```bash
alex pack                    # Get context (DO THIS FIRST!)
alex search "query"          # Search memories
alex add "..." --type X      # Store memory
alex list                    # List all memories
alex where                   # Show database location
alex init                    # Initialize project-local database
```

## Project Isolation

Each project can have its own database:

```bash
alex init                    # Creates .alexandria/ in project
alex where                   # Shows which database is active
```

## Example Session Flow

```bash
# 1. START: Load context
alex pack --format text

# 2. SEARCH: Before risky operations
alex search "image processing"

# 3. WORK: Do the task...

# 4. STORE: If something fails
alex add "ImageMagick convert fails on HEIC files" --type failed_attempt --approve

# 5. STORE: When you find a fix
alex add "Use libheif for HEIC conversion" --type known_fix --approve
```
