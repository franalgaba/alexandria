# Alexandria Integration for pi-coding-agent

Lifecycle-driven memory integration for [pi-coding-agent](https://github.com/badlogic/pi-coding-agent).

## Architecture

Alexandria v2 uses checkpoint-driven curation with progressive disclosure. Both pi-coding-agent and Claude Code integrations follow the same pattern:

```
┌─────────────────────────────────────────────────────────┐
│              PI CODING AGENT SESSION                     │
│                                                          │
│  SessionStart → Prompt → ToolCall → ToolResult → End    │
│       ↓           ↓          ↓           ↓         ↓     │
│   [inject]    [buffer]   [buffer]    [buffer]  [curate] │
└─────────────────────────────────────────────────────────┘
         ↓           ↓          ↓           ↓         ↓
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
   - All extensions run fast
   - Events buffered asynchronously
   - Doesn't slow down the main session

4. **Access Heatmap**: Frequently accessed memories prioritized
   - Tracks which memories are actually used
   - Hot memories injected first at session start
   - Outcome feedback influences ranking

5. **Error Burst Detection**: Auto re-inject context on consecutive errors
   - Tracks consecutive tool errors
   - After 3+ errors, injects relevant constraints and known fixes

6. **Topic Shift Detection**: Re-inject context when switching files/modules
   - Monitors file paths in tool calls
   - Injects relevant memories when changing directories

7. **Graceful Degradation**: If Alexandria fails, pi continues normally

## Installation

```bash
alex install pi
```

Or manually:

```bash
mkdir -p ~/.pi/agent/extensions
cp integrations/pi/extensions/*.ts ~/.pi/agent/extensions/

# Or project-local
mkdir -p .pi/extensions
cp integrations/pi/extensions/*.ts .pi/extensions/
```

## Extensions

| Event | Action |
|-------|--------|
| `session_start` | Start session, generate context pack with hot memories, inject via `pi.sendMessage()` |
| `before_agent_start` | Buffer user prompt, check for explicit memory queries, inject disclosure context |
| `tool_call` | Buffer event (fire-and-forget), detect topic shifts |
| `tool_result` | Buffer event with exit code, detect error bursts |
| `turn_end` | Buffer response, check auto-checkpoint threshold |
| `session_before_switch` | Trigger checkpoint before switching sessions |
| `session_shutdown` | Trigger final checkpoint, show session stats |

### Context Injection

On session start:

1. Starts Alexandria session (`alex session start`)
2. Generates context pack with hot memories (`alex pack --level task --hot`)
3. Injects via `pi.sendMessage()` - persisted to session, visible in TUI, sent to LLM
4. Checks for stale memories, notifies if found

### Progressive Disclosure

Memories are re-injected during the session when:

| Trigger | Condition | Action |
|---------|-----------|--------|
| Explicit query | "remind me", "what did we decide" | Inject deep context via `alex disclose` |
| Error burst | 3+ consecutive errors | Inject constraints + known_fixes |
| Topic shift | Changed to different directory | Inject task-level context for new file |
| Event threshold | 15+ events since last disclosure | Re-evaluate and inject if needed |

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
3. **Tier 1** (Haiku) runs if Claude OAuth available:
   - Extracts decisions, conventions, preferences
   - Uses Claude Code's existing OAuth token (no separate API key needed!)
4. Memories created as "pending" for review

## Extension: revalidation.ts

Interactive memory revalidation at session start.

- Detects stale memories via `alex check`
- Interactive dialog: Verify, Retire, Skip, Stop

## CLI Commands During Session

```bash
# Memory management
alex add "content" --type decision --approve
alex add-decision "choice" --rationale "why"
alex add-contract "API" --type api

# Search and retrieval
alex search "query"
alex pack --level task

# Review and feedback
alex review                      # Interactive review
alex feedback <id> --helpful     # Mark memory as helpful
alex cleanup-noise               # Retire noisy memories

# Utilities
alex tui                         # Terminal UI
alex heatmap                     # Access heatmap
alex stats                       # Database stats
```

## Configuration

```bash
# Auto-checkpoint threshold (default: 10 events)
export ALEXANDRIA_AUTO_CHECKPOINT_THRESHOLD=10

# Consecutive errors before context re-injection (default: 3)
export ALEXANDRIA_ERROR_BURST_THRESHOLD=3

# Events before re-evaluating disclosure (default: 15)
export ALEXANDRIA_DISCLOSURE_THRESHOLD=15
```

## Requirements

- Alexandria CLI (`alex`) in PATH
- pi-coding-agent with extensions support
