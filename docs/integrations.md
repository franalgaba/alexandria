# Agent Integrations

Alexandria integrates with coding agents to automatically capture memories from your sessions.

## How It Works

Alexandria captures the **full conversation in real-time**:

1. **User prompts** - What you ask the agent to do
2. **Assistant responses** - The agent's explanations and reasoning
3. **Tool calls** - What commands/edits the agent invokes
4. **Tool results** - Output from commands, file contents, errors

**Real-time extraction**: As each event is captured, Alexandria immediately analyzes it for memory candidates using pattern matching. Memories are extracted and queued as the conversation happens - no waiting until session end.

This means:
- **Continuous sessions** - Sessions can run indefinitely
- **Ground truth** - Knowledge is captured the moment it happens
- **No lost memories** - Even if you crash, captured events are preserved

At session start, Alexandria:
1. **Checks for stale memories** (code changed since last verified)
2. **Prompts for revalidation** so you can verify or retire outdated memories
3. **Injects context** from relevant memories

## Installation

```bash
# Install all integrations
alex install all

# Or install specific ones
alex install claude-code
alex install pi
```

## Claude Code

The Claude Code plugin captures the full conversation for memory extraction:

- **SessionStart**: Checks for stale memories, starts Alexandria session
- **UserPromptSubmit**: Captures your prompts
- **PreToolUse**: Captures tool invocations
- **PostToolUse**: Captures tool results
- **Stop**: Captures when the agent completes
- **SessionEnd**: Processes session, extracts memories
- **Slash commands**: `/mem-search`, `/mem-add`, `/mem-pack`, `/mem-review`
- **Skill**: Memory management guidance

### Installation

```bash
alex install claude-code
```

This installs the plugin to `~/.claude/plugins/alexandria-memory`.

### Real-time Memory Extraction

Memories are extracted **as the conversation happens**, not at session end. When a pattern is detected (decision, fix, constraint, etc.), it's immediately queued for review.

When your session ends (or anytime), you can review pending memories:

```bash
alex review           # Interactive review
alex review --list    # See pending count
```

### Stale Memory Revalidation

When you start a Claude Code session, the hook runs `alex check` to find stale memories. If any are found, it injects context that prompts Claude to ask you about them:

```
📚 Alexandria Memory Check

I found 2 memory(ies) that may need revalidation:

- **[decision]** "Use fetchUser() for API calls..." (Reason: File changed)
- **[convention]** "Always use async/await..." (Reason: File deleted)

Would you like to review these memories now?
```

You can then tell Claude to verify or retire each memory.

### Slash Commands

| Command | Description |
|---------|-------------|
| `/mem-search <query>` | Search memories |
| `/mem-add` | Add a new memory |
| `/mem-pack` | Generate context pack |
| `/mem-review` | Review pending memories |

### Skill

The Alexandria skill is automatically available in Claude Code. It provides guidance on:
- When to add memories
- Memory types and their uses
- Best practices for memory management

### Uninstall

```bash
alex install claude-code --uninstall
```

## pi-coding-agent

The pi integration provides full session lifecycle management and interactive revalidation.

### Installation

```bash
alex install pi
```

This installs hooks to `~/.pi/agent/hooks/`.

### Hooks

#### alexandria-alexandria.ts

Full session lifecycle integration that captures the entire conversation:

- **Session start**: Starts Alexandria session, injects context pack
- **Agent start**: Captures user prompts
- **Turn end**: Captures assistant responses
- **Tool call**: Captures tool invocations (input)
- **Tool result**: Captures tool outputs
- **Session end**: Processes session for memory extraction

When a session ends, you'll see:
```
📚 3 memories queued for review
```

#### alexandria-revalidation.ts

Interactive memory revalidation at session start. Uses pi's TUI components:

```
┌─────────────────────────────────────────────┐
│ 📚 Alexandria Memory Check                  │
│                                             │
│ Found 2 stale memory(ies). Review them now? │
│                                             │
│ [Yes]  [No]                                 │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ ⚠️ [decision] "Use fetchUser() for API..."  │
│    Reason: File changed: src/api.ts         │
│                                             │
│ > ✅ Verify - still valid                   │
│   🗑️ Retire - no longer needed              │
│   ⏭️ Skip - review later                    │
│   🚪 Stop reviewing                         │
└─────────────────────────────────────────────┘
```

#### alexandria-alexandria.ts

Session lifecycle integration:
- Starts Alexandria session on pi session start
- Injects context pack into session
- Ingests tool results for memory extraction
- Processes session on end for memory candidates

### Uninstall

```bash
alex install pi --uninstall
```

## Git Hooks

Alexandria can also install git hooks for commit-time notifications:

```bash
# Install post-commit hook
alex hooks install

# Check status
alex hooks status

# Uninstall
alex hooks uninstall
```

The post-commit hook runs `alex check` after each commit and notifies you if any memories reference changed files.

## Manual Integration

If you're using a different coding agent, you can integrate manually:

### Context Injection

Generate a context pack and inject it into your system prompt:

```bash
# Generate context pack
CONTEXT=$(alex pack --format text)

# Inject into prompt
echo "Memory context:\n$CONTEXT" >> system_prompt.txt
```

### Session Tracking

Track agent sessions for memory extraction:

```bash
# Start session
alex session start --task "Add authentication"

# During session, ingest tool outputs
alex ingest "Command output..." --tool bash

# End session
alex session end --summary "Added JWT authentication"

# Process for memory extraction
alex session process
```

### Programmatic Usage

Use Alexandria as a library:

```typescript
import { 
  getConnection, 
  MemoryObjectStore, 
  Retriever,
  ContextPackCompiler 
} from 'alexandria';

// Get database connection
const db = getConnection();
const store = new MemoryObjectStore(db);
const retriever = new Retriever(db);

// Search memories
const results = await retriever.search("error handling", { limit: 5 });

// Generate context pack
const compiler = new ContextPackCompiler(db);
const pack = await compiler.compile({
  task: "Add authentication",
  budget: 1500,
});
```
