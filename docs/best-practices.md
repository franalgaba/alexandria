# Best Practices

Tips for getting the most out of Alexandria.

## When to Add Memories

### Do Add Memories For:

**Decisions with rationale**
```bash
alex add-decision "Use SQLite instead of PostgreSQL" \
  --rationale "Single-file deployment, good enough for our scale"
```

**Non-obvious constraints**
```bash
alex add "File uploads must not exceed 10MB - Lambda limit" \
  --type constraint --approve
```

**Solutions to tricky bugs**
```bash
alex add "CORS error fix: add credentials: 'include' to fetch options" \
  --type known_fix
```

**Failed approaches** (so you don't repeat them)
```bash
alex add "Web Workers can't use canvas API - PDF generation must stay in main thread" \
  --type failed_attempt
```

**Project-specific conventions**
```bash
alex add "All API handlers go in src/handlers/, one file per resource" \
  --type convention
```

### Don't Add Memories For:

- **Generic programming knowledge** - "Use try/catch for error handling"
- **Obvious patterns** - "Functions should have descriptive names"  
- **Temporary notes** - "TODO: fix this later"
- **Duplicate information** - Check if it already exists first

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

## Review Workflow

### Regular Review

Run `alex review` periodically to process pending memories:

```bash
# Interactive review
alex review

# Quick list of pending
alex review --list
```

### Revalidation

When code changes, some memories may become stale:

```bash
# Check for stale memories
alex check

# Interactive revalidation
alex revalidate
```

### Conflict Detection

Find memories that might contradict each other:

```bash
alex conflicts
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

### Minimal (~200 tokens)
```bash
alex pack --level minimal
```
- Just constraints
- Use for: Quick fixes, simple changes

### Task (~500 tokens, default)
```bash
alex pack --level task
```
- Constraints + query-relevant memories
- Use for: Most development tasks

### Deep (~1500 tokens)
```bash
alex pack --level deep
```
- + Related memories + history
- Use for: Complex features, unfamiliar areas

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

## Integration Tips

### Claude Code

The SessionStart hook automatically prompts for stale memory review. You can respond naturally:

> "Yes, let's review them"
> "Skip for now, I'll do it later"
> "The first one is still valid, retire the second"

### Git Workflow

Install git hooks to get notified after commits:

```bash
alex hooks install
```

After each commit, you'll see:
```
[Alexandria] ⚠️  Some memories may need attention:
  • 2 memory(s) reference changed files
  Run 'alex check' for details
```

### Team Usage

Export memories for sharing:
```bash
alex export --file team-memories.json
```

Import on another machine:
```bash
alex export --import --file team-memories.json
```

## Maintenance

### Periodic Cleanup

```bash
# Find stale memories
alex list --status stale

# Retire obsolete ones
alex retire id1 id2 id3

# Check for conflicts
alex conflicts
```

### Database Location

Alexandria stores data in `~/.alexandria/projects/<project-hash>/`:

```bash
# Show current database path
alex where

# View statistics
alex stats
```
