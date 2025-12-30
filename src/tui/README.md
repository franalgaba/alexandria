# Alexandria TUI

Terminal UI for managing Alexandria memories. Run it side-by-side with Claude Code or pi-coding-agent.

## Usage

```bash
alex tui
```

## Features

- **Project switching**: Tab through different project databases
- **Memory list**: Browse all memories with type/status icons
- **Detail view**: Full memory details with metadata
- **Event trail**: See the original events that generated each memory
- **Quick actions**: Verify or retire memories with keyboard shortcuts

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Tab` | Switch focus between project tabs and memory list |
| `↑/↓` or `j/k` | Navigate memory list |
| `Enter` | Select memory (show details) |
| `a` | Add a new memory |
| `s` | Search memories |
| `p` | Generate context pack |
| `f` | Filter memories |
| `v` | Verify selected memory (mark as approved) |
| `r` | Retire selected memory |
| `Shift+R` | Refresh memory list |
| `Shift+D` | Toggle debug console |
| `t` | Toggle event trail view |
| `d` | Show detail view |
| `q` | Quit |

## Layout

```
┌─────────────────────────────────────────────────────────┐
│ 📚 Alexandria Memory System                             │
├─────────────────────────────────────────────────────────┤
│ [project1] [project2] [project3]                        │
├────────────────────────────┬────────────────────────────┤
│ Memory List                │ Memory Details / Trail     │
│                            │                            │
│ 🎯 🟢 Use JWT for auth...  │ 🎯 DECISION 🟢 approved   │
│ 🚫 🟡 Never store plain... │                            │
│ ✅ 🟢 Fix: add credenti... │ Use JWT tokens for auth... │
│                            │                            │
│                            │ ID: abc123                 │
│                            │ Confidence: high           │
├────────────────────────────┴────────────────────────────┤
│ Live Debug Console                                      │
│ [13:42:02] • INFO     Connected to project: myproject   │
│ [13:42:03] → EVENT    user_prompt received              │
│ [13:42:05] ★ MEMORY   New [DEC] memory created (pending)│
├─────────────────────────────────────────────────────────┤
│ Project: myproject | Memories: 42 | Pending: 5          │
│ [a]dd [s]earch [p]ack [f]ilter | [v]erify [r]etire      │
└─────────────────────────────────────────────────────────┘
```

## Debug Console

The debug console at the bottom shows real-time activity from coding agents. It clearly distinguishes between three types of activity:

### Data Flow Categories

| Icon | Label | Color | Meaning |
|------|-------|-------|---------|
| ▼ | RECV | Green/Purple/Orange | Data **received** from the coding agent |
| ▲ | INJECT | Blue | Context **sent back** to the agent |
| ★ | STORE | Green/Yellow | Memory **saved** to database |

### Event Types

**RECV (Received from Agent)**
- `user prompt` - User's input captured
- `assistant response` - AI's response captured
- `tool call → toolname` - Tool invocation
- `tool result ← toolname` - Tool output

**INJECT (Sent to Agent)**
- `context pack sent to agent` - Memory context injected
- `memories sent to agent` - Specific memories retrieved

**STORE (Saved to Database)**
- `[DEC] decision (approved)` - Approved memory stored
- `[FIX] known fix (pending review)` - Pending memory stored

### Controls

- `Shift+D` - Toggle debug console visibility
- **Drag top border** - Resize panel height (10%-50%)

### Example Output

```
[14:23:01] ▼ RECV   user prompt
                  "How do I fix this database error?"
[14:23:02] ▲ INJECT context pack sent to agent
                  "Constraints: Always use parameterized queries..."
[14:23:05] ▼ RECV   tool call → bash
                  "psql -c 'SELECT * FROM users'"
[14:23:06] ★ STORE  [FIX] known fix (pending review)
                  "Database connection requires SSL in production"
```

## Icons

### Memory Types
- 🎯 Decision
- 🚫 Constraint
- 📏 Convention
- ✅ Known Fix
- ❌ Failed Attempt
- ⭐ Preference
- ⚙️ Environment

### Review Status
- 🟢 Approved
- 🟡 Pending
- 🔴 Rejected
