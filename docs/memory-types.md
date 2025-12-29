# Memory Types

Alexandria supports different memory types for different kinds of knowledge. Using the right type helps with retrieval, confidence scoring, and presentation.

## Decision

**Use for:** Technical choices with rationale.

Decisions capture the "why" behind technical choices. They should include what alternatives were considered and why this option was chosen.

```bash
alex add-decision "Use SQLite for local storage" \
  --alternatives "PostgreSQL, JSON files, LevelDB" \
  --rationale "Single-file deployment, ACID transactions, good tooling" \
  --tradeoffs "Single-writer limitation, not suitable for high concurrency"
```

**Examples:**
- "Use React Query instead of Redux for server state"
- "Implement retry logic with exponential backoff"
- "Store sessions in Redis rather than database"

**Best practices:**
- Always include rationale
- Document alternatives considered
- Note any tradeoffs or limitations

## Convention

**Use for:** Coding standards, naming rules, patterns.

Conventions describe how code should be written in this project. They're patterns that should be followed for consistency.

```bash
alex add "Use camelCase for function names, PascalCase for classes" \
  --type convention
```

**Examples:**
- "All API endpoints return JSON with `{ data, error }` shape"
- "Use `async/await` instead of `.then()` chains"
- "Prefix private methods with underscore"
- "Test files should be named `*.test.ts`"

**Best practices:**
- Be specific and actionable
- Include examples where helpful
- Scope to relevant modules if not global

## Constraint

**Use for:** Hard rules that must never be violated.

Constraints are non-negotiable requirements. Breaking them would cause bugs, security issues, or other serious problems.

```bash
alex add "Never store API keys in code or git" \
  --type constraint --approve
```

**Examples:**
- "All database queries must use parameterized statements"
- "User passwords must be hashed with bcrypt, minimum 12 rounds"
- "API responses must not include internal error stack traces"
- "File uploads limited to 10MB"

**Best practices:**
- Constraints get highest retrieval priority
- Keep them short and unambiguous
- Approve immediately if verified

## Known Fix

**Use for:** Solutions to known problems.

Known fixes document what worked when solving a specific problem. They help avoid re-discovering solutions.

```bash
alex add "Sharp image library requires alpine-specific build: npm rebuild sharp --platform=linux --arch=x64" \
  --type known_fix
```

**Examples:**
- "CORS errors fixed by adding `credentials: 'include'` to fetch"
- "Memory leak in event listeners - must call `removeEventListener` in cleanup"
- "Docker build fails without `--platform linux/amd64` on M1 Macs"

**Best practices:**
- Include the error/symptom that triggers this
- Be specific about the solution
- Link to relevant code files

## Failed Attempt

**Use for:** What didn't work (to avoid repeating).

Failed attempts document approaches that were tried and failed. This prevents wasting time on known dead ends.

```bash
alex add "Tried using Web Workers for PDF generation - doesn't work because canvas API not available" \
  --type failed_attempt
```

**Examples:**
- "localStorage won't work for sessions - cleared on browser update"
- "GraphQL subscriptions over HTTP/2 - falls back to polling"
- "Attempted memoization of `getUser()` - breaks when user updates"

**Best practices:**
- Explain why it failed
- Note any context that might make it work differently
- Lower confidence than known_fix

## Preference

**Use for:** User/team preferences, style choices.

Preferences are subjective choices that don't have a clear "right answer" but should be consistent.

```bash
alex add "Prefer explicit returns over implicit in arrow functions" \
  --type preference
```

**Examples:**
- "Use named exports, not default exports"
- "Prefer `for...of` loops over `.forEach()`"
- "Put types in separate `.d.ts` files"

**Best practices:**
- Lower priority than conventions
- Can be overridden by explicit decisions
- Useful for AI assistants to match team style

## Environment

**Use for:** Configuration, versions, paths.

Environment memories capture technical context about the development environment.

```bash
alex add "Node.js 20.x required - using crypto.subtle API" \
  --type environment
```

**Examples:**
- "PostgreSQL 15 in production, 14 in CI"
- "Deploy target is AWS Lambda with 512MB memory"
- "Tailwind CSS 3.4 with custom config at ./tailwind.config.js"

**Best practices:**
- Include version numbers
- Note any environment-specific behavior
- Update when environment changes

## Type Confidence Weights

Different types have different default confidence weights:

| Type | Weight | Rationale |
|------|--------|-----------|
| `constraint` | 2.0x | Critical, must always be followed |
| `decision` | 1.5x | Deliberate choices with rationale |
| `convention` | 1.2x | Team standards |
| `known_fix` | 1.3x | Proven solutions |
| `failed_attempt` | 0.8x | Cautionary, may have context |
| `preference` | 0.7x | Lower priority |
| `environment` | 1.0x | Neutral |

These weights are combined with evidence-based confidence (grounded, observed, inferred, hypothesis) for final ranking.
