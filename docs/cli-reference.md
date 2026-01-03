# CLI Reference

Complete reference for Alexandria CLI commands.

## Session Management

### `alex session start`

Start a new Alexandria session.

```bash
alex session start
alex session start --json    # JSON output with session ID
```

### `alex session end`

End the current session.

```bash
alex session end
alex session end --summary "Added authentication"
```

### `alex session current`

Show current session info.

```bash
alex session current
alex session current --json
```

## Event Ingestion

### `alex ingest [content]`

Ingest an event into the current session.

```bash
# From argument
alex ingest "Build failed with error X" --type error

# From stdin (used by hooks)
echo "tool output" | alex ingest --type tool_output --tool bash

# With exit code (for error→fix detection)
echo "Build succeeded" | alex ingest --type tool_output --tool bash --exit-code 0
```

**Options:**
- `--type, -t` - Event type: `user_prompt`, `assistant_response`, `tool_call`, `tool_output`, `error`, `diff`, `test_summary`
- `--tool` - Tool name (for tool events)
- `--exit-code` - Exit code (for tool_output, enables error→fix detection)
- `--skip-embedding` - Skip embedding generation (faster)
- `--file, -f` - Read content from file

**Auto-checkpoint:** Every 10 events, a checkpoint is automatically triggered to extract memories.

### `alex checkpoint`

Manually trigger memory curation checkpoint.

```bash
alex checkpoint                           # Current session
alex checkpoint --reason "Task complete"  # With reason
alex checkpoint --show-stats              # Show buffer stats first
```

**Options:**
- `--session` - Target specific session
- `--reason` - Reason for checkpoint
- `--show-stats` - Show buffer statistics

## Memory Management

### `alex add <content>`

Add a new memory.

```bash
alex add "Use async/await instead of callbacks" --type convention
alex add "Never store passwords in plain text" --type constraint --approve
```

**Options:**
- `--type, -t` - Memory type (required): `decision`, `convention`, `constraint`, `known_fix`, `failed_attempt`, `preference`, `environment`
- `--approve, -a` - Auto-approve the memory
- `--scope` - Scope: `global`, `project`, `module`, `file`
- `--scope-path` - Path for module/file scope

### `alex add-decision <content>`

Add a structured decision with rationale.

```bash
alex add-decision "Use SQLite for local storage" \
  --alternatives "PostgreSQL, JSON files" \
  --rationale "Simpler deployment, good enough for our scale" \
  --tradeoffs "Limited concurrent writes"
```

**Options:**
- `--alternatives` - Comma-separated alternatives considered
- `--rationale` - Why this decision was made (required)
- `--tradeoffs` - Known tradeoffs
- `--approve, -a` - Auto-approve

### `alex add-contract <name>`

Add an API or interface contract.

```bash
alex add-contract "UserAPI" \
  --type api \
  --definition "GET /users, POST /users" \
  --contract-version "1.0" \
  --file src/api/users.ts
```

**Options:**
- `--type, -t` - Contract type: `api`, `schema`, `interface`, `protocol` (default: `api`)
- `--definition, -d` - The contract definition
- `--contract-version` - Version of the contract
- `--file, -f` - File where the contract is defined
- `--approve` - Auto-approve

### `alex list`

List memories.

```bash
alex list                        # All active memories
alex list --status pending       # Pending review
alex list --status stale         # Stale memories
alex list --type decision        # Only decisions
alex list --json                 # JSON output
```

**Options:**
- `--status, -s` - Filter by status: `active`, `pending`, `stale`, `retired`
- `--type, -t` - Filter by type
- `--limit, -l` - Max results (default: 50)
- `--json` - JSON output

### `alex show <id>`

Show memory details.

```bash
alex show abc123
alex show abc123 --json
```

### `alex edit <id>`

Edit a memory.

```bash
alex edit abc123 --content "Updated content"
alex edit abc123 --type constraint
```

### `alex retire <id...>`

Retire memories (mark as no longer applicable).

```bash
alex retire abc123
alex retire abc123 def456 ghi789   # Multiple
```

### `alex supersede <old-id> <new-id>`

Mark one memory as superseding another.

```bash
alex supersede old123 new456
```

## Search & Retrieval

### `alex search <query>`

Search memories.

```bash
alex search "error handling"           # Hybrid search
alex search "JWT" --lexical-only       # Text match only
alex search "authentication" --vector-only  # Semantic only
alex search "API" --smart              # Intent-aware
alex search "testing" --type constraint
```

**Options:**
- `--lexical-only` - Only lexical/text search
- `--vector-only` - Only semantic/vector search
- `--smart` - Intent-aware routing
- `--type, -t` - Filter by type
- `--limit, -l` - Max results (default: 10)
- `--json` - JSON output

### `alex pack`

Generate a context pack for the current task.

```bash
alex pack                              # Default task level
alex pack --task "Add auth"            # Explicit task
alex pack --level minimal              # Constraints only (~200 tokens)
alex pack --level task                 # + Relevant (~500 tokens)
alex pack --level deep                 # + History (~1500 tokens)
alex pack --hot                        # Prioritize frequently accessed memories
alex pack --format json                # JSON output
```

**Options:**
- `--task, -t` - Task description
- `--level, -l` - Detail level: `minimal`, `task`, `deep`
- `--budget, -b` - Token budget
- `--format, -f` - Output format: `yaml`, `json`, `text`
- `--hot` - Prioritize frequently accessed memories (heatmap)

## Code Awareness

### `alex link <id>`

Link a memory to code.

```bash
alex link abc123 --file src/api.ts
alex link abc123 --file src/api.ts --symbol fetchUser
alex link abc123 --file src/api.ts --commit HEAD
```

**Options:**
- `--file, -f` - File path (required)
- `--symbol, -s` - Symbol name (function, class, etc.)
- `--commit, -c` - Git commit reference

### `alex check`

Check for stale memories.

```bash
alex check            # Show stale memories
alex check --json     # JSON output
```

### `alex verify <id>`

Mark a memory as verified (still valid after code changes).

```bash
alex verify abc123
```

### `alex symbols <file>`

Extract symbols from a source file.

```bash
alex symbols src/api.ts
alex symbols src/api.ts --kind function
alex symbols src/api.ts --exported
alex symbols src/api.ts --json
```

**Options:**
- `--kind, -k` - Filter by kind: `function`, `class`, `interface`, `type`, `variable`
- `--exported, -e` - Only exported symbols
- `--json` - JSON output

## Review & Validation

### `alex review`

Interactive review of pending memories.

```bash
alex review           # Interactive mode
alex review --list    # List pending only
alex review --auto    # Auto-approve high confidence
```

### `alex revalidate`

Interactive review of stale memories.

```bash
alex revalidate       # Interactive mode
```

## Feedback & Cleanup

### `alex feedback <id>`

Mark a memory as helpful or unhelpful to track effectiveness.

```bash
alex feedback abc123 --helpful
alex feedback abc123 --unhelpful --reason "Outdated info"
alex feedback abc123 --neutral
alex feedback abc123 --helpful --json
```

**Options:**
- `--helpful` - Mark memory as helpful
- `--unhelpful` - Mark memory as unhelpful
- `--neutral` - Mark memory as neutral
- `--reason` - Reason for the feedback
- `--json` - JSON output

Feedback influences memory ranking via outcome scores.

### `alex cleanup-noise`

Retire noisy or duplicate memories from the database.

```bash
alex cleanup-noise                    # Dry run (preview)
alex cleanup-noise --no-dry-run       # Execute cleanup
alex cleanup-noise --verbose          # Show details
alex cleanup-noise --pattern "TODO"   # Custom regex pattern
alex cleanup-noise --type convention  # Only check specific type
```

**Options:**
- `--dry-run` - Preview without changes (default: true)
- `--pattern` - Additional regex pattern to match noise
- `--type` - Only check memories of this type
- `--duplicates` - Also detect and retire duplicates (default: true)
- `--verbose` - Show details of each noisy memory

**Detected Noise Patterns:**
- Stream of consciousness ("let me check", "now let's")
- Raw console statements
- ASCII art/table fragments
- Raw edit parameters
- Tentative statements ("I will try")

## Integration

### `alex install <target>`

Install agent integrations.

```bash
alex install claude-code    # Claude Code plugin
alex install pi             # pi-coding-agent hooks

alex install pi --force     # Overwrite existing
alex install pi --uninstall # Remove integration
```

**Options:**
- `--force, -f` - Overwrite existing
- `--uninstall, -u` - Uninstall instead

## Utilities

### `alex tui`

Launch the Alexandria terminal UI for interactive memory management.

```bash
alex tui
```

Provides a full-screen interface for browsing, searching, and reviewing memories.

### `alex stats`

Show database statistics.

```bash
alex stats
alex stats --json
```

### `alex where`

Show database location.

```bash
alex where
```

### `alex export`

Export/import memories.

```bash
alex export --file backup.json
alex export --import --file backup.json
```

**Options:**
- `--file, -f` - File path
- `--import` - Import mode

## Context Management

### `alex context`

Check context window usage from Claude Code transcript.

```bash
alex context --transcript /path/to/transcript.jsonl
alex context --transcript /path/to/transcript.jsonl --json
```

**Options:**
- `--transcript, -t` - Path to Claude Code transcript JSONL file (required)
- `--json` - JSON output

**Output:**
```
Context: [▓▓▓▓▓▓░░░░░░░░░░░░░░] 28.5% (57.0K tokens)
  Input: 45.0K | Output: 12.0K
  Cache Read: 0 | Cache Create: 0
  Recommendation: ✅ Continue
```

When usage exceeds 50%, recommends checkpoint and clear.

### `alex heatmap`

Show most frequently accessed memories (access heatmap).

```bash
alex heatmap              # Top 10 hot memories
alex heatmap --limit 20   # Custom limit
alex heatmap --json       # JSON output
```

**Options:**
- `--limit, -l` - Number of memories to show (default: 10)
- `--json` - JSON output

**Output:**
```
🔥 ACCESS HEATMAP

1. 🔥🔥🔥 (42) Use Bun for TypeScript [src/cli.ts]
2. 🔥🔥🔥 (38) Never commit .env files [.env]
3. 🔥🔥  (25) Run tests before commit [test/]
4. 🔥    (15) Format with Prettier [src/]
```

### `alex disclose`

Check or perform progressive memory disclosure.

```bash
alex disclose --check --query "what should I remember?"
alex disclose --query "remind me about auth" -f text
```

**Options:**
- `--check` - Only check if disclosure is needed (returns JSON)
- `--query, -q` - User query to analyze for triggers
- `--format, -f` - Output format: `yaml`, `json`, `text`

**Escalation Triggers:**
- `explicit_query` - User asks "remind me", "what did we decide", etc.
- `error_burst` - 3+ consecutive errors
- `topic_shift` - Changed to different file/module
- `event_threshold` - 15+ events since last disclosure

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ALEXANDRIA_AUTO_CHECKPOINT_THRESHOLD` | `10` | Events before auto-checkpoint |
| `ALEXANDRIA_DB_PATH` | `~/.alexandria` | Database location |
| `ALEXANDRIA_CONTEXT_THRESHOLD` | `50` | Context window % before suggesting clear |
| `ALEXANDRIA_DISCLOSURE_THRESHOLD` | `15` | Events before re-evaluating disclosure |
| `ALEXANDRIA_ERROR_BURST_THRESHOLD` | `3` | Consecutive errors before escalation |
