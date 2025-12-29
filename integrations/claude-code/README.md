# Alexandria Plugin for Claude Code

This plugin integrates Alexandria's memory system with Claude Code, automatically capturing your entire conversation for memory extraction.

## Features

- **Full Conversation Capture**: User prompts, assistant responses, tool calls, results
- **Automatic Memory Extraction**: Pattern matching extracts decisions, fixes, constraints
- **Stale Memory Detection**: Prompts for revalidation when code changes
- **Slash Commands**: `/mem-search`, `/mem-add`, `/mem-pack`, `/mem-review`
- **Skill**: Memory management guidance

## Installation

```bash
alex install claude-code
```

Or manually:

```bash
cp -r integrations/claude-code ~/.claude/plugins/alexandria-memory
```

## Hooks

| Hook | What It Captures |
|------|------------------|
| SessionStart | Checks for stale memories, starts session |
| UserPromptSubmit | Your prompts to Claude |
| PreToolUse | Tool invocations (commands, edits) |
| PostToolUse | Tool results (output, errors) |
| Stop | When Claude completes a response |
| SessionEnd | Ends session, processes for memories |

## Real-time Memory Extraction

Memories are extracted **as the conversation happens** - not at session end. When patterns are detected (decisions, fixes, constraints), they're immediately queued for review.

Check pending memories anytime:
```bash
alex review --list    # See pending count
alex review           # Interactive review
```

## Stale Memory Revalidation

When a session starts, the hook:

1. Runs `alex check --json` to find stale memories
2. If stale memories exist, injects context for Claude
3. Claude asks you about each stale memory:
   - **[v] Verify** - Mark as still valid
   - **[r] Retire** - Remove from active use
   - **[s] Skip** - Review later

### Example

```
📚 Alexandria Memory Check

I found 2 memory(ies) that may need revalidation:

- **[decision]** "Use fetchUser() for API calls..." (Reason: File changed)
- **[convention]** "Always use async/await..." (Reason: File deleted)

Would you like to review these memories now?
```

## Slash Commands

| Command | Description |
|---------|-------------|
| `/mem-search <query>` | Search memories |
| `/mem-add` | Add a new memory |
| `/mem-pack` | Generate context pack |
| `/mem-review` | Review pending memories |

## Skill

The Alexandria skill (`skills/alexandria/SKILL.md`) provides guidance on:
- When to add memories
- Memory types and their uses
- Best practices for memory management

## Plugin Structure

```
integrations/claude-code/
├── .claude-plugin/
│   └── plugin.json           # Plugin metadata
├── commands/
│   ├── mem-add.md            # /mem-add command
│   ├── mem-pack.md           # /mem-pack command
│   ├── mem-review.md         # /mem-review command
│   └── mem-search.md         # /mem-search command
├── hooks/
│   └── hooks.json            # Hook configuration
├── hooks-handlers/
│   ├── session-start.sh      # Check stale memories
│   ├── user-prompt.sh        # Capture user prompts
│   ├── tool-call.sh          # Capture tool invocations
│   ├── tool-result.sh        # Capture tool results
│   ├── assistant-stop.sh     # Capture stop events
│   └── session-end.sh        # Process & extract memories
├── skills/
│   └── alexandria/
│       └── SKILL.md          # Memory management skill
└── README.md
```

## Requirements

- Alexandria CLI (`alex`) in PATH
- `jq` for JSON parsing
