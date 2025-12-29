# Getting Started with Alexandria

Alexandria is a local-first memory system for coding agents. It automatically captures agent traces, extracts memories, and retrieves relevant context across sessions.

## Installation

### Via npm/bun (recommended)

```bash
# Using bun
bun add -g alexandria

# Using npm
npm install -g alexandria
```

### From Source

```bash
git clone https://github.com/your-org/alexandria
cd alexandria
bun install
bun link
```

## Quick Start

### 1. Install Agent Integration

Alexandria works best when integrated with your coding agent:

```bash
# For Claude Code
alex install claude-code

# For pi-coding-agent
alex install pi

# Or install all
alex install all
```

This enables **automatic memory capture** from your coding sessions.

### 2. Real-time Memory Extraction

When integrated, Alexandria captures **everything in real-time**:

1. **User prompts** - What you ask
2. **Assistant responses** - Agent's reasoning
3. **Tool calls** - Commands and edits
4. **Tool results** - Output and errors

As each event is captured, memories are **extracted immediately** using pattern matching. No waiting until session end - knowledge is captured the moment it happens.

Check pending memories anytime:

```bash
alex review --list    # See pending count
alex review           # Interactive review
```

### 3. Manual Memory Addition

You can also add memories manually:

```bash
# Quick add
alex add "Use jose for JWT validation" --type decision --approve

# Structured decision
alex add-decision "Use SQLite for storage" \
  --rationale "Simple deployment, good enough for scale" \
  --alternatives "PostgreSQL, JSON files"
```

### 4. Search & Retrieve

```bash
# Hybrid search (lexical + semantic)
alex search "error handling"

# Smart search with intent detection
alex search "how do we handle errors" --smart
```

### 5. Generate Context Pack

Get relevant memories for your current task:

```bash
# Auto-detect task from recent git activity
alex pack --auto

# Specify task explicitly
alex pack --task "Add authentication"

# Different detail levels
alex pack --level minimal   # ~200 tokens, constraints only
alex pack --level task      # ~500 tokens, + relevant memories
alex pack --level deep      # ~1500 tokens, + history
```

## Core Concepts

### How Automatic Extraction Works

Alexandria's extractor looks for patterns in agent tool outputs:

| Pattern | Extracted As |
|---------|--------------|
| "error", "failed", "doesn't work" | `failed_attempt` |
| "chose", "decided", "using X instead of Y" | `decision` |
| "must", "always", "never", "required" | `constraint` |
| "fixed by", "solution:", "workaround:" | `known_fix` |
| "convention", "pattern", "we use" | `convention` |

Extracted memories are queued as **pending** for your review.

### Memory Types

| Type | Use For |
|------|---------|
| `decision` | Technical choices with rationale |
| `convention` | Coding standards, naming rules |
| `constraint` | Things that must always/never happen |
| `known_fix` | Solutions to known problems |
| `failed_attempt` | What didn't work (avoid repeating) |
| `preference` | User preferences |
| `environment` | Configs, versions, paths |

### Memory Lifecycle

1. **Capture** - Auto-extracted from agent sessions (or manually added)
2. **Review** - Approve, edit, or reject pending memories
3. **Link** - Connect to code files/symbols for staleness tracking
4. **Verify** - Reconfirm after code changes
5. **Retire** - Mark as no longer applicable

### Code Awareness

Link memories to specific files or symbols:

```bash
# Link to file
alex link abc123 --file src/api.ts

# Link to specific symbol
alex link abc123 --file src/api.ts --symbol fetchUser
```

When linked files change (detected via git commits), Alexandria flags the memory for revalidation.

## Next Steps

- [CLI Reference](./cli-reference.md) - Full command documentation
- [Memory Types](./memory-types.md) - When to use each type
- [Integrations](./integrations.md) - Agent integration details
- [Best Practices](./best-practices.md) - Tips for effective use
