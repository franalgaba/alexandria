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

## Memory Extraction

Alexandria supports two extraction modes:

### Pattern-Based (Default)
- Analyzes events using regex patterns
- Fast, works offline
- Lower quality, may capture noise

### Intelligent Extraction (Recommended)
- Buffers events and analyzes context
- Detects patterns: error→fix, user corrections, architecture decisions
- Uses LLM for synthesis (optional)

Enable with environment variable:
```bash
export ALEXANDRIA_INTELLIGENT_EXTRACTION=true

# Optional: Configure LLM provider
export ANTHROPIC_API_KEY=sk-...   # Use Claude
export OPENAI_API_KEY=sk-...      # Use GPT-4
export OLLAMA_MODEL=llama3.2      # Use local Ollama (default)
```

## When to Add Memories

Add memories **explicitly** when:
- Making technical decisions with rationale (`alex add-decision`)
- Discovering hard constraints (`alex add --type constraint`)
- Finding fixes after troubleshooting (`alex add --type known_fix`)
- Documenting project conventions (`alex add --type convention`)

### What Makes a Good Memory

✅ **Good memories are:**
- Actionable - can be applied in future sessions
- Specific - includes context and reasoning
- Grounded - based on actual experience, not speculation

❌ **Avoid storing:**
- Casual conversation or meta-commentary
- Code fragments without context
- Generic/obvious statements
- Transient information (one-time fixes)

### Examples

```bash
# Good: Specific fix with context
alex add "When sharp fails to compile on Alpine, install vips-dev first" --type known_fix

# Good: Decision with rationale  
alex add "Using Bun instead of Node for this project because it handles TypeScript natively" --type decision

# Bad: Too vague
alex add "Use the right version" --type constraint

# Bad: Not actionable
alex add "The build failed" --type failed_attempt
```
