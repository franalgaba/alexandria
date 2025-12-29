# Alexandria

Local-first memory system for coding agents with hybrid retrieval.

## Overview

Alexandria captures agent traces, distills them into curated "memory objects," and retrieves relevant context across sessions using hybrid search (lexical + semantic).

### Key Features

- **Hybrid Search**: FTS5 (BM25) + vector similarity
- **Memory Types**: Decisions, conventions, constraints, fixes, and more
- **Code Awareness**: Link memories to files/symbols, detect staleness via git
- **Agent Integration**: Plugins for Claude Code and pi-coding-agent
- **Token Budgeting**: Context packs stay within limits
- **Review Pipeline**: Approve, verify, retire memories over time

## Installation

```bash
# Using bun (recommended)
bun add -g alexandria

# Using npm
npm install -g alexandria
```

## Quick Start

```bash
# Add a memory
alex add "Use jose for JWT validation" --type decision --approve

# Search memories
alex search "authentication"

# Generate context pack
alex pack --task "Add login feature"

# Install agent integration
alex install claude-code   # or: alex install pi
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

# All integrations
alex install all
```

See [Integrations](docs/integrations.md) for details.

## Core Commands

```bash
# Memory management
alex add "content" --type <type>    # Add memory
alex list                           # List memories
alex show <id>                      # Show details
alex retire <id>                    # Mark obsolete

# Search & retrieval
alex search "query"                 # Hybrid search
alex search "query" --smart         # Intent-aware
alex pack --task "description"      # Context pack

# Code awareness
alex link <id> --file <path>        # Link to code
alex check                          # Find stale memories
alex verify <id>                    # Mark as verified

# Review
alex review                         # Review pending
alex revalidate                     # Review stale
alex conflicts                      # Find contradictions
```

## Library Usage

```typescript
import { getConnection, MemoryObjectStore, Retriever } from 'alexandria';

const db = getConnection();
const store = new MemoryObjectStore(db);
const retriever = new Retriever(db);

// Search
const results = await retriever.search('authentication');

// Add memory
store.create({
  content: 'Use jose for JWT validation',
  objectType: 'decision',
});
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Agent Integration (Claude Code, pi, git hooks) │
└─────────────────────────────────────────────────┘
                        │
┌─────────────────────────────────────────────────┐
│  CLI (alex) / Library API                       │
└─────────────────────────────────────────────────┘
                        │
┌─────────────────────────────────────────────────┐
│  Retriever (Hybrid Search + Rerank + Router)    │
└─────────────────────────────────────────────────┘
                        │
┌───────────────────┬───────────────────┐
│  FTS5 Index       │  Vector Index     │
│  (BM25 lexical)   │  (embeddings)     │
└───────────────────┴───────────────────┘
                        │
┌─────────────────────────────────────────────────┐
│  SQLite Database (memory objects, code refs)    │
└─────────────────────────────────────────────────┘
```

## Data Storage

```
~/.alexandria/
└── projects/
    └── <project-hash>/
        └── alexandria.db    # SQLite (FTS5 + vectors)
```

Each project gets its own database, identified by git remote or directory path.

## Development

```bash
git clone https://github.com/your-org/alexandria
cd alexandria
bun install
bun test        # 173 tests
bun run check   # Lint
```

## License

MIT
