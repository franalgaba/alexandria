# The LoCoMo Benchmark Deep Dive

> "We ran Alexandria against the same benchmark Mem0 uses. Here's exactly what happened."

When you build a memory system, you need to measure it. The obvious choice is to use an existing benchmark. LoCoMo—Long-term Conversational Memory—is what Mem0 and other memory systems cite in their evaluations.

We implemented LoCoMo. We ran the evaluation. We learned that benchmarks reveal as much about what you *didn't* build as what you did.

## What Is LoCoMo?

LoCoMo is a benchmark created by Snap Research for evaluating long-term conversational memory. The dataset contains:

- **10 conversations** spanning multiple sessions
- **272 sessions** total
- **5,882 messages**
- **200 evaluation questions** across 5 categories

The categories test different aspects of memory:

| Category | Questions | Tests |
|----------|-----------|-------|
| Single-session | 40 | Remember details from one session |
| Multi-session | 40 | Connect information across sessions |
| Temporal | 40 | Understand time-based ordering |
| Coreference | 40 | Resolve "he", "that project", etc. |
| Knowledge graph | 40 | Synthesize relationships |

The benchmark provides ground truth answers and evaluation scripts. You implement a "provider" that stores messages and answers questions.

## Our Evaluation Setup

We implemented a LoCoMo provider for Alexandria:

```typescript
interface LoCoMoProvider {
  // Store a conversation message
  storeMessage(
    conversationId: string,
    sessionId: string,
    message: Message
  ): Promise<void>;

  // Answer a question about the conversation
  answerQuestion(
    conversationId: string,
    question: string
  ): Promise<string>;
}
```

For fair comparison, we used the same metrics as Mem0's published evaluation:

**Haystack Hit Rate:** Did retrieval find the relevant session? This measures pure retrieval quality before answer generation.

**J-Score:** LLM-as-judge answer correctness. A Claude model compares the generated answer to ground truth and scores accuracy.

We ran both systems on the same questions with the same judge.

## The Results

| System | J-Score | Haystack Hit Rate |
|--------|---------|-------------------|
| Mem0 | 66.9% | 78.2% |
| Alexandria | 39.0% | 52.3% |
| Gap | -27.9pp | -25.9pp |

This wasn't close. Mem0 outperformed Alexandria by nearly 28 percentage points on answer quality.

Before explaining why, let's be clear: **this is a valid result**. We're not arguing the benchmark is wrong. We're explaining why our architecture produces these numbers.

## Why We Score Lower

### 1. No Memory Abstraction Layer

Mem0 extracts and abstracts facts from conversations:

```
User: "I went to Paris last summer with my wife Emma"
Mem0 Memory: {
  entities: ["user", "Emma"],
  relationship: "married to",
  facts: ["visited Paris", "has wife named Emma"],
  time: "last summer"
}
```

Alexandria stores raw messages:

```
Alexandria Event: {
  type: "user_prompt",
  content: "I went to Paris last summer with my wife Emma",
  timestamp: "2024-06-15T10:30:00Z"
}
```

When asked "What is the user's wife's name?", Mem0 has an indexed fact: `{wife: "Emma"}`. Alexandria has to search raw text and hope "wife Emma" appears in a retrievable chunk.

For conversational memory, abstraction helps. For coding memory, we're skeptical—abstracted code facts tend to lose critical context.

### 2. No Entity Graph

Mem0 builds a knowledge graph of entities and relationships:

```
User ─── married_to ─── Emma
  │
  └── visited ─── Paris
                    │
                    └── when: "last summer"
```

Graph traversal finds connected information even without keyword matches. "Tell me about the user's trip" retrieves Paris through the relationship, not text search.

Alexandria uses flat FTS5 + vector search. No graph. Relationships must be explicit in the query.

### 3. Weak Temporal Reasoning

LoCoMo temporal questions test ordering:

> "Did the user visit Paris before or after starting the new job?"

This requires:
1. Find the Paris visit
2. Find the job start
3. Compare timestamps
4. Reason about ordering

Our retrieval finds both events but struggles to answer temporal comparisons. We don't have explicit temporal reasoning—just timestamps on events.

### 4. Coreference Requires Context

Consider:

> Session 5: "She said the project would be delayed"
> Question: "Who said the project would be delayed?"

"She" refers to someone mentioned earlier, maybe in session 3. Without coreference resolution, we search for "she" and "project" and "delayed"—which doesn't find the referent.

Mem0's entity extraction resolves "she" → "Emma" at storage time. We don't.

## Features We Tried

We didn't just accept 39%. We experimented with several retrieval enhancements:

### Dynamic RRF Weights

Reciprocal Rank Fusion combines FTS5 and vector search results. We tried dynamically adjusting weights based on query type:

```typescript
function getRRFWeights(query: Query): Weights {
  if (query.hasNamedEntities) {
    return { fts: 0.7, vector: 0.3 }; // Prefer exact match
  }
  if (query.isSemanticQuestion) {
    return { fts: 0.3, vector: 0.7 }; // Prefer meaning
  }
  return { fts: 0.5, vector: 0.5 }; // Balanced
}
```

**Result:** +1% J-Score. Not nothing, but not significant.

### HyDE (Hypothetical Document Embeddings)

Generate a hypothetical answer, embed it, search for similar content:

```typescript
async function hydeSearch(question: string): Promise<Results> {
  // Generate hypothetical answer
  const hypothesis = await llm.complete(
    `Answer this question briefly: ${question}`
  );

  // Embed the hypothesis
  const embedding = await embed(hypothesis);

  // Search for similar content
  return vectorSearch(embedding);
}
```

**Result:** +2% J-Score, but 40x latency. Every search requires an LLM call. Not viable for interactive use.

### LLM Reranking

Use Claude to score and reorder search results:

```typescript
async function rerankResults(
  question: string,
  results: Result[]
): Promise<Result[]> {
  const scored = await llm.complete(`
    Score each result's relevance to the question (0-10):
    Question: ${question}
    Results: ${JSON.stringify(results)}
  `);

  return sortByScore(results, scored);
}
```

**Result:** +5% J-Score, but 300x latency. Every search now costs $0.02 and takes 2-3 seconds. Impractical.

### Session Grouping

Group messages by session instead of treating them individually:

```typescript
function groupBySession(events: Event[]): SessionGroup[] {
  // Group adjacent messages from same session
  // Return as coherent chunks
}

async function search(query: string): Promise<Results> {
  const groups = await searchSessionGroups(query);
  return groups.flatMap(g => g.messages);
}
```

**Result:** +8.5% J-Score with *zero additional latency*.

This was our biggest win. The LLM judge needs conversation context to score answers. Scattered individual messages lack coherence. Session grouping preserves the natural structure of conversations.

## The Key Insight

Our best enhancement (session grouping) improved results by 8.5 points. That brings us from 39% to 47.5%—still 19 points behind Mem0.

The gap isn't bridgeable with retrieval tricks. It's architectural.

Mem0 is optimized for conversational memory:
- Entity extraction
- Relationship graphs
- Fact abstraction
- Temporal reasoning

Alexandria is optimized for coding memory:
- Code references
- Decision rationale
- Staleness detection
- Constraint enforcement

**LoCoMo measures conversational memory. We're building coding memory. Different problem, different benchmark needed.**

## What a Coding Memory Benchmark Would Test

If we designed a benchmark for coding agent memory, it would test:

### Decision Recall Across Sessions

> Session 1: "Use SQLite because we need local-first storage with no ops overhead"
> Session 5: "What database should we use and why?"
> Expected: "SQLite, because local-first with no ops overhead"

Tests: Can the system recall decisions with their rationale?

### Mistake Avoidance

> Session 1: "Web Workers don't work for PDF generation due to browser security restrictions"
> Session 5: Agent proposes Web Workers for PDF generation
> Expected: Warning about known failure

Tests: Does the system prevent repeating known mistakes?

### Staleness Detection

> Session 1: "Authentication is in src/auth/jwt.ts line 42"
> Reality: File was refactored, line 42 is now something else
> Query: "Where is authentication?"
> Expected: "Warning: referenced code has changed. Previously src/auth/jwt.ts:42"

Tests: Can the system detect when its knowledge is outdated?

### Constraint Enforcement

> Memory: "Never commit files matching *.env"
> Agent: Attempts to commit config.env
> Expected: Block or warning

Tests: Are hard constraints always surfaced and enforced?

### Code Reference Accuracy

> Query: "Where is the rate limiting implemented?"
> Memory: "Rate limiting in src/middleware/rateLimit.ts, function createRateLimiter"
> Expected: File path + symbol, verifiable against current code

Tests: Are code references precise and verifiable?

## Building Our Own Evaluation

We can't wait for an ideal benchmark. We're building our own evaluation:

```typescript
interface CodingMemoryEval {
  // Decision recall
  decisionRecall: TestCase[]; // Can we recall decisions + rationale?

  // Mistake avoidance
  mistakeAvoidance: TestCase[]; // Do we warn about known failures?

  // Staleness detection
  stalenessDetection: TestCase[]; // Do we catch outdated references?

  // Constraint enforcement
  constraintEnforcement: TestCase[]; // Are constraints always surfaced?

  // Code reference accuracy
  codeReferenceAccuracy: TestCase[]; // Are refs precise and verifiable?
}
```

We're collecting test cases from real Alexandria usage. When we have enough data, we'll publish the benchmark.

## Honest Assessment

LoCoMo revealed real gaps in Alexandria:

1. **No abstraction layer** — We store raw events, not extracted facts
2. **No entity graph** — Relationships aren't explicitly modeled
3. **Weak temporal reasoning** — Timestamps exist but aren't queryable
4. **No coreference resolution** — "She" stays "she"

These aren't bugs—they're conscious trade-offs. For coding memory, we believe:

- Raw events preserve context that abstraction loses
- Code references matter more than entity graphs
- Staleness detection matters more than temporal queries
- Constraints matter more than coreference

But LoCoMo doesn't test any of that. So we score 39%.

## Recommendations

If you're evaluating memory systems:

**1. Understand what benchmarks measure.** LoCoMo tests conversational memory. If you're building something else, the scores may not predict real-world performance.

**2. Build application-specific evaluation.** Generic benchmarks test generic capabilities. Your application has specific requirements. Test those.

**3. Measure what matters.** For coding memory, we care about decision recall, mistake avoidance, and staleness detection. LoCoMo doesn't measure these.

**4. Be honest about trade-offs.** We score 39% on LoCoMo. We publish that number. We explain why. Transparency builds trust.

## The Bottom Line

LoCoMo is a rigorous benchmark for conversational memory. Alexandria isn't a conversational memory system. The 28-point gap to Mem0 reflects architectural differences, not quality deficits.

We're building a coding memory benchmark. Until then, LoCoMo shows us what we *didn't* optimize for—and that's useful information too.

---

The LoCoMo evaluation code is in `bench/locomo/`. Our provider implementation is in `bench/locomo/alexandria-provider.ts`. Run it with `bun bench:locomo` if you want to reproduce our results.

*Benchmarks tell you what you optimized for. Low scores on the wrong benchmark might be a feature, not a bug.*
