# Best Practices

Tips for getting the most out of Alexandria.

## Automatic Memory Extraction

Memories are automatically extracted at checkpoints via tiered curation:

1. **Tier 0 (Deterministic)** - Error→fix patterns, user corrections, repeated patterns
2. **Tier 1 (Haiku LLM)** - Decisions, conventions, preferences (runs in background)
3. **Manual** - Use `alex add` for things you want to explicitly remember

### Good Memory Examples

```bash
# Decision with rationale
alex add "Using Bun instead of Node for this project because it handles TypeScript natively and is faster" --type decision --approve

# Specific fix with context
alex add "When sharp fails to compile on Alpine, install vips-dev first" --type known_fix --approve

# Hard constraint
alex add "Never commit .env files - contains production secrets" --type constraint --approve

# Project convention
alex add "All API endpoints return { success: boolean, data?: T, error?: string }" --type convention --approve
```

### Skip These

- **Meta-commentary**: "I will try X", "Let me check..."
- **Generic knowledge**: "Use try/catch for errors"
- **Obvious patterns**: "Functions should have descriptive names"
- **Transient notes**: "TODO: fix this later"

## Memory Quality

### Be Specific

❌ Bad: "Handle errors properly"
✅ Good: "API errors return { error: { code, message } } with appropriate HTTP status"

❌ Bad: "Use the right database"
✅ Good: "Use PostgreSQL for production, SQLite for local dev and tests"

### Include Context

❌ Bad: "Don't use eval"
✅ Good: "Never use eval() - security risk, breaks CSP, and makes debugging harder"

### Link to Code

```bash
# After adding a memory, link it to relevant code
alex add "fetchUser() handles token refresh automatically" --type known_fix
alex link abc123 --file src/api/users.ts --symbol fetchUser
```

This enables staleness detection when the code changes.

## Checkpoint Flow

Alexandria uses checkpoint-driven curation:

### Tier 0 (Deterministic)
Every 10 events, deterministic patterns are extracted:
- Error → Fix patterns
- User corrections ("don't", "never", "must")
- Repeated patterns (3+ occurrences)

### Tier 1 (Haiku LLM)
If Claude OAuth is available (Claude Code) or API key is set:
- Haiku extracts decisions, conventions, preferences
- Background processing (doesn't slow down your session)
- Memories created as "pending" for review

### Manual
You can always add memories manually:
```bash
alex add "Important learning" --type decision --approve
```

## Review Workflow

### Check Pending Memories

```bash
# See pending count
alex review --list

# Interactive review
alex review
```

### Revalidation

When code changes, some memories may become stale:

```bash
# Check for stale memories
alex check

# Interactive revalidation
alex revalidate
```

## Confidence Tiers

Alexandria auto-calculates confidence based on evidence:

| Tier | Boost | Criteria |
|------|-------|----------|
| `grounded` | 2.0x | Has code refs + approved |
| `observed` | 1.5x | Has event evidence or approved |
| `inferred` | 1.0x | Pending review |
| `hypothesis` | 0.5x | No evidence or stale |

**To maximize confidence:**
1. Approve memories after verification
2. Link to relevant code
3. Keep code refs up to date

## Context Pack Levels

Choose the right level for your task:

### Minimal (~500 tokens)
```bash
alex pack --level minimal
```
- Just constraints
- Use for: Quick fixes, simple changes

### Task (~2000 tokens, default)
```bash
alex pack --level task
```
- Constraints + relevant memories
- Use for: Most development tasks

### Deep (~4000 tokens)
```bash
alex pack --level deep
```
- + Related memories + history
- Use for: Complex features, unfamiliar areas

Constraints are approved-only, deduped, and capped in task/deep packs to preserve room for relevant memories.

## Scoping

Use scopes to limit memory applicability:

```bash
# Global (entire project)
alex add "Use TypeScript strict mode" --type convention

# Module scope
alex add "Use snake_case in database layer" \
  --type convention --scope module --scope-path src/database

# File scope
alex add "This file has special formatting rules" \
  --type convention --scope file --scope-path src/legacy/parser.ts
```

## Configuration

```bash
# Auto-checkpoint threshold (default: 10 events)
export ALEXANDRIA_AUTO_CHECKPOINT_THRESHOLD=10

# More frequent checkpoints for shorter sessions
export ALEXANDRIA_AUTO_CHECKPOINT_THRESHOLD=5
```

## Maintenance

### Periodic Cleanup

```bash
# Find stale memories
alex list --status stale

# Retire obsolete ones
alex retire id1 id2 id3
```

### Database Location

```bash
# Show current database path
alex where

# View statistics
alex stats
```

### Export/Import

```bash
# Export for backup or sharing
alex export --file memories.json

# Import on another machine
alex export --import --file memories.json
```
