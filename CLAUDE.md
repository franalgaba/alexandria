# Alexandria

This is the Alexandria codebase - a local-first memory system for coding agents with checkpoint-driven curation.

## Quick Reference

```bash
# Session management
alex session start          # Start tracking
alex checkpoint             # Manual checkpoint
alex session end            # End session

# Memory management
alex add "content" --type decision --approve
alex search "query"
alex pack --level task
alex list
alex check                  # Find stale memories

# Install integrations
alex install claude-code
alex install pi
```

## Project Structure

```
src/
├── cli/commands/     # CLI command implementations
├── code/             # Git integration, symbol extraction
├── indexes/          # FTS5 and vector indexes
├── ingestor/         # Event ingestion, checkpoint, curators
├── retriever/        # Search, context packs, intent routing
├── reviewer/         # Review pipeline, staleness
├── stores/           # SQLite stores
├── types/            # TypeScript types
└── utils/            # Utilities

integrations/
├── claude-code/      # Claude Code plugin (hooks + skill)
└── pi/               # pi-coding-agent hooks

test/                 # Test files
docs/                 # User documentation
docs/dev/             # Development documentation
```

## Memory Types

- `decision` - Technical choices with rationale
- `convention` - Coding standards
- `constraint` - Hard rules (highest priority)
- `known_fix` - Solutions that worked
- `failed_attempt` - What didn't work
- `preference` - Style preferences
- `environment` - Configs, versions

## Memory Extraction

Alexandria uses **checkpoint-driven curation** with tiered extraction:

### How It Works

1. **Events buffered** during session (fire-and-forget via hooks)
2. **Every 10 events**, auto-checkpoint triggers tiered extraction:
   - **Tier 0** (deterministic): error→fix patterns, user corrections, repeated patterns
   - **Tier 1** (Haiku): decisions, conventions, preferences (if Claude OAuth available)
3. **Session end**: Final checkpoint

### Automatic Haiku Extraction

When running in Claude Code, Alexandria automatically uses the existing OAuth token to call Haiku for intelligent extraction - **no separate API key needed!**

Haiku extracts:
- Decisions with rationale
- Coding conventions
- Preferences and patterns
- Known fixes

Memories are created as "pending" for review via `alex list` or `alex review`.

## When to Add Memories

Add memories when:
- Making technical decisions with rationale
- Discovering hard constraints
- Finding fixes after troubleshooting
- Documenting project conventions

### What Makes a Good Memory

✅ **Good memories are:**
- Actionable - can be applied in future sessions
- Specific - includes context and reasoning
- Grounded - based on actual experience

❌ **Skip:**
- Meta-commentary ("I will try X")
- Generic/obvious statements
- Transient/one-time things

### Examples

```bash
# Good: Specific fix with context
alex add "When sharp fails to compile on Alpine, install vips-dev first" --type known_fix --approve

# Good: Decision with rationale  
alex add "Using Bun instead of Node because it handles TypeScript natively" --type decision --approve

# Good: Hard constraint
alex add "Never commit .env files - contains production secrets" --type constraint --approve
```

## Configuration

```bash
# Auto-checkpoint threshold (default: 10 events)
export ALEXANDRIA_AUTO_CHECKPOINT_THRESHOLD=10
```
