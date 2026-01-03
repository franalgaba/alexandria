# Alexandria TUI

Terminal UI for managing Alexandria memories. Run it side-by-side with Claude Code or pi-coding-agent.

## Usage

```bash
alex tui
```

## Features

- **Project switching**: Tab through different project databases
- **Memory list**: Browse all memories with confidence tier icons
- **Detail view**: Full memory details with metadata
- **Event trail**: See the original events that generated each memory
- **Quality metrics**: View health score and quality indicators
- **Conflict resolution**: Review and resolve memory conflicts
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
| `Shift+S` | Show quality stats/metrics |
| `Shift+W` | Show context window viewer |
| `Shift+C` | Show conflicts (if any) |
| `$` | Show cost dashboard (Haiku usage, budgets) |
| `Shift+P` | Show pending review queue |
| `v` | Verify selected memory (mark as approved) |
| `r` | Retire selected memory |
| `Shift+R` | Refresh memory list |
| `Shift+D` | Toggle debug console |
| `t` | Toggle event trail view |
| `q` | Quit |

## Confidence Tiers

Memories are displayed with confidence tier indicators:

| Icon | Tier | Meaning |
|------|------|---------|
| ✅ | Grounded | Linked to code + recently verified |
| 👁 | Observed | Has evidence or user-approved |
| 🤖 | Inferred | AI-extracted, not confirmed |
| ❓ | Hypothesis | No evidence, suggested only |

## Quality Metrics (Shift+S)

View detailed quality information:
- **Health Score**: 0-100 overall quality rating
- **Memory Status**: Active, stale, superseded, retired counts
- **Confidence Tiers**: Distribution of grounded/observed/inferred/hypothesis
- **Code Freshness**: Verified vs needs-review vs stale

## Context Window Viewer (Shift+W)

Monitor context window health and injection history:

```
╔══════════════════════════════════════════════════════════════╗
║                   CONTEXT WINDOW VIEWER                      ║
╠══════════════════════════════════════════════════════════════╣
║  CONTEXT INJECTION LEVELS                                    ║
║  ┌────────────┬─────────┬──────────┬────────────────────────┐║
║  │ Level      │ Tokens  │ Memories │ Usage                  │║
║  ├────────────┼─────────┼──────────┼────────────────────────┤║
║  │ minimal    │    12   │      1   │ ██░░░░░░░░░░░░░░░░░░░░ │║
║  │ task       │    72   │      4   │ █████░░░░░░░░░░░░░░░░░ │║
║  │ deep       │   450   │     12   │ ██████████████░░░░░░░░ │║
║  └────────────┴─────────┴──────────┴────────────────────────┘║
╠══════════════════════════════════════════════════════════════╣
║  MEMORY TIER DISTRIBUTION                                    ║
║  ✅ Grounded:   ████░░░░░░░░░░░   2 (28%)                    ║
║  👁 Observed:   ████████░░░░░░░   4 (57%)                    ║
║  🤖 Inferred:   ██░░░░░░░░░░░░░   1 (14%)                    ║
╚══════════════════════════════════════════════════════════════╝
```

Features:
- **Token usage** by context level (minimal/task/deep)
- **Memory tier distribution** (grounded/observed/inferred/hypothesis)
- **Context health metrics** (avg tokens, grounded ratio)
- **Recent sessions** with event/memory counts
- **Injection history** tracking what was sent to agents

Controls:
- `R` Refresh the view
- `G` Generate and track a new context pack
- `Esc` Close

## Conflict Resolution (Shift+C)

When memory conflicts are detected, use the conflict view to resolve them:
- `←/→` Navigate between conflicts
- `1` Keep existing memory
- `2` Replace with new memory
- `3` Keep both memories
- `4` Reject both memories

## Layout

```
┌─────────────────────────────────────────────────────────┐
│ 📚 Alexandria Memory System                             │
├─────────────────────────────────────────────────────────┤
│ [project1] [project2] [project3]                        │
├────────────────────────────┬────────────────────────────┤
│ Memory List                │ Memory Details / Trail     │
│                            │                            │
│ ✅[+] Use JWT for auth...  │ 🎯 DECISION [+] approved   │
│ 👁[?] Never store plain... │                            │
│ 👁[+] Fix: add credenti... │ Use JWT tokens for auth... │
│                            │                            │
│                            │ ID: abc123                 │
│                            │ Confidence: grounded       │
├────────────────────────────┴────────────────────────────┤
│ Live Debug Console                                      │
│ [13:42:02] • INFO     Connected to project: myproject   │
│ [13:42:03] → EVENT    user_prompt received              │
│ [13:42:05] ★ MEMORY   New [DEC] memory created (pending)│
├─────────────────────────────────────────────────────────┤
│ Project: myproject | 42 memories | 🟢54 | ⚠️2 conflicts │
│ [a]dd [s]earch [p]ack [f]ilter [S]tats | [v]erify [q]uit│
└─────────────────────────────────────────────────────────┘
```

## Status Bar

The status bar shows:
- Project name
- Memory count
- Health score (🟢 ≥80, 🟡 ≥60, 🔴 <60)
- Pending conflicts (if any)
- Active filters

## Debug Console

The debug console at the bottom shows real-time activity from coding agents.

### Data Flow Categories

| Icon | Label | Color | Meaning |
|------|-------|-------|---------|
| ▼ | RECV | Green/Purple/Orange | Data **received** from the coding agent |
| ▲ | INJECT | Blue | Context **sent back** to the agent |
| ★ | STORE | Green/Yellow | Memory **saved** to database |

### Controls

- `Shift+D` - Toggle debug console visibility
- `+/-` - Resize panel height

## Memory Types

| Abbrev | Type | Icon |
|--------|------|------|
| DEC | Decision | 🎯 |
| CON | Constraint | 🚫 |
| CNV | Convention | 📏 |
| FIX | Known Fix | ✅ |
| FAL | Failed Attempt | ❌ |
| PRF | Preference | ⭐ |
| ENV | Environment | ⚙️ |

## Review Status

| Icon | Status |
|------|--------|
| + | Approved |
| ? | Pending |
| - | Rejected |
