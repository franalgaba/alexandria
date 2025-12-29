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
| `v` | Verify selected memory (mark as approved) |
| `r` | Retire selected memory |
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
│                            │ ...                        │
├────────────────────────────┴────────────────────────────┤
│ Project: myproject | Memories: 42 | Pending: 5          │
│ [Tab] Switch | [↑↓] Navigate | [v] Verify | [r] Retire  │
└─────────────────────────────────────────────────────────┘
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
