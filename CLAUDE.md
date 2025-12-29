# Alexandria

This is the Alexandria codebase - a local-first memory system for coding agents.

## Quick Reference

```bash
# Search memories
alex search "query"

# Add memory
alex add "content" --type decision --approve

# Context pack
alex pack --level minimal|task|deep

# Check stale memories
alex check

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
├── ingestor/         # Event ingestion
├── retriever/        # Search, context packs, intent routing
├── reviewer/         # Review pipeline, staleness
├── stores/           # SQLite stores
├── types/            # TypeScript types
└── utils/            # Utilities

integrations/
├── claude-code/      # Claude Code plugin
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

## When to Add Memories

Add memories when making:
- Technical decisions (use `alex add-decision`)
- Discovering constraints (`alex add --type constraint`)
- Finding fixes (`alex add --type known_fix`)
- Documenting conventions (`alex add --type convention`)
