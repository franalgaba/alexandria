# Building a Hook System for Claude Code

> "How we built an event-driven architecture for AI coding assistants using shell scripts and JSON"

When we started building Alexandria, we faced a fundamental architectural challenge: how do you integrate with an AI coding assistant without becoming a bottleneck?

Claude Code is the host. We're the guest. Every millisecond of latency we add compounds across hundreds of interactions per session. Block the main loop, and the user experience degrades immediately.

Here's how we built an event-driven hook system that captures rich context while staying invisible to the user.

## The Integration Challenge

AI coding assistants have a lifecycle that looks roughly like this:

```
Session Start
    ↓
User Prompt → Agent Processing → Tool Calls → Tool Results
    ↓                              ↓             ↓
(repeat)                      (repeat)       (repeat)
    ↓
Session End
```

Each of these events contains valuable information:

- **Session start**: What codebase? What task?
- **User prompts**: Direct instructions, corrections, preferences
- **Tool calls**: What the agent is trying to do
- **Tool results**: What actually happened (including errors)
- **Session end**: Natural checkpoint for extraction

We needed to capture all of this without:

1. Blocking the agent's main loop
2. Adding perceptible latency
3. Failing in ways that break the session
4. Requiring manual configuration

## The Hook Architecture

Claude Code provides a hook system through a `hooks.json` configuration file. When you install Alexandria, it creates this in your project:

```json
{
  "hooks": {
    "SessionStart": [{
      "command": "bash ${HOOKS_PATH}/session-start.sh",
      "timeout": 30000,
      "returnsOutput": true
    }],
    "UserPromptSubmit": [{
      "command": "bash ${HOOKS_PATH}/user-prompt.sh",
      "timeout": 5000,
      "returnsOutput": false
    }],
    "PreToolUse": [{
      "command": "bash ${HOOKS_PATH}/tool-call.sh",
      "timeout": 5000,
      "returnsOutput": false
    }],
    "PostToolUse": [{
      "command": "bash ${HOOKS_PATH}/tool-result.sh",
      "timeout": 5000,
      "returnsOutput": false
    }],
    "Stop": [{
      "command": "bash ${HOOKS_PATH}/assistant-stop.sh",
      "timeout": 5000,
      "returnsOutput": false
    }],
    "SessionEnd": [{
      "command": "bash ${HOOKS_PATH}/session-end.sh",
      "timeout": 30000,
      "returnsOutput": true
    }]
  }
}
```

Each hook maps to a lifecycle event and specifies:

- `command`: What to run (shell script)
- `timeout`: Maximum execution time in milliseconds
- `returnsOutput`: Whether output is injected back into the session

This gives us six integration points across the session lifecycle.

## Event Capture: Fire and Forget

The core principle for event hooks is *fire and forget*. Capture the event, don't block.

Here's the actual `tool-result.sh` handler:

```bash
#!/bin/bash
set -e

# Check if alexandria is available
if ! command -v alex &> /dev/null; then
    exit 0
fi

# Read event data from environment
TOOL_NAME="${TOOL_NAME:-unknown}"
EXIT_CODE="${EXIT_CODE:-0}"

# Read tool output from stdin (piped by Claude Code)
TOOL_OUTPUT=""
if [ ! -t 0 ]; then
    TOOL_OUTPUT=$(cat)
fi

# Fire-and-forget: run in background, don't wait
(
    alex ingest \
        --type tool_output \
        --tool "$TOOL_NAME" \
        --exit-code "$EXIT_CODE" \
        --skip-embedding \
        <<< "$TOOL_OUTPUT" \
        2>/dev/null
) &

# Always exit successfully - never block the agent
exit 0
```

Key patterns:

1. **Check availability first.** If `alex` isn't installed, exit silently. The hook should never break the session.

2. **Read data from environment and stdin.** Claude Code passes event data through environment variables and stdin.

3. **Background execution.** The `( ... ) &` pattern runs ingestion in a subshell without waiting. The script exits immediately.

4. **Silent failures.** `2>/dev/null` suppresses errors. Logging happens inside Alexandria, not in the hook output.

5. **Always exit 0.** Regardless of what happens, we return success. A failing hook should never block the agent.

## Session Start: Context Injection

The session start hook is special. It's the one hook that *returns* content to the agent—the context pack of relevant memories.

```bash
#!/bin/bash
set -e

# Check if alexandria is available
if ! command -v alex &> /dev/null; then
    exit 0
fi

# Start session tracking
SESSION_INFO=$(alex session start --json 2>/dev/null || echo '{}')

# Generate context pack (task level, hot memories prioritized)
CONTEXT_PACK=$(alex pack --level task --hot -f text 2>/dev/null || echo '')

# Check for stale memories that need attention
STALE_CHECK=$(alex check --json 2>/dev/null || echo '{"stale": []}')
STALE_COUNT=$(echo "$STALE_CHECK" | jq -r '.stale | length' 2>/dev/null || echo '0')

# Build output for injection
if [ -n "$CONTEXT_PACK" ]; then
    echo "# Alexandria Context"
    echo ""
    echo "$CONTEXT_PACK"

    if [ "$STALE_COUNT" -gt 0 ]; then
        echo ""
        echo "⚠️ $STALE_COUNT memories reference changed code. Run \`alex check\` to review."
    fi
fi

exit 0
```

This hook:

1. Starts session tracking (creates a session record in the database)
2. Generates a context pack with relevant memories
3. Checks for stale memories that might need review
4. Outputs everything for injection into the agent's context

The output becomes part of the agent's initial context, appearing as if the user had provided it. The agent sees relevant memories without any explicit action required.

## The Context Pack

The `alex pack` command generates a token-budgeted summary of relevant memories:

```bash
$ alex pack --level task
# Project Memory Context

## Constraints (always apply)
- Never commit .env files - contains production secrets
- Always use --no-verify flag for automated commits

## Relevant Memories
- [decision] Use SQLite for local-first storage, no ops overhead
- [known_fix] Sharp on Alpine: install vips-dev first
- [convention] Use camelCase for functions, PascalCase for components

## Recent Session Context
- Last worked on: authentication refactor
- Pending review: 3 memories
```

Three disclosure levels control verbosity:

| Level | Tokens | Content |
|-------|--------|---------|
| `minimal` | ~200 | Constraints only |
| `task` | ~500 | + relevant memories for current work |
| `deep` | ~1500 | + related memories + recent history |

The `--hot` flag prioritizes frequently-accessed memories—those that have been reinforced through repeated retrieval or positive feedback.

## Handling Large Payloads

Tool outputs can be enormous. A `git diff` might be megabytes. A test run might output thousands of lines.

We handle this with a blob storage pattern:

```typescript
const INLINE_THRESHOLD = 4096; // 4KB

async function ingestEvent(event: Event) {
  if (event.content.length > INLINE_THRESHOLD) {
    // Store in blob table, keep only reference
    const blobId = await storeBlob(event.content);
    event.blobId = blobId;
    event.content = event.content.slice(0, 500) + '... [truncated, see blob]';
  }

  await insertEvent(event);
}
```

The event table stays compact. Large payloads are stored separately and retrieved on demand. This keeps the event log queryable without bloating indexes.

## The Checkpoint Trigger

Hooks don't just capture events—they trigger processing. Every event increments a counter, and when it crosses the threshold (default: 10 events), auto-checkpoint kicks in:

```bash
# Inside user-prompt.sh, tool-result.sh, etc.

# Increment event counter (atomic)
alex ingest --type user_prompt ...

# Check if we've crossed the threshold (handled internally)
# If so, checkpoint runs asynchronously
```

The checkpoint logic lives in Alexandria, not the hooks. Hooks just fire events; the checkpoint system decides when to process them.

```typescript
async function maybeAutoCheckpoint(sessionId: string) {
  const session = await getSession(sessionId);

  if (session.eventsSinceCheckpoint >= config.autoCheckpointThreshold) {
    // Run checkpoint asynchronously
    setTimeout(() => executeCheckpoint(sessionId, 'auto'), 0);
  }
}
```

This keeps hooks fast. The expensive work (LLM extraction, embedding generation) happens in the background.

## Session End: Final Checkpoint

When a session ends, we trigger one final checkpoint and show any pending memories:

```bash
#!/bin/bash
set -e

if ! command -v alex &> /dev/null; then
    exit 0
fi

# Trigger final checkpoint
alex checkpoint --trigger session_end 2>/dev/null || true

# End session and get summary
SESSION_SUMMARY=$(alex session end --json 2>/dev/null || echo '{}')

# Extract stats
MEMORIES_CREATED=$(echo "$SESSION_SUMMARY" | jq -r '.objectsCreated // 0')
PENDING_REVIEW=$(echo "$SESSION_SUMMARY" | jq -r '.pendingReview // 0')

if [ "$PENDING_REVIEW" -gt 0 ]; then
    echo ""
    echo "📝 $PENDING_REVIEW memories pending review. Run \`alex review\` to approve."
fi

if [ "$MEMORIES_CREATED" -gt 0 ]; then
    echo "✅ $MEMORIES_CREATED memories created this session."
fi

exit 0
```

This gives users a summary of what happened and prompts them to review extracted memories.

## The Skill System

Hooks handle automatic behavior. But sometimes users want to interact with Alexandria directly during a session. That's where skills come in.

A skill is a markdown file that provides instructions the agent can invoke:

```markdown
# Alexandria Memory Skill

When the user asks you to remember something or access project memory:

## Starting a Session
ALWAYS run `alex pack` at the start of EVERY conversation to get relevant context.

## Storing Memories
Use `alex add` to store important information:
- Decisions: `alex add "chose X because Y" --type decision --approve`
- Fixes: `alex add "when X fails, do Y" --type known_fix --approve`
- Constraints: `alex add "never do X" --type constraint --approve`

## Searching
Search existing memories with: `alex search "query"`

## Reviewing
Review pending extractions with: `alex review`
```

When installed, this skill becomes available to the agent. Users can invoke it naturally: "Remember that we decided to use SQLite" and the agent knows how to use the `alex` CLI.

## Error Handling Philosophy

We follow a strict hierarchy for error handling:

1. **Never block.** Even if everything is on fire, the hook returns 0 and the session continues.

2. **Fail silently to the user.** Errors are logged internally, not shown in the session.

3. **Degrade gracefully.** If `alex` isn't available, hooks exit immediately. If embedding fails, we skip it. If the database is locked, we retry later.

4. **Preserve data.** Events are appended to a WAL-mode SQLite database. If one write fails, the next succeeds. We don't lose data easily.

Here's the pattern we use throughout:

```bash
# The safe wrapper
safe_alex() {
    timeout 5 alex "$@" 2>/dev/null || true
}

# Usage
safe_alex ingest --type user_prompt ...
```

The `timeout` command prevents hangs. The `2>/dev/null` suppresses errors. The `|| true` ensures success status. This triple layer of protection keeps hooks robust.

## Performance Characteristics

We measured hook overhead in real sessions:

| Hook | p50 Latency | p99 Latency | Impact |
|------|-------------|-------------|--------|
| Session start | 45ms | 120ms | One-time, acceptable |
| User prompt | 2ms | 8ms | Imperceptible |
| Tool call | 2ms | 10ms | Imperceptible |
| Tool result | 3ms | 15ms | Imperceptible |
| Session end | 60ms | 200ms | One-time, acceptable |

The fire-and-forget pattern keeps event hooks under 15ms at p99. The session hooks take longer but only run once.

For comparison, a typical tool call takes 50-500ms. Our overhead is noise.

## Lessons Learned

After months of iteration, here's what we learned:

**Keep hooks fast.** Under 100ms is the target. Under 10ms is ideal. Every millisecond adds up across hundreds of events.

**Fail silently, log verbosely.** Users don't need to see hook failures. You need to debug them later. Write detailed internal logs.

**Buffer events, process in batches.** Per-event processing is expensive. Checkpoints amortize the cost.

**Test with edge cases.** What happens with 10MB tool outputs? With 1000 rapid events? With database locks? Build for the worst case.

**Background everything possible.** The only synchronous work should be appending to the event buffer. Everything else can happen later.

**Provide escape hatches.** Users need to disable hooks, skip processing, and recover from bad states. Build in circuit breakers.

## Installation

Setting up Alexandria's Claude Code integration is one command:

```bash
alex install claude-code
```

This creates:
- `hooks.json` in your project's `.claude/` directory
- Shell handlers in `.claude/hooks-handlers/`
- The Alexandria skill in `.claude/skills/`

From there, hooks capture events automatically and memories build up over sessions.

---

Building integrations for AI coding assistants is a new discipline. The patterns are still emerging. What we've shared here works for Alexandria, but the principles—fire-and-forget capture, graceful degradation, background processing—should apply broadly.

The source code is at [github.com/your-org/alexandria](https://github.com/your-org/alexandria). The hook handlers are in `integrations/claude-code/`.

*Every millisecond of latency you add compounds across hundreds of interactions.*
