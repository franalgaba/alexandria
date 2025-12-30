# Alexandria Integration for pi-coding-agent

Hooks to integrate Alexandria with [pi-coding-agent](https://github.com/badlogic/pi-coding-agent), automatically capturing your entire conversation for memory extraction.

## Installation

```bash
alex install pi
```

Or manually:

```bash
mkdir -p ~/.pi/agent/hooks
cp integrations/pi/hooks/*.ts ~/.pi/agent/hooks/
```

## Available Hooks

### alexandria.ts

Full conversation capture with **real-time memory extraction** and **automatic context injection**:

| Event | What It Captures |
|-------|------------------|
| session (start) | Starts session, writes context to `.pi/ALEXANDRIA.md`, checks stale memories |
| agent_start | User prompts |
| turn_end | Assistant responses |
| tool_call | Tool invocations |
| tool_result | Tool outputs/errors |
| session (end) | Shows pending memory count |

**Context Injection:**
On session start, Alexandria writes relevant memories to `.pi/ALEXANDRIA.md` in your project. This file is automatically picked up by pi's context file discovery and included in the system prompt.

Memories are extracted **as events happen**, not at session end. This enables continuous sessions with ground truth capture.

### revalidation.ts

Interactive memory revalidation at session start.

**Features:**
- Runs `alex check --json` on session start
- Shows confirmation dialog if stale memories found
- Interactive selector for each stale memory:
  - ✅ Verify - mark as still valid
  - 🗑️ Retire - remove from active use
  - ⏭️ Skip - review later
  - 🚪 Stop - end review session

**Example Flow:**

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

### alexandria.ts

Session lifecycle integration for automatic context injection.

**Features:**
- Starts Alexandria session on pi session start
- Injects context pack into session
- Ingests tool results for memory extraction
- Processes session on end for memory candidates

## Tools

### memory/index.ts

Custom tool for memory management within pi sessions.

**Commands:**
- `memory search <query>` - Search memories
- `memory add <content>` - Add a memory
- `memory pack` - Generate context pack

## Structure

```
integrations/pi/
├── hooks/
│   ├── alexandria.ts      # Session lifecycle integration
│   └── revalidation.ts    # Interactive revalidation
├── tools/
│   └── memory/
│       └── index.ts       # Memory management tool
└── README.md
```

## Requirements

- Alexandria CLI (`alex`) in PATH
- pi-coding-agent with hooks support

## API Used

The hooks use pi's Context API:
- `ctx.ui.confirm()` - confirmation dialog
- `ctx.ui.select()` - option selector
- `ctx.ui.notify()` - notifications
- `ctx.exec()` - run shell commands
- `ctx.hasUI` - check if interactive UI available
