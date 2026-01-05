# Alexandria

Local-first memory system for coding agents with checkpoint-driven curation.

## Overview

Alexandria captures agent session events, extracts memories via checkpoint-driven curation, and retrieves relevant context across sessions using hybrid search (lexical + semantic).

### Key Features

- **Checkpoint-Driven Curation**: Events buffered and curated every 10 events (not noisy real-time extraction)
- **Tiered Extraction**:
  - Tier 0: Deterministic patterns (error→fix, user corrections)
  - Tier 1: Haiku-powered extraction (decisions, conventions, preferences)
- **Zero API Key Required**: Uses Claude Code's existing OAuth token for Haiku calls
- **Hybrid Search**: FTS5 (BM25) + vector similarity
- **Progressive Disclosure**: Context packs at minimal/task/deep levels
- **Code Awareness**: Link memories to files/symbols, detect staleness via git
- **Agent Integration**: Hooks for Claude Code and pi-coding-agent

## Installation

```bash
# Using bun (recommended)
bun add -g alexandria

# Using npm
npm install -g alexandria
```

## Quick Start

```bash
# Install agent integration
alex install claude-code   # or: alex install pi

# Now memories are captured automatically during coding sessions!
# Every 10 events, the agent is prompted to extract valuable learnings.

# Or add memories manually
alex add "Use jose for JWT validation" --type decision --approve

# Search memories
alex search "authentication"

# Generate context pack
alex pack --level task
```

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                    SESSION START                                 │
│  • alex session start                                           │
│  • alex pack → Inject memories into conversation                │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    DURING SESSION                                │
│  Event 1...10 → Buffer events (fire-and-forget)                 │
│                 ↓                                                │
│  AUTO-CHECKPOINT:                                                │
│    • Tier 0: Deterministic patterns (error→fix, corrections)    │
│    • Tier 1: Haiku extraction (decisions, conventions)          │
│    • Memories created as "pending" for review                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    SESSION END                                   │
│  • Final checkpoint                                              │
│  • alex session end                                              │
│  • Memories saved for next session                               │
└─────────────────────────────────────────────────────────────────┘
```

## Documentation

- **[Getting Started](docs/getting-started.md)** - Installation and basics
- **[CLI Reference](docs/cli-reference.md)** - Complete command reference
- **[Memory Types](docs/memory-types.md)** - When to use each type
- **[Integrations](docs/integrations.md)** - Claude Code, pi-coding-agent
- **[Best Practices](docs/best-practices.md)** - Tips for effective use

## Memory Types

| Type | Use For |
|------|---------|
| `decision` | Technical choices with rationale |
| `convention` | Coding standards, patterns |
| `constraint` | Hard rules (highest priority) |
| `known_fix` | Solutions to known problems |
| `failed_attempt` | What didn't work |
| `preference` | Style preferences |
| `environment` | Configs, versions |

## Agent Integration

```bash
# Claude Code
alex install claude-code

# pi-coding-agent  
alex install pi
```

Both integrations follow the same pattern:
- **Session Start**: Inject memories via context
- **During Session**: Buffer events (fire-and-forget)
- **Every 10 Events**: Auto-checkpoint with Tier 0 + Tier 1 (Haiku) extraction
- **Session End**: Final checkpoint

See [Integrations](docs/integrations.md) for details.

## Core Commands

```bash
# Session management
alex session start              # Start tracking
alex session end                # End session
alex checkpoint                 # Manual checkpoint

# Memory management
alex add "content" --type X     # Add memory
alex list                       # List memories
alex retire <id>                # Mark obsolete

# Search & retrieval
alex search "query"             # Hybrid search
alex pack --level task          # Context pack

# Code awareness
alex link <id> --file <path>    # Link to code
alex check                      # Find stale memories
alex verify <id>                # Mark as verified

# Review
alex review                     # Review pending
```

## Configuration

```bash
# Auto-checkpoint threshold (default: 10 events)
export ALEXANDRIA_AUTO_CHECKPOINT_THRESHOLD=10

# Recency boost tuning
export ALEXANDRIA_RECENCY_HALF_LIFE_DAYS=30
export ALEXANDRIA_RECENCY_MAX_BOOST=0.2

# Tokenizer path for accurate token counting (local files only)
export ALEXANDRIA_TOKENIZER_PATH="/path/to/tokenizer"
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Agent Integration (Claude Code, pi)            │
│  • Inject context at session start              │
│  • Buffer events (fire-and-forget)              │
│  • Checkpoint every 10 events                   │
└─────────────────────────────────────────────────┘
                        │
┌─────────────────────────────────────────────────┐
│  Checkpoint Curator                             │
│  • Tier 0: Deterministic patterns               │
│  • Agent-driven: alex add via prompt            │
└─────────────────────────────────────────────────┘
                        │
┌─────────────────────────────────────────────────┐
│  Retriever (Hybrid Search + Progressive Pack)   │
└─────────────────────────────────────────────────┘
                        │
┌───────────────────┬───────────────────┐
│  FTS5 Index       │  Vector Index     │
│  (BM25 lexical)   │  (embeddings)     │
└───────────────────┴───────────────────┘
                        │
┌─────────────────────────────────────────────────┐
│  SQLite Database                                │
└─────────────────────────────────────────────────┘
```

## Data Storage

```
~/.alexandria/
└── projects/
    └── <project-hash>/
        └── alexandria.db
```

## Development

```bash
git clone https://github.com/your-org/alexandria
cd alexandria
bun install
bun test
bun run check
```

## Contributing

See `CONTRIBUTING.md` for setup details and contribution guidelines.

## Release

Releases are published via GitHub Actions when a tag like `v0.1.0` is pushed.
Make sure `package.json` matches the tag and `NPM_TOKEN` is configured in the
repository secrets.

## License

MIT
