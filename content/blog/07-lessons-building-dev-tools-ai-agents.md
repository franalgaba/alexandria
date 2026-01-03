# Lessons from Building Dev Tools for AI Agents

> "We spent months building memory for coding agents. Here's what we wish we knew on day one."

Building tools for AI agents is a new discipline. The patterns are still emerging. The failure modes are surprising. The constraints are different from traditional software.

After months building Alexandria, here's what we learned—sometimes the hard way.

## Lesson 1: Agents Are Impatient

Every millisecond of latency compounds. A 100ms delay on every tool call becomes seconds of waiting across a session. Users notice. Agents feel sluggish. Trust erodes.

**The symptoms:**
- Users complain about slowness
- Agents seem to "pause" mid-thought
- Session lengths decrease

**The cause:** We started by processing events synchronously. Capture event, generate embedding, write to database, respond. Clean and simple. Also: 200-400ms of blocking per event.

**The fix:** Fire-and-forget architecture.

```bash
# Bad: Synchronous processing
alex ingest --type user_prompt "$CONTENT"  # Blocks until complete

# Good: Background processing
(alex ingest --type user_prompt "$CONTENT" &)  # Returns immediately
exit 0
```

Every hook should return in under 10ms. Everything else happens in the background.

**The principle:** Never block the agent's main loop. If something takes more than 10ms, it happens asynchronously.

## Lesson 2: Context Windows Are Currency

Tokens are expensive—not just in API costs, but in attention. Every token you inject competes with the user's prompt and the agent's reasoning space.

**The symptoms:**
- Agent ignores injected context
- Responses become shorter
- Important information gets lost

**The cause:** We initially injected 2000+ tokens of context on every session start. Comprehensive! Also: overwhelming. The agent couldn't process it all.

**The fix:** Progressive disclosure with token budgets.

```typescript
const DISCLOSURE_LEVELS = {
  minimal: 200,    // Just constraints
  task: 500,       // + relevant memories
  deep: 1500       // + related context + history
};

function generateContextPack(level: Level): string {
  const budget = DISCLOSURE_LEVELS[level];
  const content = [];
  let used = 0;

  // Constraints first (always)
  const constraints = getConstraints();
  used += tokenCount(constraints);
  content.push(constraints);

  // Relevant memories (if budget allows)
  if (used < budget) {
    const relevant = getRelevantMemories(budget - used);
    content.push(relevant);
  }

  return content.join('\n');
}
```

Default to minimal. Expand when asked. Quality over quantity.

**The principle:** Treat context window space like RAM—finite and precious.

## Lesson 3: Agents Make Mistakes

LLM extraction is confident but not always correct. Agents will extract "decisions" that were just brainstorming. They'll create memories for transient debugging. They'll misunderstand context.

**The symptoms:**
- Low-quality memories accumulate
- Retrieval degrades as noise increases
- Users stop trusting the system

**The cause:** We initially auto-approved LLM-extracted memories. The model is smart, right? Why add friction?

**The fix:** Everything extracted goes to a pending queue.

```typescript
async function createMemory(candidate: MemoryCandidate) {
  return {
    ...candidate,
    reviewStatus: 'pending',  // Always pending
    reviewedAt: null,
    createdAt: new Date()
  };
}

// Separate review workflow
async function review(memory: Memory, decision: 'approve' | 'reject') {
  memory.reviewStatus = decision === 'approve' ? 'approved' : 'rejected';
  memory.reviewedAt = new Date();
  await save(memory);
}
```

Make review fast. One-key approve/reject. Batch operations. But always require human confirmation.

**The principle:** Confidence scores aren't confidence. Human review is essential.

## Lesson 4: Benchmarks Lie

We implemented LoCoMo and scored 39%. Mem0 scores 67%. Panic? No.

**The symptoms:**
- Benchmark scores don't match user satisfaction
- Optimizing for benchmarks degrades real-world performance
- Different benchmarks tell different stories

**The cause:** LoCoMo measures conversational memory. We're building coding memory. Different optimization targets.

**The fix:** Build your own evaluation.

```typescript
interface CodingMemoryEval {
  decisionRecall: TestCase[];      // Can we recall decisions?
  mistakeAvoidance: TestCase[];    // Do we prevent repeated errors?
  stalenessDetection: TestCase[];  // Do we catch outdated memories?
  constraintEnforcement: TestCase[]; // Are constraints surfaced?
}

// Collect from real usage
function recordTestCase(session: Session) {
  // When user corrects agent, record as test case
  // When agent applies correct memory, record as test case
  // When stale memory causes issues, record as test case
}
```

Generic benchmarks test generic capabilities. Your application has specific needs.

**The principle:** Measure what matters to your users, not what matters to researchers.

## Lesson 5: Simplicity Wins

Every dependency is a potential failure. Every abstraction is a maintenance burden. Every feature is code to debug.

**The symptoms:**
- Complex setup frustrates users
- Weird bugs from dependency interactions
- Features nobody uses bloating the system

**The cause:** We initially considered Redis for queuing, Postgres for storage, Elasticsearch for search. Enterprise-grade! Also: massive ops overhead.

**The fix:** SQLite for everything.

```
What we considered:
├── Postgres (database)
├── Redis (queue, cache)
├── Elasticsearch (search)
├── S3 (blob storage)
└── Kubernetes (orchestration)

What we shipped:
└── SQLite (everything)
```

SQLite gives us:
- Full SQL with joins and transactions
- FTS5 for full-text search
- WAL mode for concurrent access
- Zero configuration
- Single-file portability

**The principle:** KISS applies 10x to AI tools. Every moving part is a failure mode.

## Lesson 6: The Agent Knows Things

AI agents have rich context already. They've read the files. They know the codebase. They understand the task. Don't make them repeat work.

**The symptoms:**
- Duplicate information in context
- Redundant tool calls
- Wasted tokens

**The cause:** We initially had memory search separate from the agent's exploration. The agent would read a file, then search memory for the same file, getting duplicate context.

**The fix:** Work with the agent, not around it.

```markdown
## Session Start Context

You have access to Alexandria memory. Relevant memories for your current task:

[memories here]

You don't need to search memory unless looking for something specific not shown above.
The following files have associated memories: [list]
```

Inject what's relevant. Don't duplicate what the agent already knows.

**The principle:** The agent's context window is already full of useful information. Supplement, don't repeat.

## Lesson 7: Users Don't Trust Magic

Black-box AI extraction feels unreliable. Users want to understand where memories come from and why they're relevant.

**The symptoms:**
- Users second-guess recommendations
- Low engagement with memory features
- Requests to "turn off the AI stuff"

**The cause:** We initially showed memories without provenance. "Here's a relevant memory" without explaining how we found it or why we think it's relevant.

**The fix:** Show your work.

```bash
$ alex show abc123
Memory: Use SQLite for local-first storage
Type: decision
Status: active ✓
Confidence: grounded (has code refs + approved)

Created: 2024-01-15 during session xyz789
Evidence: User prompt "We need local-first storage"
          Tool output: Evaluated SQLite vs Postgres
Code refs: src/stores/connection.ts:42 (verified 2 days ago)

Accessed: 7 times (last: today)
Outcome: 6 helpful, 1 neutral
```

Every field is explainable. Every decision has provenance.

**The principle:** Transparency builds trust. Show sources, explain relevance, allow editing.

## Lesson 8: Graceful Degradation Is Required

Things fail. Networks drop. Databases lock. Processes crash. The question isn't whether failure happens—it's how you handle it.

**The symptoms:**
- Agent sessions break when memory unavailable
- Lost data from interrupted operations
- Users forced to restart

**The cause:** We initially treated memory as a critical dependency. No memory access = error.

**The fix:** Layer defensive patterns:

```bash
#!/bin/bash
# Hook pattern: triple-layer defense

# 1. Check availability
if ! command -v alex &> /dev/null; then
    exit 0  # Not installed, skip gracefully
fi

# 2. Timeout protection
timeout 5 alex ingest ... || true

# 3. Background execution
(alex ingest ... &)

# 4. Always succeed
exit 0
```

If memory fails, the session continues without it. Data might be lost, but the user isn't blocked.

**The principle:** Better to lose memory than break the session.

## Lesson 9: Dogfooding Is Essential

We use Alexandria to build Alexandria. This isn't just dogfooding—it's essential quality assurance.

**The symptoms:**
- Features that don't work in practice
- Edge cases that never get tested
- UX issues that slip through

**The cause:** Building features without using them. Testing in isolation, not in real workflows.

**The fix:** Use it constantly.

```bash
# Our daily workflow
alex session start
# ... work on Alexandria ...
alex checkpoint  # When making decisions
# ... continue working ...
alex search "embedding"  # When looking for prior art
# ... continue ...
alex session end
```

Every bug we hit, users would hit. Every friction point we feel, users would feel.

**The principle:** If you don't use your own tool, you don't understand it.

## Lesson 10: Start Small, Stay Focused

Scope creep is deadly. Every feature is a commitment. Every edge case is maintenance.

**The symptoms:**
- Features half-finished
- Bugs in rarely-used code paths
- Difficulty explaining what the tool does

**The cause:** Trying to solve every memory problem at once.

**The fix:** Ruthless prioritization.

```
Features we could build:
- Cross-device sync ❌ (later)
- Team collaboration ❌ (later)
- Memory visualization ❌ (later)
- IDE plugins ❌ (later)
- API access ❌ (later)

Features we built:
- Local storage ✓
- Checkpoint extraction ✓
- Claude Code integration ✓
- Search and retrieval ✓
- Staleness detection ✓
```

Five features, done well, beat twenty features done poorly.

**The principle:** Finish what you start before starting something new.

---

Building tools for AI agents is new territory. The patterns are still emerging. We've made a lot of mistakes. We'll make more.

What we've shared here works for Alexandria. Your context is different. But the underlying principles—speed, simplicity, transparency, graceful failure—seem broadly applicable.

We hope this saves you some of the debugging sessions we suffered through.

*The source is at [github.com/your-org/alexandria](https://github.com/your-org/alexandria). The mistakes are in the git history.*
