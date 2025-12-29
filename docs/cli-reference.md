# CLI Reference

Complete reference for Alexandria CLI commands.

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

Add an API/interface contract.

```bash
alex add-contract "UserAPI" \
  --type api \
  --definition "GET /users/:id returns { id, name, email }" \
  --constraints "Must return within 100ms"
```

**Options:**
- `--type` - Contract type: `api`, `interface`, `protocol`, `schema`
- `--definition` - Contract definition (required)
- `--constraints` - Constraints on the contract
- `--approve, -a` - Auto-approve

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

**Options:**
- `--content, -c` - New content
- `--type, -t` - New type

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
alex pack                              # Default task detection
alex pack --task "Add auth"            # Explicit task
alex pack --level minimal              # Constraints only (~200 tokens)
alex pack --level task                 # + Relevant (~500 tokens)
alex pack --level deep                 # + History (~1500 tokens)
alex pack --auto                       # Auto-detect from git
alex pack --format json                # JSON output
```

**Options:**
- `--task, -t` - Task description
- `--level, -l` - Detail level: `minimal`, `task`, `deep`
- `--auto` - Auto-detect task from git
- `--budget, -b` - Token budget
- `--format, -f` - Output format: `yaml`, `json`, `text`

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

### `alex conflicts`

Find contradicting memories.

```bash
alex conflicts                    # Show all conflicts
alex conflicts --type direct      # Only direct contradictions
alex conflicts --json
```

**Options:**
- `--type, -t` - Conflict type: `direct`, `implicit`, `temporal`
- `--json` - JSON output

## Integration

### `alex install <target>`

Install agent integrations.

```bash
alex install claude-code    # Claude Code plugin
alex install pi             # pi-coding-agent hooks
alex install all            # All integrations

alex install all --force    # Overwrite existing
alex install all --uninstall  # Remove integrations
```

**Options:**
- `--force, -f` - Overwrite existing
- `--uninstall, -u` - Uninstall instead

### `alex hooks <action>`

Manage git hooks.

```bash
alex hooks install      # Install post-commit hook
alex hooks uninstall    # Remove hook
alex hooks status       # Check installation
```

## Utilities

### `alex stats`

Show database statistics.

```bash
alex stats
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
