# Coding Agent Memory: A Purpose-Built Approach

## Why Generic Memory Systems Fail for Coding Agents

### The Problem with Conversational Memory

Systems like Mem0 and Zep are designed for **social/personal AI assistants**:

```
User: "My daughter's birthday is next month"
User: "She loves horses"
User: "What should I get her for her birthday?"
→ Memory recalls: daughter, birthday, horses → "Horse riding lessons!"
```

This works because:
- Entities are people, places, dates
- Facts are relatively stable ("daughter likes horses")
- Retrieval is about connecting personal context
- No external verification needed

**But coding agents operate in a fundamentally different domain:**

```
Developer: "Why is the build failing?"
Agent: *tries npm install, fails*
Agent: *discovers sharp requires libvips on Alpine*
Agent: *installs vips-dev, build succeeds*
Developer: "Good, remember that fix"
```

What needs to be remembered:
- **Technical context**: Alpine Linux, sharp package, libvips dependency
- **Failure pattern**: Sharp compilation fails without system deps
- **Solution**: Install vips-dev before npm install
- **Code location**: Dockerfile, package.json
- **Verification**: Build succeeds after fix

Generic memory systems **cannot handle this** because:

| Aspect | Conversational Memory | Coding Memory |
|--------|----------------------|---------------|
| Entities | People, places, dates | Files, functions, packages, errors |
| Facts | Stable preferences | Evolving codebase |
| Verification | None needed | Must match current code |
| Staleness | Rare | Constant (code changes) |
| Structure | Graph of relationships | Code references + decisions |

---

## The Unique Challenges of Coding Agent Memory

### 1. Code Is the Source of Truth

Unlike personal facts, code memories can be **verified**:

```typescript
// Memory: "The API rate limiter is in src/middleware/rateLimit.ts"

// Verification:
if (!fs.existsSync('src/middleware/rateLimit.ts')) {
  // Memory is STALE - file was moved or deleted
  markAsStale(memory);
}
```

**Generic systems don't verify** - they assume memories are true until explicitly corrected.

### 2. Decisions Need Rationale

Coding decisions are meaningless without context:

```
❌ Bad memory: "Use PostgreSQL"
✅ Good memory: "Use PostgreSQL instead of MongoDB because we need
   ACID transactions for payment processing. Considered MongoDB but
   rejected due to eventual consistency issues with financial data."
```

**Why rationale matters:**
- Future developers understand constraints
- Agent won't suggest rejected alternatives
- Decisions can be revisited when requirements change

### 3. Failed Attempts Are Critical

In coding, knowing what **doesn't work** is as valuable as knowing what works:

```typescript
// Memory type: failed_attempt
{
  content: "Tried using worker_threads for PDF generation but hit
            memory limits. Each worker consumed 500MB+.",
  context: "PDF generation feature",
  alternative: "Using child_process with external wkhtmltopdf instead"
}
```

Generic memory systems focus on **positive facts** - they don't have a concept of "we tried X and it failed because Y."

### 4. Hard Constraints Exist

Some rules can **never be violated**:

```typescript
// Memory type: constraint
{
  content: "NEVER commit .env files - contains production secrets",
  severity: "critical",
  enforcement: "pre-commit hook"
}
```

These aren't preferences - they're hard rules. Generic systems treat all memories equally, with no concept of inviolable constraints.

### 5. Code References Are Essential

Memories must anchor to specific code locations:

```typescript
// Memory with code reference
{
  content: "Rate limiting is 100 req/min per IP",
  codeRefs: [
    { file: "src/middleware/rateLimit.ts", line: 42, symbol: "RATE_LIMIT" }
  ]
}
```

When `rateLimit.ts` changes, we can:
- Check if line 42 still exists
- Verify RATE_LIMIT constant value
- Mark memory as stale if code diverged

**Generic systems have no concept of code references.**

### 6. Git-Aware Staleness

Code memories become stale when:
- Referenced files are modified
- Referenced symbols are renamed/removed
- Dependencies are updated
- Architecture changes

```typescript
// Staleness detection
const memory = getMemory("rate-limit-config");
const fileHash = await git.getFileHash(memory.codeRefs[0].file);

if (fileHash !== memory.lastKnownHash) {
  // File changed since memory was created
  flagForReview(memory);
}
```

### 7. Session Context Is Different

Conversational sessions are about **topic continuity**.
Coding sessions are about **task completion**:

```
Coding Session:
├── Task: "Fix authentication bug"
├── Files touched: [auth.ts, middleware.ts, tests/auth.test.ts]
├── Decisions made: ["Use JWT instead of sessions"]
├── Fixes applied: ["Add token refresh logic"]
└── Tests passing: true
```

The session itself is a unit of work that may generate memories.

---

## Alexandria's Architecture for Coding Agents

### Core Philosophy

> **Memories are grounded in code, not conversation.**

```
┌─────────────────────────────────────────────────────────────────┐
│                         ALEXANDRIA                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   Ingestor   │───▶│    Store     │◀───│  Retriever   │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│         │                   │                   │               │
│         ▼                   ▼                   ▼               │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │  Checkpoint  │    │  SQLite +    │    │   Hybrid     │      │
│  │  Extraction  │    │  FTS5 Index  │    │   Search     │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│         │                   │                   │               │
│         ▼                   ▼                   ▼               │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │  Code Refs   │    │   Memory     │    │   Context    │      │
│  │  Extraction  │    │   Objects    │    │    Pack      │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│         │                                       │               │
│         ▼                                       ▼               │
│  ┌──────────────┐                       ┌──────────────┐       │
│  │  Git-Aware   │                       │   Staleness  │       │
│  │  Hashing     │                       │   Detection  │       │
│  └──────────────┘                       └──────────────┘       │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    REVIEWER                              │   │
│  │  Human-in-the-loop verification of extracted memories   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Memory Types (Coding-Specific)

| Type | Purpose | Example |
|------|---------|---------|
| `decision` | Technical choices with rationale | "Using Bun instead of Node for native TS support" |
| `constraint` | Hard rules that cannot be violated | "Never expose internal IDs in API responses" |
| `known_fix` | Solutions that worked | "Sharp on Alpine needs vips-dev" |
| `failed_attempt` | What didn't work and why | "Worker threads OOM'd for PDF gen" |
| `convention` | Coding standards | "Use kebab-case for file names" |
| `preference` | Soft preferences | "Prefer named exports over default" |
| `environment` | System configuration | "Production uses Node 20.x on Alpine" |

### Checkpoint-Driven Curation

Unlike streaming ingestion, Alexandria captures memories at **decision points**:

```
Session Timeline:
──●────────●────────●────────●────────●──▶
  │        │        │        │        │
  │        │        │        │        └─ Session End
  │        │        │        └─ Test passes (checkpoint)
  │        │        └─ Fix applied (checkpoint)
  │        └─ Error identified (checkpoint)
  └─ Task started
```

**Why checkpoints matter:**
1. Capture the moment decisions are made
2. Include context that led to the decision
3. Reduce noise from exploratory actions
4. Group related events

### Tiered Extraction

```
Events Buffer
     │
     ▼
┌─────────────────────────────────────────────┐
│            CHECKPOINT TRIGGER               │
│         (every 10 events or manual)         │
└─────────────────────────────────────────────┘
     │
     ├─────────────────┬─────────────────┐
     ▼                 ▼                 ▼
┌─────────┐     ┌───────────┐     ┌───────────┐
│ Tier 0  │     │  Tier 1   │     │  Tier 2   │
│Determin │     │  Haiku    │     │  Sonnet   │
│  istic  │     │ Extraction│     │ (future)  │
└─────────┘     └───────────┘     └───────────┘
     │                 │                 │
     ▼                 ▼                 ▼
• Error→Fix       • Decisions      • Complex
  patterns        • Conventions      reasoning
• User            • Preferences    • Architecture
  corrections     • Known fixes      decisions
• Repeated
  patterns
```

### Code Reference Tracking

Every memory can have code anchors:

```typescript
interface MemoryObject {
  id: string;
  content: string;
  type: MemoryType;

  // Coding-specific fields
  codeRefs: CodeReference[];
  gitContext: {
    commitHash: string;
    branch: string;
    fileHashes: Map<string, string>;
  };

  // Verification
  status: 'active' | 'stale' | 'superseded';
  lastVerified: Date;
}

interface CodeReference {
  file: string;
  line?: number;
  symbol?: string;  // function name, class name, etc.
  hash: string;     // content hash for change detection
}
```

### Git-Aware Staleness Detection

```typescript
async function checkStaleness(memory: MemoryObject): Promise<boolean> {
  for (const ref of memory.codeRefs) {
    // Check if file still exists
    if (!await fileExists(ref.file)) {
      return true; // File deleted
    }

    // Check if content changed
    const currentHash = await hashFile(ref.file);
    if (currentHash !== ref.hash) {
      // File changed - check if specific line/symbol affected
      if (ref.symbol) {
        const symbolExists = await findSymbol(ref.file, ref.symbol);
        if (!symbolExists) {
          return true; // Symbol removed
        }
      }
    }
  }

  return false;
}
```

### Context Pack Generation

When the agent needs context, Alexandria generates a **focused pack**:

```typescript
interface ContextPack {
  // Most relevant memories for current task
  memories: MemoryObject[];

  // Constraints that must not be violated
  constraints: MemoryObject[];

  // Recent decisions in this area
  recentDecisions: MemoryObject[];

  // Known issues to avoid
  knownIssues: MemoryObject[];

  // Token budget used
  tokenCount: number;
}

// Generation based on current context
const pack = await generateContextPack({
  currentFile: 'src/auth/middleware.ts',
  recentFiles: ['src/auth/jwt.ts', 'src/config.ts'],
  taskDescription: 'Add rate limiting to auth endpoints',
  tokenBudget: 2000,
});
```

---

## What Sets Alexandria Apart

### 1. Built for Code, Not Conversation

| Feature | Mem0/Zep | Alexandria |
|---------|----------|------------|
| Entity model | People, places, things | Files, functions, packages |
| Verification | None | Git-aware staleness |
| Memory types | Generic facts | Decisions, constraints, fixes |
| Anchoring | None | Code references |
| Session model | Conversation threads | Task completion units |

### 2. Decision-First, Not Fact-First

**Mem0 stores:**
```json
{
  "entity": "user",
  "fact": "prefers dark mode"
}
```

**Alexandria stores:**
```json
{
  "type": "decision",
  "content": "Use Tailwind dark: variants instead of CSS variables",
  "rationale": "Tailwind's dark mode is more maintainable and works with our existing setup",
  "alternatives_considered": ["CSS custom properties", "styled-components themes"],
  "code_refs": ["tailwind.config.js:12", "src/styles/globals.css:1"]
}
```

### 3. Failure-Aware

Alexandria explicitly tracks what **didn't work**:

```typescript
// After a failed attempt
await alexandria.add({
  type: 'failed_attempt',
  content: 'Tried using Prisma with edge runtime',
  reason: 'Prisma client requires Node.js APIs not available in edge',
  context: 'Deploying to Cloudflare Workers',
  alternative: 'Using Drizzle ORM which supports edge runtime'
});
```

This prevents the agent from:
- Suggesting the same failed approach
- Wasting time on known dead-ends
- Repeating the same mistakes

### 4. Constraint Enforcement

Hard rules are first-class citizens:

```typescript
// Constraints are always included in context
const constraints = await alexandria.getConstraints();

// Example constraints:
// - "Never use eval() or new Function()"
// - "All API endpoints must validate input with zod"
// - "Database migrations must be backward compatible"
```

### 5. Human-in-the-Loop Review

Memories aren't auto-accepted - they're **pending until reviewed**:

```bash
$ alex list --pending

┌─────────────────────────────────────────────────────────────────┐
│ PENDING MEMORIES (3)                                            │
├─────────────────────────────────────────────────────────────────┤
│ [decision] Use connection pooling for database                  │
│ Extracted: 2 hours ago | Confidence: 0.85                       │
│ [approve] [reject] [edit]                                       │
├─────────────────────────────────────────────────────────────────┤
│ [known_fix] Redis timeout fix: increase socket timeout to 30s  │
│ Extracted: 3 hours ago | Confidence: 0.92                       │
│ [approve] [reject] [edit]                                       │
└─────────────────────────────────────────────────────────────────┘
```

This ensures:
- Quality control over extracted memories
- Developer oversight of what agents learn
- Correction of misunderstood context

### 6. Local-First, Privacy-Preserving

```
┌────────────────────────────────────────────────────────┐
│                  YOUR MACHINE                          │
│                                                        │
│  ┌──────────────┐    ┌──────────────────────────────┐ │
│  │   Project    │───▶│  ~/.alexandria/              │ │
│  │  Codebase    │    │  └── project-hash/           │ │
│  └──────────────┘    │      ├── memories.db         │ │
│                      │      ├── events.db           │ │
│                      │      └── vector.idx          │ │
│                      └──────────────────────────────┘ │
│                                                        │
│  ┌──────────────┐                                      │
│  │ Claude Code  │ ◀──── Context pack                  │
│  │   / Agent    │ ────▶ New events                    │
│  └──────────────┘                                      │
│                                                        │
└────────────────────────────────────────────────────────┘

❌ No data leaves your machine
❌ No cloud dependencies
❌ No vendor lock-in
```

---

## Why Coding-Specific Memory Wins

### 1. Higher Precision

Generic memory retrieves based on semantic similarity.
Coding memory retrieves based on **code context**:

```
Query: "How do we handle authentication?"

Generic Memory:
→ "User prefers simple login flows"
→ "Authentication is important for security"
→ [vague, unhelpful results]

Alexandria:
→ [decision] "Using JWT with 15-min access / 7-day refresh tokens"
   Code refs: src/auth/jwt.ts:23, src/middleware/auth.ts:45
→ [constraint] "All auth endpoints must use HTTPS"
→ [known_fix] "Token refresh race condition fixed with mutex"
```

### 2. Verifiable Accuracy

Code memories can be checked against the codebase:

```typescript
// Before using a memory, verify it's still accurate
const memory = await getMemory('jwt-config');
const isStale = await checkStaleness(memory);

if (isStale) {
  // Don't use outdated information
  flagForReview(memory);
  return null;
}
```

Generic memory systems have no verification mechanism.

### 3. Task-Relevant Context

When working on a specific file, Alexandria provides **focused context**:

```typescript
// Agent is editing src/payments/stripe.ts
const context = await alexandria.pack({
  currentFile: 'src/payments/stripe.ts',
  level: 'file',
  budget: 1500,
});

// Returns:
// - Decisions about payment processing
// - Constraints on handling financial data
// - Known issues with Stripe integration
// - Recent changes to payment code
```

### 4. Learning from Mistakes

Coding agents make mistakes. Alexandria ensures they don't repeat them:

```typescript
// Agent previously tried:
// 1. Using fetch() in Node.js (failed - needed node-fetch)
// 2. Using node-fetch with ESM (failed - CJS/ESM conflict)
// 3. Using native fetch in Node 18+ (succeeded)

// Next time agent encounters HTTP client question:
const context = await alexandria.search('http client node');
// Returns failed_attempts + final solution
// Agent skips directly to working solution
```

### 5. Institutional Knowledge Preservation

When developers leave, their knowledge stays:

```bash
# All decisions with rationale are preserved
$ alex list --type decision

"Use Postgres over MySQL for GIS features"
  Rationale: PostGIS provides superior spatial indexing
  Date: 6 months ago
  Author: @departed-dev

# Future agents/developers understand WHY
```

---

## Comparison Summary

| Capability | Generic Memory (Mem0/Zep) | Alexandria |
|------------|---------------------------|------------|
| **Optimized for** | Conversations | Coding tasks |
| **Entity model** | People, places, dates | Code symbols, files, packages |
| **Memory types** | Facts, preferences | Decisions, constraints, fixes, failures |
| **Verification** | None | Git-aware staleness |
| **Code anchoring** | No | Yes (file:line:symbol) |
| **Failure tracking** | No | Yes (failed_attempts) |
| **Hard constraints** | No | Yes (constraint type) |
| **Human review** | Optional | Built-in workflow |
| **Privacy** | Cloud-dependent | Local-first |
| **Session model** | Conversation thread | Task completion unit |
| **Retrieval** | Semantic similarity | Code context + task relevance |

---

## Conclusion

Generic conversational memory systems optimize for a fundamentally different problem than coding agent memory. They excel at:
- Remembering personal preferences
- Tracking social relationships
- Maintaining conversation continuity

But they fail at:
- Grounding memories in code
- Tracking technical decisions with rationale
- Learning from failures
- Enforcing hard constraints
- Verifying accuracy against source code
- Detecting staleness as code evolves

**Alexandria is purpose-built for coding agents** because coding agents need:
1. Code-anchored memories that can be verified
2. Decision tracking with rationale
3. Explicit failure tracking
4. Constraint enforcement
5. Git-aware staleness detection
6. Human-in-the-loop quality control

The LoCoMo benchmark measures conversational memory - a different problem than coding memory. A fair comparison would benchmark on:
- Remembering project decisions across sessions
- Avoiding repeated mistakes
- Maintaining accurate knowledge as code changes
- Providing relevant context for specific files/tasks

This is the benchmark Alexandria is built to win.

---

*Alexandria: Memory for Coding Agents*
