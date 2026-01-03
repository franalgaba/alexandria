# Agent Integrations

Alexandria integrates with coding agents to automatically capture and extract memories from your sessions.

## Architecture

Both Claude Code and pi-coding-agent integrations follow the same pattern:

```
┌─────────────────────────────────────────────────────────────────┐
│                      CODING AGENT SESSION                        │
│                                                                  │
│  SessionStart → ToolCall → ToolResult → TurnEnd → SessionEnd    │
│       ↓            ↓           ↓           ↓           ↓         │
│   [inject]     [buffer]    [buffer]    [buffer]    [curate]     │
└─────────────────────────────────────────────────────────────────┘
         ↓            ↓           ↓           ↓           ↓
┌─────────────────────────────────────────────────────────────────┐
│                      ALEXANDRIA v2                               │
│                                                                  │
│  Context      Event Buffer (fire-and-forget)           Tiered   │
│  Pack Gen     ─────────────────────────────────→       Curator  │
└─────────────────────────────────────────────────────────────────┘
```

### Key Concepts

1. **Checkpoint-Driven Curation**: Events are buffered and processed at checkpoints (every 10 events), not extracted in real-time
2. **Tiered Extraction**: Tier 0 (deterministic patterns) + Tier 1 (Haiku LLM)
3. **Zero API Key Required**: Uses Claude Code's existing OAuth token for Haiku calls
4. **Fire-and-Forget Capture**: Event ingestion is non-blocking
5. **Progressive Disclosure**: Context packs at minimal/task/deep levels, with re-injection on topic shifts/errors
6. **Context Window Management**: Auto-checkpoint at 50% context, suggest /clear to prevent compaction
7. **Access Heatmap**: Frequently accessed memories prioritized at session start
8. **Graceful Degradation**: If Alexandria fails, the agent continues normally

## Installation

```bash
# Install specific integration
alex install claude-code
alex install pi
```

## Claude Code

The Claude Code plugin provides full session lifecycle integration.

### Installation

```bash
alex install claude-code
```

This installs the plugin to `~/.claude/plugins/alexandria-memory`.

### Hooks

| Hook | Action |
|------|--------|
| `SessionStart` | Start session, inject hot memories + context pack via `additionalContext` |
| `UserPromptSubmit` | Buffer prompt, check context usage, detect escalation triggers |
| `PreToolUse` | Buffer tool call (fire-and-forget) |
| `PostToolUse` | Buffer tool result, track errors (fire-and-forget) |
| `Stop` | Buffer response (fire-and-forget) |
| `SessionEnd` | Trigger checkpoint, prompt agent for extraction |

### Context Injection

At session start, **hot memories** (most frequently accessed) are injected first, followed by relevant context:

```
# Alexandria Memory Context

🚫 CONSTRAINTS:
  • Never use any type in TypeScript files [src/utils/]
  • Always validate user input [src/api/]

📝 MEMORIES:
  ✅ Using Bun instead of Node for speed [package.json]
  👁️ All API endpoints return JSON with status field [src/api/routes.ts]
```

Memory format includes **code refs** for grounding.

### Progressive Disclosure

Memories are re-injected during the session when:

| Trigger | Condition | Action |
|---------|-----------|--------|
| Explicit query | "remind me", "what did we decide" | Inject deep context |
| Error burst | 3+ consecutive errors | Inject constraints + known_fixes |
| Topic shift | Changed file/module | Inject task-level context |
| Event threshold | 15+ events | Re-evaluate and inject if needed |

### Context Window Management

The `UserPromptSubmit` hook monitors context usage:

1. Reads `transcript_path` from hook input
2. Parses JSONL to calculate token usage
3. If usage > 50%:
   - Runs `alex checkpoint` to extract learnings
   - Outputs: "⚠️ Context at X%. Memories extracted. Consider /clear"

This prevents compaction and ensures learnings are preserved before clearing.

### Auto-Checkpoint

Every 10 events, a checkpoint triggers:

1. **Tier 0** runs automatically (deterministic patterns)
2. **Tier 1** runs if Claude OAuth available (Haiku extraction)
3. Memories created as "pending" for review

### Slash Commands

| Command | Description |
|---------|-------------|
| `/mem-search <query>` | Search memories |
| `/mem-add` | Add a new memory |
| `/mem-pack` | Generate context pack |
| `/mem-review` | Review pending memories |

### Skill

The Alexandria skill provides guidance on memory management and is auto-loaded.

### Uninstall

```bash
alex install claude-code --uninstall
```

## pi-coding-agent

The pi integration uses TypeScript hooks for full session lifecycle management.

### Installation

```bash
alex install pi
```

This installs hooks to `~/.pi/agent/hooks/`.

### Hooks

| Event | Action |
|-------|--------|
| `session (start)` | Start session, generate context pack, inject via `pi.send()` |
| `tool_call` | Buffer event (fire-and-forget) |
| `tool_result` | Buffer event (fire-and-forget) |
| `turn_end` | Buffer response, check for auto-checkpoint |
| `session (end)` | Trigger checkpoint, end session |

### Context Injection

At session start, memories are injected as a message via `pi.send()`:

```typescript
pi.send(`# Alexandria Memory Context

${contextPack}

These memories contain past decisions, constraints, known fixes, and conventions.`);
```

### Auto-Checkpoint

Every 10 events (configurable via `ALEXANDRIA_AUTO_CHECKPOINT_THRESHOLD`):

1. **Tier 0** runs automatically (deterministic patterns)
2. **Tier 1** runs if API key available (Haiku extraction)
3. Memories created as "pending" for review

### Revalidation Hook

The `revalidation.ts` hook provides interactive stale memory review:

```
┌─────────────────────────────────────────────┐
│ 📚 Alexandria Memory Check                  │
│                                             │
│ Found 2 stale memory(ies). Review them now? │
│                                             │
│ [Yes]  [No]                                 │
└─────────────────────────────────────────────┘
```

### Uninstall

```bash
alex install pi --uninstall
```

## Configuration

```bash
# Auto-checkpoint threshold (default: 10 events)
export ALEXANDRIA_AUTO_CHECKPOINT_THRESHOLD=10

# Context window threshold for suggesting clear (default: 50%)
export ALEXANDRIA_CONTEXT_THRESHOLD=50

# Events before re-evaluating disclosure (default: 15)
export ALEXANDRIA_DISCLOSURE_THRESHOLD=15

# Consecutive errors before escalation (default: 3)
export ALEXANDRIA_ERROR_BURST_THRESHOLD=3
```

## Manual Integration

For other coding agents, integrate manually:

### Context Injection

```bash
# Generate context pack
CONTEXT=$(alex pack --level task -f text)

# Inject into your system prompt
```

### Session Tracking

```bash
# Start session
alex session start

# Ingest events (fire-and-forget)
echo "tool output" | alex ingest --type tool_output --tool bash

# Checkpoint (extracts memories)
alex checkpoint

# End session
alex session end
```

### Programmatic Usage

```typescript
import { 
  getConnection, 
  MemoryObjectStore, 
  Retriever,
  ContextPackCompiler 
} from 'alexandria';

const db = getConnection();
const compiler = new ContextPackCompiler(db);

// Generate context pack
const pack = await compiler.compile({
  level: 'task',
  budget: 500,
});
```
