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

## 📚 Session End: Extract Memories

**Before ending a session**, review what was learned and store valuable memories:

1. **Decisions made**: What technical choices were made and why?
2. **Fixes discovered**: What problems were solved and how?
3. **Constraints learned**: What should always/never be done?
4. **Conventions used**: What patterns or standards were followed?

For each memory worth keeping:
```bash
alex add "<memory content>" --type <decision|known_fix|constraint|convention> --approve
```

**Good memories are:**
- Actionable - can be applied in future sessions
- Specific - includes context and reasoning
- Grounded - based on actual experience

**Skip:**
- Trivial or one-time things
- Meta-commentary ("I will try X")
- Generic/obvious statements

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
alex check                   # Find stale memories
alex review                  # Review pending memories
alex checkpoint              # Curate buffered events into memories
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

# 6. END: Review session for valuable learnings
# What decisions were made? What patterns emerged?
```
