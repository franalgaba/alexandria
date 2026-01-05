# Getting Started with Alexandria

Alexandria is a local-first memory system for coding agents. It captures session events, extracts memories via checkpoint-driven curation, and retrieves relevant context across sessions.

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
```

This enables **automatic memory capture** from your coding sessions.

### 2. How It Works

When integrated, Alexandria:

1. **Injects memories at session start** - Relevant context loaded automatically
2. **Captures events during session** - Tool calls, results, responses (fire-and-forget)
3. **Auto-checkpoints every 10 events** - Triggers memory extraction
4. **Agent-driven extraction** - The coding agent itself reviews and extracts memories

```
Session Start → Memories Injected
     ↓
Event 1...10 → Auto-Checkpoint → Agent extracts memories
     ↓
Event 11...20 → Auto-Checkpoint → Agent extracts memories
     ↓
Session End → Final checkpoint
```

### 3. Memory Extraction

Memories are extracted via tiered curation:

**Tier 0 (Deterministic):**
- Error → Fix patterns detected automatically
- User corrections ("don't", "never", "must always")
- Repeated patterns (3+ occurrences)

**Tier 1 (Haiku LLM):**
- Background extraction using Claude Haiku
- Extracts decisions, conventions, preferences
- Uses Claude Code's OAuth token (no separate API key needed!)
- Memories created as "pending" for review

### 4. Manual Memory Addition

You can also add memories manually:

```bash
# Quick add
alex add "Use jose for JWT validation" --type decision --approve

# Structured decision
alex add-decision "Use SQLite for storage" \
  --rationale "Simple deployment, good enough for scale" \
  --alternatives "PostgreSQL, JSON files"
```

### 5. Search & Retrieve

```bash
# Hybrid search (lexical + semantic)
alex search "error handling"

# Smart search with intent detection
alex search "how do we handle errors" --smart
```

### 6. Generate Context Pack

Get relevant memories for your current task:

```bash
# Default task level (~500 tokens)
alex pack

# Different detail levels
alex pack --level minimal   # ~500 tokens, constraints only
alex pack --level task      # ~2000 tokens, + relevant memories
alex pack --level deep      # ~4000 tokens, + history
```

## Core Concepts

### Checkpoint-Driven Curation

Unlike real-time extraction (which captures noise), Alexandria uses **checkpoint-driven curation**:

1. Events are buffered during the session
2. Every 10 events, a checkpoint triggers
3. **Tier 0**: Deterministic patterns extracted automatically
4. **Tier 1**: Haiku extracts decisions, conventions, preferences (if OAuth available)
5. Memories created as "pending" for review

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

1. **Capture** - Extracted at checkpoints or manually added
2. **Review** - Approve, edit, or reject pending memories
3. **Link** - Connect to code files/symbols for staleness tracking
4. **Verify** - Reconfirm after code changes
5. **Retire** - Mark as no longer applicable

### Progressive Disclosure

Context packs use progressive disclosure to minimize token usage:

| Level | Tokens | Contents |
|-------|--------|----------|
| `minimal` | ~500 | Constraints only |
| `task` | ~2000 | + Relevant decisions, conventions, fixes |
| `deep` | ~4000 | + Full history and evidence |

Task/deep packs dedupe constraints and only include approved constraints, capped to leave room for relevant memories.

### Code Awareness

Link memories to specific files or symbols:

```bash
# Link to file
alex link abc123 --file src/api.ts

# Link to specific symbol
alex link abc123 --file src/api.ts --symbol fetchUser
```

When linked files change (detected via git commits), Alexandria flags the memory for revalidation.

## Configuration

```bash
# Auto-checkpoint threshold (default: 10 events)
export ALEXANDRIA_AUTO_CHECKPOINT_THRESHOLD=10
```

## Next Steps

- [CLI Reference](./cli-reference.md) - Full command documentation
- [Memory Types](./memory-types.md) - When to use each type
- [Integrations](./integrations.md) - Agent integration details
- [Best Practices](./best-practices.md) - Tips for effective use
