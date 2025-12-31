# Alexandria Integration for Claude Code

Lifecycle-driven memory integration for Claude Code.

## Architecture

Alexandria v2 uses checkpoint-driven curation with progressive disclosure. Both Claude Code and pi-coding-agent integrations follow the same pattern:

```
┌─────────────────────────────────────────────────────────┐
│              CLAUDE CODE SESSION                         │
│                                                          │
│  SessionStart → UserPrompt → ToolUse → Stop → End       │
│       ↓            ↓           ↓         ↓       ↓       │
│   [inject]     [buffer]    [buffer]  [buffer] [curate]  │
└─────────────────────────────────────────────────────────┘
         ↓            ↓           ↓         ↓       ↓
┌─────────────────────────────────────────────────────────┐
│                  ALEXANDRIA v2                           │
│                                                          │
│  Context      Event Buffer (fire-and-forget)    Tiered  │
│  Pack Gen     ─────────────────────────────→    Curator │
└─────────────────────────────────────────────────────────┘
```

### Key Concepts

1. **Progressive Disclosure**: Context packs at 3 levels
   - `minimal` (~200 tokens): constraints + current goal
   - `task` (~500 tokens): + relevant memories (default)
   - `deep` (~1500 tokens): + evidence + history

2. **Checkpoint-Driven Curation**: Events buffered during session, curated at checkpoint
   - No per-event extraction noise
   - Tiered curator processes buffered events
   - Decision stability rules prevent meta-commentary from becoming memories

3. **Fire-and-Forget Capture**: Non-blocking event ingestion
   - All hooks run fast (<100ms)
   - Events buffered asynchronously
   - Doesn't slow down the main session

4. **Graceful Degradation**: If Alexandria fails, Claude Code continues normally

## Installation

```bash
alex install claude-code
```

Or manually:

```bash
cp -r integrations/claude-code ~/.claude/plugins/alexandria-memory
```

## Hooks

| Hook | Action |
|------|--------|
| `SessionStart` | Start session, generate context pack, inject via `additionalContext` |
| `UserPromptSubmit` | Buffer prompt (fire-and-forget) |
| `PreToolUse` | Buffer tool call (fire-and-forget) |
| `PostToolUse` | Buffer tool result (fire-and-forget) |
| `Stop` | Buffer response (fire-and-forget) |
| `SessionEnd` | Trigger checkpoint, run tiered curator, show pending count |

### Context Injection

On session start:

1. Starts Alexandria session (`alex session start`)
2. Generates context pack at task level (`alex pack --level task`)
3. Injects via `hookSpecificOutput.additionalContext`
4. Checks for stale memories, notifies if found

### Checkpoint Flow

Checkpoints trigger after N events (default: 10, configure via `ALEXANDRIA_AUTO_CHECKPOINT_THRESHOLD`).

When checkpoint threshold is reached:

1. **Tier 0** (deterministic) always runs:
   - Error→fix patterns
   - User corrections
   - Repeated patterns

2. **Tier 1** (Haiku) runs automatically if Claude OAuth available:
   - Extracts decisions, preferences, context
   - Uses Claude Code's existing OAuth token (no separate API key needed!)
   - Creates memories as "pending" for review

The OAuth token is automatically extracted from Claude Code's macOS Keychain storage.

### Slash Command

Use `/mem-checkpoint` to manually trigger memory extraction and review pending memories.

## Slash Commands

| Command | Description |
|---------|-------------|
| `/mem-search <query>` | Search memories |
| `/mem-add` | Add a new memory |
| `/mem-pack` | Generate context pack |
| `/mem-review` | Review pending memories |

## Requirements

- Alexandria CLI (`alex`) in PATH
- `jq` for JSON parsing
