# Next-Generation Memory Architecture for Coding Agents

## The Limitations of Current Approaches

Current memory systems (including Alexandria v1) treat memories as **flat documents** with metadata. Search is essentially "find similar text." But code memory has inherent structure that flat storage ignores:

```
Current: Memory → [embedding] → similarity search → results

Reality: Memory exists in multiple dimensions simultaneously:
         - WHAT it means (semantic)
         - WHERE it applies (structural/spatial)
         - WHEN it was relevant (temporal)
         - WHY it matters (causal)
         - HOW it connects (relational)
```

This document explores architectures that could natively represent these dimensions.

---

## Concept 1: Multi-Dimensional Vector Space

### The Idea

Instead of a single embedding vector, represent each memory as a point in a **multi-dimensional space** where each dimension captures a different aspect:

```
Traditional: memory → [semantic_embedding] ∈ ℝ¹⁵³⁶

Multi-dimensional:
  memory → {
    semantic:   [embedding] ∈ ℝ¹⁵³⁶,   // What it means
    structural: [position]  ∈ ℝ²⁵⁶,    // Where in codebase
    temporal:   [timeline]  ∈ ℝ¹²⁸,    // When in history
    causal:     [chain]     ∈ ℝ¹²⁸,    // Why it exists
  }
```

### Structural Dimension

Encode the **position in the codebase** as a learned embedding:

```typescript
interface StructuralPosition {
  // Hierarchical path embedding
  projectEmbedding: number[];      // Project-level context
  packageEmbedding: number[];      // Package/module context
  fileEmbedding: number[];         // File context
  symbolEmbedding: number[];       // Function/class context

  // Dependency graph position
  importDepth: number;             // How deep in import tree
  exportReach: number;             // How widely used
  callGraphPosition: number[];     // Position in call graph
}

// Train embeddings on codebase structure
function encodeStructure(codeRef: CodeReference): StructuralPosition {
  const ast = parseFile(codeRef.file);
  const symbol = findSymbol(ast, codeRef.symbol);

  return {
    projectEmbedding: embedPath(codeRef.file),
    packageEmbedding: embedPackage(getPackage(codeRef.file)),
    fileEmbedding: embedFileContext(ast),
    symbolEmbedding: embedSymbolContext(symbol),
    importDepth: calculateImportDepth(codeRef.file),
    exportReach: calculateExportReach(codeRef.symbol),
    callGraphPosition: embedCallGraphPosition(symbol),
  };
}
```

### Temporal Dimension

Encode **when** the memory was relevant, not just when it was created:

```typescript
interface TemporalPosition {
  // Absolute time
  createdAt: number;               // Unix timestamp
  lastAccessedAt: number;

  // Relative to project
  commitDistance: number;          // Commits since creation
  branchContext: number[];         // Branch embedding

  // Lifecycle stage
  projectPhase: number[];          // Early dev, mature, maintenance
  relevanceDecay: number;          // How quickly it becomes stale
}

// Encode temporal context
function encodeTime(memory: Memory, gitContext: GitContext): TemporalPosition {
  return {
    createdAt: memory.createdAt.getTime(),
    lastAccessedAt: memory.lastAccessedAt?.getTime() ?? 0,
    commitDistance: countCommitsSince(memory.gitContext.commitHash),
    branchContext: embedBranch(gitContext.branch),
    projectPhase: classifyProjectPhase(gitContext),
    relevanceDecay: estimateDecayRate(memory.type),
  };
}
```

### Causal Dimension

Encode the **causal chain** that led to this memory:

```typescript
interface CausalPosition {
  // What caused this memory
  triggerType: 'error' | 'decision' | 'discovery' | 'correction';
  triggerEmbedding: number[];      // Embedding of triggering event

  // What this memory affects
  impactScope: number[];           // What areas it impacts
  dependencyChain: number[];       // What depends on this

  // Confidence and source
  extractionConfidence: number;
  sourceReliability: number;       // Human vs auto-extracted
}
```

### Multi-Dimensional Search

Search across all dimensions with **weighted combination**:

```typescript
interface MultiDimensionalQuery {
  semantic?: string;               // "What" - text query
  structural?: {                   // "Where" - code location
    nearFile?: string;
    nearSymbol?: string;
    inPackage?: string;
  };
  temporal?: {                     // "When" - time context
    relevantAt?: Date;
    commitRange?: [string, string];
  };
  causal?: {                       // "Why" - causal context
    triggeredBy?: string;
    impacts?: string;
  };
}

async function multiDimensionalSearch(
  query: MultiDimensionalQuery,
  weights: DimensionWeights
): Promise<ScoredMemory[]> {
  const results: Map<string, number[]> = new Map();

  // Search each dimension
  if (query.semantic) {
    const semanticResults = await semanticSearch(query.semantic);
    mergeResults(results, semanticResults, 'semantic');
  }

  if (query.structural) {
    const structuralResults = await structuralSearch(query.structural);
    mergeResults(results, structuralResults, 'structural');
  }

  if (query.temporal) {
    const temporalResults = await temporalSearch(query.temporal);
    mergeResults(results, temporalResults, 'temporal');
  }

  if (query.causal) {
    const causalResults = await causalSearch(query.causal);
    mergeResults(results, causalResults, 'causal');
  }

  // Combine with weights
  return combineWithWeights(results, weights);
}
```

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                    MULTI-DIMENSIONAL MEMORY                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   Memory Object                                                      │
│   ┌──────────────────────────────────────────────────────────────┐  │
│   │  content: "Use connection pooling for PostgreSQL"            │  │
│   │  type: decision                                               │  │
│   │                                                               │  │
│   │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────┐ │  │
│   │  │  Semantic   │ │ Structural  │ │  Temporal   │ │ Causal  │ │  │
│   │  │  Vector     │ │  Vector     │ │   Vector    │ │ Vector  │ │  │
│   │  │  ℝ¹⁵³⁶      │ │  ℝ²⁵⁶       │ │   ℝ¹²⁸      │ │ ℝ¹²⁸    │ │  │
│   │  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └────┬────┘ │  │
│   │         │               │               │              │      │  │
│   └─────────┼───────────────┼───────────────┼──────────────┼──────┘  │
│             │               │               │              │         │
│             ▼               ▼               ▼              ▼         │
│   ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │
│   │  Semantic   │ │ Structural  │ │  Temporal   │ │   Causal    │   │
│   │   Index     │ │   Index     │ │   Index     │ │   Index     │   │
│   │   (HNSW)    │ │ (R-tree)    │ │ (B-tree)    │ │   (Graph)   │   │
│   └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘   │
│                                                                      │
│   Query: "How do we handle database connections in auth service?"   │
│                                                                      │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │              MULTI-DIMENSIONAL QUERY ROUTER                  │   │
│   ├─────────────────────────────────────────────────────────────┤   │
│   │  semantic_weight:   0.4  │  "database connections"          │   │
│   │  structural_weight: 0.3  │  near: auth/, services/          │   │
│   │  temporal_weight:   0.2  │  recent commits preferred        │   │
│   │  causal_weight:     0.1  │  decisions, not fixes            │   │
│   └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Concept 2: Knowledge Graph Architecture

### The Idea

Model coding memory as a **graph** where entities and relationships are first-class citizens:

```
Nodes:
  - Memory (decisions, fixes, constraints)
  - File
  - Symbol (function, class, variable)
  - Session
  - Event
  - Developer
  - Error
  - Dependency

Edges:
  - REFERENCES (Memory → File/Symbol)
  - CAUSED_BY (Memory → Event)
  - SUPERSEDES (Memory → Memory)
  - DEPENDS_ON (Symbol → Symbol)
  - OCCURRED_IN (Event → Session)
  - FIXED (Memory → Error)
  - INTRODUCED_BY (Memory → Developer)
```

### Graph Schema

```typescript
// Node types
interface MemoryNode {
  id: string;
  type: 'memory';
  content: string;
  memoryType: MemoryType;
  confidence: number;
  embedding: number[];
}

interface FileNode {
  id: string;
  type: 'file';
  path: string;
  language: string;
  hash: string;
}

interface SymbolNode {
  id: string;
  type: 'symbol';
  name: string;
  symbolType: SymbolType;
  signature?: string;
  fileId: string;
  line: number;
}

interface SessionNode {
  id: string;
  type: 'session';
  startedAt: Date;
  endedAt?: Date;
  task?: string;
}

interface ErrorNode {
  id: string;
  type: 'error';
  message: string;
  stack?: string;
  errorType: string;
}

// Edge types
interface Edge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  weight?: number;
  metadata?: Record<string, unknown>;
}

type EdgeType =
  | 'REFERENCES'      // Memory → File/Symbol
  | 'CAUSED_BY'       // Memory → Event
  | 'SUPERSEDES'      // Memory → Memory
  | 'RELATES_TO'      // Memory → Memory
  | 'DEPENDS_ON'      // Symbol → Symbol
  | 'CONTAINS'        // File → Symbol
  | 'OCCURRED_IN'     // Event → Session
  | 'FIXED'           // Memory → Error
  | 'TRIGGERED'       // Error → Memory
  | 'PRECEDED_BY'     // Event → Event
  | 'MODIFIED'        // Session → File
  ;
```

### Graph Queries

**1. Find all memories related to a symbol:**
```cypher
MATCH (m:Memory)-[:REFERENCES]->(s:Symbol {name: "authenticate"})
RETURN m
ORDER BY m.confidence DESC
```

**2. Trace decision lineage:**
```cypher
MATCH path = (m:Memory)-[:SUPERSEDES*]->(root:Memory)
WHERE m.id = $memoryId
RETURN path
```

**3. Find memories from sessions that touched similar files:**
```cypher
MATCH (current:Session)-[:MODIFIED]->(f:File)
WHERE current.id = $currentSessionId
WITH collect(f) as currentFiles

MATCH (past:Session)-[:MODIFIED]->(f:File)
WHERE f IN currentFiles AND past.id <> $currentSessionId

MATCH (e:Event)-[:OCCURRED_IN]->(past)
MATCH (m:Memory)-[:CAUSED_BY]->(e)
RETURN DISTINCT m
```

**4. Find error patterns and their fixes:**
```cypher
MATCH (e:Error)<-[:TRIGGERED]-(m:Memory {memoryType: "known_fix"})
WHERE e.message CONTAINS $errorPattern
RETURN m, e
ORDER BY m.confidence DESC
```

### Graph Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     KNOWLEDGE GRAPH MEMORY                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│    ┌─────────┐         REFERENCES         ┌─────────┐              │
│    │ Memory  │─────────────────────────────│  File   │              │
│    │ "Use    │                             │ db.ts   │              │
│    │ pooling"│                             └────┬────┘              │
│    └────┬────┘                                  │                    │
│         │                                       │ CONTAINS           │
│         │ CAUSED_BY                             │                    │
│         │                                       ▼                    │
│         ▼                              ┌─────────────┐              │
│    ┌─────────┐                         │   Symbol    │              │
│    │  Event  │                         │ createPool  │              │
│    │ "perf   │                         └─────────────┘              │
│    │  issue" │                                  │                    │
│    └────┬────┘                                  │ DEPENDS_ON         │
│         │                                       │                    │
│         │ OCCURRED_IN                           ▼                    │
│         │                              ┌─────────────┐              │
│         ▼                              │   Symbol    │              │
│    ┌─────────┐      MODIFIED           │    Pool     │              │
│    │ Session │─────────────────────────│  (pg-pool)  │              │
│    │ #42     │                         └─────────────┘              │
│    └─────────┘                                                       │
│                                                                      │
│    ┌─────────────────────────────────────────────────────────────┐  │
│    │                    GRAPH QUERY ENGINE                        │  │
│    ├─────────────────────────────────────────────────────────────┤  │
│    │  • Cypher-like query language                                │  │
│    │  • Path traversal for related memories                       │  │
│    │  • Subgraph extraction for context                          │  │
│    │  • Embedding-aware similarity on nodes                       │  │
│    └─────────────────────────────────────────────────────────────┘  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Graph Database Options

| Database | Type | Pros | Cons |
|----------|------|------|------|
| **SQLite + JSON** | Relational | Simple, local | No native graph queries |
| **DuckDB** | Analytical | Fast, local | Limited graph support |
| **Kuzu** | Embedded Graph | Native graphs, local | Newer, less mature |
| **Neo4j Embedded** | Graph | Mature, powerful | JVM dependency |
| **Custom (Adjacency)** | SQLite | Full control | Build from scratch |

---

## Concept 3: Hierarchical Memory Architecture

### The Idea

Model memory at multiple levels of abstraction, like human memory:

```
┌─────────────────────────────────────────────────────────────────┐
│                    EPISODIC MEMORY                               │
│            (Raw events, sessions, what happened)                 │
│   "In session #42, we tried X, it failed, then we did Y"        │
└────────────────────────────┬────────────────────────────────────┘
                             │ consolidation
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SEMANTIC MEMORY                               │
│              (Facts, decisions, knowledge)                       │
│   "PostgreSQL connection pooling improves performance"          │
└────────────────────────────┬────────────────────────────────────┘
                             │ abstraction
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   PROCEDURAL MEMORY                              │
│           (Patterns, conventions, how-to)                        │
│   "When facing database performance issues, check pooling"      │
└─────────────────────────────────────────────────────────────────┘
```

### Memory Consolidation

Like sleep for humans, periodically consolidate episodic → semantic → procedural:

```typescript
interface MemoryConsolidator {
  /**
   * Consolidate episodic memories into semantic facts
   * Run periodically (e.g., end of day, end of session)
   */
  consolidateEpisodic(): Promise<SemanticMemory[]>;

  /**
   * Abstract semantic memories into procedural patterns
   * Run less frequently (e.g., weekly)
   */
  abstractSemantic(): Promise<ProceduralMemory[]>;
}

class HierarchicalConsolidator implements MemoryConsolidator {
  async consolidateEpisodic(): Promise<SemanticMemory[]> {
    // Find episodic memories not yet consolidated
    const episodes = await this.getUnconsolidatedEpisodes();

    // Group by similarity
    const clusters = await this.clusterBySimilarity(episodes);

    // Extract facts from each cluster
    const facts: SemanticMemory[] = [];
    for (const cluster of clusters) {
      if (cluster.length >= 2) {
        // Pattern appears multiple times
        const fact = await this.extractFact(cluster);
        facts.push(fact);

        // Mark episodes as consolidated
        await this.markConsolidated(cluster, fact.id);
      }
    }

    return facts;
  }

  async abstractSemantic(): Promise<ProceduralMemory[]> {
    // Find semantic memories that form patterns
    const semantics = await this.getSemanticMemories();

    // Group by causal structure (problem → solution)
    const causalGroups = await this.groupByCausality(semantics);

    // Extract procedures
    const procedures: ProceduralMemory[] = [];
    for (const group of causalGroups) {
      const procedure = await this.extractProcedure(group);
      procedures.push(procedure);
    }

    return procedures;
  }
}
```

### Hierarchical Retrieval

Query at appropriate level based on context:

```typescript
interface HierarchicalRetriever {
  /**
   * Get recent episodic memories for current task
   * "What did we just do?"
   */
  retrieveEpisodic(sessionContext: SessionContext): Promise<EpisodicMemory[]>;

  /**
   * Get relevant facts for a topic
   * "What do we know about X?"
   */
  retrieveSemantic(topic: string): Promise<SemanticMemory[]>;

  /**
   * Get applicable procedures for a situation
   * "How do we handle X?"
   */
  retrieveProcedural(situation: string): Promise<ProceduralMemory[]>;
}

async function intelligentRetrieve(
  query: string,
  context: QueryContext
): Promise<ContextPack> {
  // Classify query type
  const queryType = classifyQuery(query);

  switch (queryType) {
    case 'recent_context':
      // "What did we just try?"
      return {
        episodic: await retriever.retrieveEpisodic(context.session),
      };

    case 'factual':
      // "What database do we use?"
      return {
        semantic: await retriever.retrieveSemantic(query),
      };

    case 'procedural':
      // "How do we deploy to production?"
      return {
        procedural: await retriever.retrieveProcedural(query),
        semantic: await retriever.retrieveSemantic(extractTopic(query)),
      };

    case 'debugging':
      // "Why is X failing?"
      return {
        episodic: await retriever.retrieveEpisodic(context.session),
        semantic: await retriever.retrieveSemantic(extractError(query)),
        procedural: await retriever.retrieveProcedural('debugging ' + extractError(query)),
      };
  }
}
```

---

## Concept 4: Code-Native Memory Embedding

### The Idea

Instead of embedding text descriptions of memories, embed the **code itself** and the **structural relationships**:

```typescript
interface CodeNativeMemory {
  // Text content (traditional)
  content: string;
  contentEmbedding: number[];

  // Code embeddings
  codeSnippet?: string;
  codeEmbedding?: number[];        // Code-specific embedding model

  // AST embedding
  astEmbedding?: number[];         // Structural code embedding

  // Call graph embedding
  callGraphEmbedding?: number[];   // Position in dependency graph
}
```

### Code Embedding Models

Use specialized models for code:

```typescript
interface CodeEmbedder {
  /**
   * Embed code snippet using code-specific model
   * (CodeBERT, StarCoder, etc.)
   */
  embedCode(code: string, language: string): Promise<number[]>;

  /**
   * Embed AST structure
   */
  embedAST(ast: ASTNode): Promise<number[]>;

  /**
   * Embed position in call graph
   */
  embedCallGraph(symbol: Symbol, graph: CallGraph): Promise<number[]>;
}

class MultiModalCodeEmbedder implements CodeEmbedder {
  private textModel: EmbeddingModel;      // text-embedding-3-small
  private codeModel: CodeEmbeddingModel;  // CodeBERT or similar
  private graphModel: GraphEmbeddingModel; // Node2Vec or similar

  async embedMemory(memory: Memory): Promise<MultiModalEmbedding> {
    // Embed text content
    const textEmbedding = await this.textModel.embed(memory.content);

    // If memory has code reference, embed the code
    let codeEmbedding: number[] | undefined;
    let astEmbedding: number[] | undefined;
    let graphEmbedding: number[] | undefined;

    if (memory.codeRefs.length > 0) {
      const ref = memory.codeRefs[0];
      const code = await this.getCodeSnippet(ref);
      const ast = await this.parseCode(code, ref.file);
      const graph = await this.getCallGraph(ref);

      codeEmbedding = await this.codeModel.embed(code);
      astEmbedding = await this.embedAST(ast);
      graphEmbedding = await this.graphModel.embed(ref.symbol, graph);
    }

    return {
      text: textEmbedding,
      code: codeEmbedding,
      ast: astEmbedding,
      graph: graphEmbedding,
    };
  }
}
```

### Multi-Modal Search

Search across text and code modalities:

```typescript
async function multiModalSearch(
  query: string,
  codeContext?: { file: string; symbol?: string }
): Promise<ScoredMemory[]> {
  // Embed the text query
  const textQueryEmb = await embedder.embedText(query);

  // If code context provided, embed it too
  let codeQueryEmb: number[] | undefined;
  let graphQueryEmb: number[] | undefined;

  if (codeContext) {
    const code = await getCodeAt(codeContext.file, codeContext.symbol);
    codeQueryEmb = await embedder.embedCode(code);

    if (codeContext.symbol) {
      const graph = await getCallGraph(codeContext);
      graphQueryEmb = await embedder.embedGraph(codeContext.symbol, graph);
    }
  }

  // Search each modality
  const results = await Promise.all([
    searchByEmbedding(textQueryEmb, 'text'),
    codeQueryEmb ? searchByEmbedding(codeQueryEmb, 'code') : [],
    graphQueryEmb ? searchByEmbedding(graphQueryEmb, 'graph') : [],
  ]);

  // Fuse results
  return fuseResults(results, {
    text: 0.4,
    code: 0.4,
    graph: 0.2,
  });
}
```

---

## Concept 5: Temporal Knowledge Base

### The Idea

Model memory as facts that are **valid over time intervals**, not just created at a point in time:

```typescript
interface TemporalFact {
  id: string;
  content: string;

  // Validity interval
  validFrom: Date | 'beginning';    // When fact became true
  validUntil: Date | 'now';         // When fact stopped being true

  // Versioning
  version: number;
  previousVersion?: string;         // ID of previous version

  // Temporal metadata
  createdAt: Date;
  createdByCommit: string;
  invalidatedByCommit?: string;
}
```

### Temporal Queries

```typescript
interface TemporalQueryEngine {
  /**
   * Get facts valid at a specific point in time
   */
  getFactsAt(timestamp: Date): Promise<TemporalFact[]>;

  /**
   * Get facts valid during a commit range
   */
  getFactsDuring(fromCommit: string, toCommit: string): Promise<TemporalFact[]>;

  /**
   * Get history of a fact
   */
  getFactHistory(factId: string): Promise<TemporalFact[]>;

  /**
   * Find when a fact was valid
   */
  whenWasValid(factId: string): Promise<TimeRange[]>;
}

// Example queries:
// "What did we believe about auth at commit abc123?"
const authFacts = await temporal.getFactsAt(getCommitDate('abc123'))
  .filter(f => f.content.includes('auth'));

// "How has our database config evolved?"
const dbHistory = await temporal.getFactHistory('db-config-fact');
```

### Temporal Storage

```sql
CREATE TABLE temporal_facts (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,

  -- Validity interval
  valid_from TEXT NOT NULL,        -- ISO timestamp or 'beginning'
  valid_until TEXT NOT NULL,       -- ISO timestamp or 'now'

  -- Versioning
  version INTEGER NOT NULL,
  previous_version TEXT,

  -- Git context
  created_at TEXT NOT NULL,
  created_by_commit TEXT,
  invalidated_by_commit TEXT,

  FOREIGN KEY (previous_version) REFERENCES temporal_facts(id)
);

-- Index for temporal queries
CREATE INDEX idx_temporal_validity ON temporal_facts(valid_from, valid_until);

-- Query: Get facts valid at timestamp
SELECT * FROM temporal_facts
WHERE valid_from <= ?
  AND (valid_until = 'now' OR valid_until > ?);
```

---

## Hybrid Architecture Proposal

Combining the best ideas into a cohesive architecture:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    NEXT-GEN CODING MEMORY SYSTEM                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                         INGESTION                                  │  │
│  │  Events → Extraction → Multi-Modal Embedding → Graph Building     │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                    │                                     │
│                                    ▼                                     │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                      STORAGE LAYER                                 │  │
│  │                                                                    │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐   │  │
│  │  │   SQLite Core   │  │  Vector Indexes │  │  Graph Store    │   │  │
│  │  │   (Temporal)    │  │  (Multi-Modal)  │  │  (Kuzu/Custom)  │   │  │
│  │  │                 │  │                 │  │                 │   │  │
│  │  │  • Facts        │  │  • Text emb     │  │  • Nodes        │   │  │
│  │  │  • Validity     │  │  • Code emb     │  │  • Edges        │   │  │
│  │  │  • Versions     │  │  • AST emb      │  │  • Paths        │   │  │
│  │  │  • History      │  │  • Graph emb    │  │  • Subgraphs    │   │  │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘   │  │
│  │                                                                    │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                    │                                     │
│                                    ▼                                     │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                     RETRIEVAL ENGINE                               │  │
│  │                                                                    │  │
│  │  Query → Router → Multi-Dimensional Search → Graph Expansion      │  │
│  │           │              │                         │               │  │
│  │           ▼              ▼                         ▼               │  │
│  │      ┌─────────┐   ┌──────────┐            ┌──────────┐          │  │
│  │      │ Intent  │   │ Parallel │            │  Path    │          │  │
│  │      │ Class.  │   │ Index    │            │ Traverse │          │  │
│  │      │         │   │ Search   │            │          │          │  │
│  │      └─────────┘   └──────────┘            └──────────┘          │  │
│  │                                                                    │  │
│  │  → Temporal Filter → Staleness Check → Ranking → Context Pack    │  │
│  │                                                                    │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                    │                                     │
│                                    ▼                                     │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                    CONSOLIDATION                                   │  │
│  │                                                                    │  │
│  │  Episodic → Semantic → Procedural (background, periodic)          │  │
│  │                                                                    │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Implementation Phases

**Phase 1: Enhanced SQLite Foundation**
- Temporal fact storage with validity intervals
- FTS5 with better tokenization
- Version history tracking

**Phase 2: Multi-Modal Embeddings**
- Text embeddings (current)
- Code embeddings (CodeBERT or similar)
- Structural embeddings (AST-based)

**Phase 3: Graph Layer**
- Entity extraction (files, symbols, errors)
- Relationship detection
- Graph queries for traversal

**Phase 4: Hierarchical Memory**
- Episodic → Semantic consolidation
- Pattern extraction
- Procedural memory formation

**Phase 5: Advanced Retrieval**
- Multi-dimensional query routing
- Cross-modal fusion
- Temporal reasoning

---

## Trade-offs and Decisions

| Aspect | Simple (Current) | Complex (Proposed) | Recommendation |
|--------|------------------|-------------------|----------------|
| Storage | SQLite | SQLite + Graph | Start simple, add graph when needed |
| Embeddings | Text only | Multi-modal | Add code embeddings, defer AST/graph |
| Temporal | Created timestamp | Validity intervals | Worth the complexity |
| Hierarchy | Flat | 3-level | Implement consolidation, defer procedural |
| Graph | None | Full knowledge graph | Start with lightweight relationships |

### Recommended Path

1. **Immediate**: Temporal validity intervals in SQLite
2. **Short-term**: Code embeddings for code-referencing memories
3. **Medium-term**: Lightweight graph relationships (SQLite adjacency list)
4. **Long-term**: Full multi-dimensional retrieval

---

## Open Questions

1. **Embedding models for code**: CodeBERT vs StarCoder vs code-specific fine-tuning?
2. **Graph storage**: Build on SQLite vs dedicated graph DB (Kuzu)?
3. **Consolidation triggers**: Time-based vs event-based vs manual?
4. **Multi-modal fusion**: Learned weights vs query-specific vs fixed?
5. **Temporal granularity**: Commit-based vs timestamp-based vs both?

---

*This document explores architectural possibilities. Implementation requires experimentation and iteration.*

*Last updated: January 2025*
