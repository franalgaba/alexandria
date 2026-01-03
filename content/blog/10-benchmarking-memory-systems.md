# Benchmarking Memory Systems: What We Learned

> "We implemented 8 retrieval techniques. Only one was worth keeping."

When you build a retrieval system, you make assumptions. Vector search finds semantic matches. Reranking improves precision. Query expansion helps ambiguous queries.

Then you benchmark, and reality intrudes.

We systematically tested eight retrieval techniques on the LoCoMo benchmark. The results surprised us. Expensive features often underperformed. Simple techniques sometimes won. Here's our data.

## The Setup

We used LoCoMo as our benchmark:
- 10 conversations, 272 sessions, 5,882 messages
- 200 evaluation questions across 5 categories
- LLM-as-judge scoring (J-Score)
- Latency measurement for each technique

For each configuration, we ran the full evaluation and measured:
1. **J-Score:** LLM judge's assessment of answer correctness (0-100%)
2. **Haystack Hit Rate:** Did we retrieve the relevant session? (0-100%)
3. **Latency:** End-to-end retrieval time (p50, p99)

Our baseline was simple FTS5 search with no enhancements.

## The Techniques We Tested

### 1. FTS5 (Baseline)

SQLite's full-text search with BM25 ranking:

```sql
SELECT m.*, bm25(memory_fts) as score
FROM memory_objects m
JOIN memory_fts ON m.rowid = memory_fts.rowid
WHERE memory_fts MATCH ?
ORDER BY score
LIMIT 20;
```

Pure lexical search. Fast. Simple.

### 2. Entity Matching

Extract named entities from queries and boost matches:

```typescript
async function entitySearch(query: string): Promise<Results> {
  const entities = await extractEntities(query);
  // ["Emma", "Paris", "last summer"]

  const results = await fts5Search(query);

  // Boost results containing extracted entities
  return results.map(r => ({
    ...r,
    score: r.score * entityBoost(r.content, entities)
  })).sort((a, b) => b.score - a.score);
}
```

### 3. Vector Search

Embedding similarity using sentence transformers:

```typescript
async function vectorSearch(query: string): Promise<Results> {
  const queryEmbedding = await embed(query);
  const similar = await vectorIndex.search(queryEmbedding, 50);

  return db.query(`
    SELECT * FROM memories WHERE id IN (?)
  `, [similar.map(s => s.id)]);
}
```

### 4. Hybrid (FTS5 + Vector)

Reciprocal Rank Fusion to combine lexical and semantic:

```typescript
async function hybridSearch(query: string): Promise<Results> {
  const ftsResults = await fts5Search(query);
  const vecResults = await vectorSearch(query);

  return reciprocalRankFusion([
    { results: ftsResults, weight: 0.5 },
    { results: vecResults, weight: 0.5 }
  ]);
}
```

### 5. HyDE (Hypothetical Document Embeddings)

Generate a hypothetical answer, embed it, search for similar content:

```typescript
async function hydeSearch(query: string): Promise<Results> {
  // Generate hypothetical answer
  const hypothesis = await llm.complete(
    `Answer this question briefly: ${query}`
  );

  // Embed the hypothesis (not the query)
  const embedding = await embed(hypothesis);

  // Search for similar content
  return vectorSearch(embedding);
}
```

### 6. LLM Reranking

Use Claude to score and reorder top results:

```typescript
async function rerankedSearch(query: string): Promise<Results> {
  // Get initial results
  const candidates = await hybridSearch(query);

  // Have LLM score relevance
  const scored = await llm.complete(`
    Score each result's relevance to "${query}" from 0-10:
    ${JSON.stringify(candidates.slice(0, 20))}
  `);

  return reorderByScore(candidates, scored);
}
```

### 7. Dynamic RRF Weights

Adjust fusion weights based on query characteristics:

```typescript
function getDynamicWeights(query: Query): Weights {
  if (query.hasExactPhrases) {
    return { fts: 0.8, vector: 0.2 };  // Prefer exact match
  }
  if (query.isConceptual) {
    return { fts: 0.2, vector: 0.8 };  // Prefer semantic
  }
  return { fts: 0.5, vector: 0.5 };    // Balanced
}
```

### 8. Session Grouping

Return messages grouped by session, not individually:

```typescript
async function sessionGroupedSearch(query: string): Promise<Results> {
  const messages = await hybridSearch(query);

  // Group by session, keep session context
  const sessions = groupBySession(messages);

  // Return full session chunks
  return sessions.map(s => ({
    content: s.messages.map(m => m.content).join('\n'),
    sessionId: s.id,
    score: Math.max(...s.messages.map(m => m.score))
  }));
}
```

## The Results

| Configuration | J-Score | Haystack HR | Latency (p50) |
|--------------|---------|-------------|---------------|
| Baseline (FTS5) | 27.5% | 45.2% | 7ms |
| + Entity Matching | 28.0% | 46.1% | 25ms |
| + Vectors | 29.0% | 48.3% | 200ms |
| + Dynamic RRF | 29.5% | 49.0% | 205ms |
| + HyDE | 30.0% | 51.2% | 400ms |
| + Reranking | 32.0% | 55.8% | 1800ms |
| + Session Grouping | 36.0% | 61.5% | 7ms |
| All Together | 39.0% | 65.2% | 2000ms |

The numbers tell a clear story. Let's analyze.

## The Surprises

### Session Grouping Beats Everything

The single biggest improvement came from session grouping: **+8.5 percentage points** with **zero additional latency**.

Why? The LLM judge evaluates answer correctness. When it receives scattered individual messages, it lacks conversation context. When it receives coherent session chunks, it can understand the full dialogue.

```
Before: "Yes, that sounds good" (isolated message)
After: User: "Should we use SQLite?"
       Assistant: "Yes, that sounds good" (with context)
```

The same content, presented better.

### Vector Search Barely Helps

Adding vector search improved J-Score by just 1.5 points while adding 193ms of latency. The marginal gain didn't justify the cost.

For conversational memory with natural language, FTS5's lexical matching captures most of the signal. Vector search adds semantic matching for synonyms and paraphrases, but that's a small fraction of queries.

### HyDE Isn't Worth the Latency

HyDE improved results by 2.5 points but added 200ms per query. That's an LLM call for every search.

In theory, HyDE helps by generating an "ideal answer" and finding similar content. In practice, the latency cost is prohibitive for interactive use.

Maybe useful for batch processing. Not for real-time retrieval.

### Reranking Is Too Slow

LLM reranking added 5 points but took 1.8 seconds. At $0.02 per query, it's also expensive.

For high-stakes retrieval (legal, medical), reranking might make sense. For coding memory, users won't wait 2 seconds for each search.

### Dynamic RRF: Marginal Gains

Adjusting fusion weights based on query type improved results by 0.5 points. The effort to classify queries and tune weights wasn't justified.

## The Recommendations

Based on our data, here's what we actually ship:

### Default Configuration

```typescript
async function search(query: string): Promise<Memory[]> {
  // FTS5 search
  const ftsResults = await fts5Search(query);

  // Group by session (cheap, big impact)
  const grouped = groupBySession(ftsResults);

  return grouped;
}
```

Simple. Fast. Effective.

### When to Add Vectors

Add vector search when:
- Queries frequently use synonyms not in your content
- Semantic similarity matters more than keyword match
- You have resources for embedding generation and index maintenance

```typescript
async function searchWithVectors(query: string): Promise<Memory[]> {
  const ftsResults = await fts5Search(query);
  const vecResults = await vectorSearch(query);
  const hybrid = reciprocalRankFusion([ftsResults, vecResults]);
  return groupBySession(hybrid);
}
```

In our testing, vectors helped for about 15% of queries. For the other 85%, FTS5 was sufficient.

### Skip Reranking for Interactive Use

Reranking only makes sense when:
- Latency isn't critical (batch processing)
- Accuracy is paramount (high-stakes decisions)
- You can afford the API costs

For typical coding memory retrieval, skip it.

### Always Use Session Grouping

There's no reason not to group by session. It's zero-cost and provides significant improvement.

## Per-Category Breakdown

Results varied by question category:

| Category | Baseline | + Session Grouping | Delta |
|----------|----------|-------------------|-------|
| Single-session | 32.0% | 45.0% | +13.0pp |
| Multi-session | 22.5% | 30.0% | +7.5pp |
| Temporal | 18.0% | 25.5% | +7.5pp |
| Coreference | 25.0% | 35.0% | +10.0pp |
| Knowledge graph | 40.0% | 44.5% | +4.5pp |

Single-session and coreference questions benefited most from session grouping. These categories require conversation context to answer correctly.

Knowledge graph questions showed the smallest improvement—they require synthesizing relationships that grouping doesn't help with.

## Cost Analysis

| Configuration | Latency | Cost per 1K queries | Notes |
|---------------|---------|---------------------|-------|
| FTS5 only | 7ms | $0 | Database only |
| + Vectors | 200ms | $0.50 | Embedding inference |
| + HyDE | 400ms | $15 | LLM call per query |
| + Reranking | 1800ms | $20 | LLM call for rerank |

For a system handling 10K queries/month:
- FTS5 + Session Grouping: $0
- With Vectors: $5
- With HyDE: $150
- With Reranking: $200

The cost difference is dramatic. Most of the value comes from free techniques.

## What We Learned

### 1. Presentation Matters

Session grouping doesn't change *what* we retrieve—it changes *how* we present it. The judge (LLM or human) can only evaluate what it can understand. Coherent presentation improves evaluation.

### 2. Latency Is a Feature

A 2-second search feels broken. A 10ms search feels instant. User perception of quality correlates with speed, independent of actual accuracy.

### 3. Simple Baselines Are Strong

FTS5 with good tokenization handles most queries well. The 80/20 rule applies: 80% of the value from 20% of the complexity.

### 4. Benchmark Your Specific Use Case

LoCoMo is conversational memory. Our actual use case is coding memory. The techniques that help for one may not help for the other.

### 5. Measure, Don't Assume

We assumed reranking would be transformative. We assumed vectors were essential. Data showed otherwise.

## Building Your Own Evaluation

Generic benchmarks have limits. Here's how to build task-specific evaluation:

```typescript
interface EvalCase {
  id: string;
  query: string;
  expectedMemories: string[];  // Ground truth memory IDs
  context: string;              // Why this query matters
}

async function evaluateRetrieval(
  searchFn: SearchFn,
  cases: EvalCase[]
): Promise<EvalResults> {
  const results = [];

  for (const testCase of cases) {
    const retrieved = await searchFn(testCase.query);
    const retrievedIds = retrieved.map(r => r.id);

    const precision = intersection(retrievedIds, testCase.expectedMemories).length
      / retrievedIds.length;
    const recall = intersection(retrievedIds, testCase.expectedMemories).length
      / testCase.expectedMemories.length;

    results.push({
      caseId: testCase.id,
      precision,
      recall,
      f1: 2 * precision * recall / (precision + recall)
    });
  }

  return aggregate(results);
}
```

Collect cases from real usage:
- When users search and find what they need → positive case
- When users search and can't find it → gap to address
- When retrieved memories lead to errors → negative case

## The Bottom Line

We tested 8 retrieval techniques. Here's what we ship:

| Technique | Status | Reason |
|-----------|--------|--------|
| FTS5 | ✅ Always | Fast, free, effective |
| Session Grouping | ✅ Always | Zero cost, big impact |
| Vectors | ⚙️ Optional | Helps sometimes, adds complexity |
| Entity Matching | ❌ Skip | Marginal gain, adds latency |
| Dynamic RRF | ❌ Skip | Not worth the complexity |
| HyDE | ❌ Skip | Too slow for interactive use |
| Reranking | ❌ Skip | Way too slow |

The 80% solution is FTS5 + session grouping. Everything else is marginal improvement at significant cost.

---

Retrieval research tends toward complexity. Our data suggests the opposite: start simple, add complexity only when data justifies it.

The benchmark code is in `bench/locomo/`. The retrieval implementation is in `src/retriever/`. Run `bun bench:locomo` to reproduce our results.

*Simplicity isn't just engineering virtue—it's what the data supports.*
