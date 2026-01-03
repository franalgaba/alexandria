# Alexandria Integration for pi-coding-agent

Lifecycle-driven memory integration for [pi-coding-agent](https://github.com/badlogic/pi-coding-agent).

## Architecture

Alexandria v2 uses checkpoint-driven curation with progressive disclosure. Both pi-coding-agent and Claude Code integrations follow the same pattern:

```
┌─────────────────────────────────────────────────────────┐
│              PI CODING AGENT SESSION                     │
│                                                          │
│  SessionStart → ToolCall → ToolResult → TurnEnd → End   │
│       ↓            ↓           ↓           ↓        ↓    │
│   [inject]     [buffer]    [buffer]    [buffer] [curate]│
└─────────────────────────────────────────────────────────┘
         ↓            ↓           ↓           ↓        ↓
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
   - All hooks run fast
   - Events buffered asynchronously
   - Doesn't slow down the main session

4. **Graceful Degradation**: If Alexandria fails, pi continues normally

## Installation

```bash
alex install pi
```

Or manually:

```bash
mkdir -p ~/.pi/agent/hooks
cp integrations/pi/hooks/*.ts ~/.pi/agent/hooks/
```

## Hooks

| Event | Action |
|-------|--------|
| `session (start)` | Start session, generate context pack, inject via `pi.send()` |
| `tool_call` | Buffer event (fire-and-forget) |
| `tool_result` | Buffer event (fire-and-forget) |
| `turn_end` | Buffer response (fire-and-forget) |
| `session (end)` | Trigger checkpoint, run tiered curator, show pending count |

### Context Injection

On session start:

1. Starts Alexandria session (`alex session start`)
2. Generates context pack at task level (`alex pack --level task`)
3. Injects via `pi.send()` as a message
4. Checks for stale memories, notifies if found

### Checkpoint Flow

Checkpoints can be triggered:
- **Automatically** after N events (default: 10, configure via `ALEXANDRIA_AUTO_CHECKPOINT_THRESHOLD`)
- **On session end** via `alex checkpoint`

When checkpoint runs:

1. Loads events since last checkpoint from database
2. **Tier 0** (deterministic) runs automatically:
   - Error→fix patterns
   - User corrections
   - Repeated patterns
3. **Agent-driven extraction**: After auto-checkpoint, the agent is prompted to review the session and extract higher-quality memories using `alex add`

This approach uses the coding agent itself for intelligent extraction - no separate API key needed!

## Hook: revalidation.ts

Interactive memory revalidation at session start.

- Detects stale memories via `alex check`
- Interactive dialog: Verify, Retire, Skip, Stop

## Requirements

- Alexandria CLI (`alex`) in PATH
- pi-coding-agent with hooks support
