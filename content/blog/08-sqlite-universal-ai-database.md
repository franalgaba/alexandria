# SQLite as the Universal AI Database

> "The most underrated database for AI applications runs on a single file."

When we started building Alexandria, the architecture discussion went something like this:

"We need a database. Postgres?"
"We need full-text search. Elasticsearch?"
"We need vector search. Pinecone?"
"We need a cache. Redis?"

Then someone asked: "What if we just used SQLite?"

Six months later, SQLite does all of it.

## Why AI Apps Need Different Storage

Traditional web applications have predictable storage patterns: CRUD operations, relational data, SQL queries. The architecture is mature. Postgres wins.

AI applications have different requirements:

**Local-first.** Users want data on their machine, not in the cloud. Latency matters. Privacy matters.

**Embedded.** The database runs inside the application, not as a separate service. Zero ops overhead.

**Works offline.** Internet connectivity shouldn't be required. The app should work on planes.

**Portable.** Users should be able to copy, backup, and share their data easily.

**Flexible schema.** AI applications evolve rapidly. Schema migrations shouldn't require downtime.

These requirements point away from client-server databases and toward embedded solutions.

## SQLite's Superpowers

SQLite is everywhere. It runs on your phone, your browser, your smart TV, and most embedded systems. It's probably the most deployed database in the world.

For AI applications, it has specific superpowers:

### Single File, Full SQL

The entire database is one file. All tables, indexes, and data—one portable unit.

```bash
# Backup
cp alexandria.db alexandria.db.backup

# Transfer
scp alexandria.db user@server:~

# Inspect
sqlite3 alexandria.db ".tables"
```

But it's not just a key-value store. It's full SQL:

```sql
SELECT m.content, m.object_type, m.status,
       COUNT(o.id) as access_count
FROM memory_objects m
LEFT JOIN memory_outcomes o ON m.id = o.memory_id
WHERE m.status = 'active'
GROUP BY m.id
ORDER BY access_count DESC
LIMIT 20;
```

Joins, aggregations, subqueries—everything works.

### FTS5: Full-Text Search Done Right

SQLite's FTS5 extension provides production-quality full-text search:

```sql
-- Create the virtual table
CREATE VIRTUAL TABLE memory_fts USING fts5(
    content,
    scope_path,
    content='memory_objects',
    content_rowid='rowid',
    tokenize='porter unicode61'
);

-- Search with BM25 ranking
SELECT m.*, bm25(memory_fts) as score
FROM memory_objects m
JOIN memory_fts ON m.rowid = memory_fts.rowid
WHERE memory_fts MATCH 'authentication jwt'
ORDER BY score
LIMIT 10;
```

The `porter` tokenizer handles stemming (searching "running" finds "run"). BM25 ranking provides relevance scoring. Phrase queries, boolean operators, and prefix matching all work.

Performance is excellent:

| Corpus Size | Query Time | Index Size |
|-------------|------------|------------|
| 1,000 docs | 2ms | 0.5 MB |
| 10,000 docs | 5ms | 5 MB |
| 100,000 docs | 15ms | 50 MB |

For local memory storage, this is more than sufficient.

### WAL Mode: Concurrent Access

Write-Ahead Logging enables concurrent reads while writing:

```sql
PRAGMA journal_mode = WAL;
```

With WAL mode:
- Multiple readers can access simultaneously
- One writer can work while readers continue
- Readers never block writers
- Writers never block readers

For AI applications where the agent reads context while hooks write events, this is essential.

### JSON Support

SQLite has native JSON functions since version 3.38:

```sql
-- Store structured data
INSERT INTO memory_objects (id, content, code_refs)
VALUES ('abc123', 'Use SQLite', json('[
  {"type": "file", "path": "src/stores/connection.ts"},
  {"type": "symbol", "path": "src/stores/connection.ts", "symbol": "getConnection"}
]'));

-- Query JSON fields
SELECT content, json_extract(code_refs, '$[0].path') as first_file
FROM memory_objects
WHERE json_extract(code_refs, '$[0].type') = 'symbol';
```

No need for a separate document store.

## Performance Tuning

Out of the box, SQLite is conservative. For AI workloads, we tune aggressively:

```sql
-- Use WAL mode (concurrent access)
PRAGMA journal_mode = WAL;

-- Reduce sync frequency (faster writes)
PRAGMA synchronous = NORMAL;

-- Increase cache size (64MB)
PRAGMA cache_size = -64000;

-- Memory-map the database (256MB)
PRAGMA mmap_size = 268435456;

-- Increase page size for large records
PRAGMA page_size = 4096;
```

With these settings:

| Operation | Before | After |
|-----------|--------|-------|
| Insert (single) | 5ms | 0.5ms |
| Insert (batch 100) | 500ms | 10ms |
| FTS5 search | 10ms | 5ms |
| Select with join | 8ms | 3ms |

The biggest wins come from WAL mode and increased cache size.

## Vector Search Options

The one thing SQLite doesn't do natively is vector similarity search. We handle this three ways:

### Option 1: sqlite-vec Extension

The [sqlite-vec](https://github.com/asg017/sqlite-vec) extension adds vector search:

```sql
-- Create vector table
CREATE VIRTUAL TABLE embeddings USING vec0(
    embedding float[384]
);

-- Insert vectors
INSERT INTO embeddings(rowid, embedding)
VALUES (1, '[0.1, 0.2, 0.3, ...]');

-- Query by similarity
SELECT rowid, distance
FROM embeddings
WHERE embedding MATCH '[0.15, 0.25, 0.35, ...]'
ORDER BY distance
LIMIT 10;
```

When available, this is the cleanest solution. But extension support varies by platform.

### Option 2: Separate Index File

For portability, we maintain a separate vector index:

```typescript
import { HNSWIndex } from './hnsw';

class VectorIndex {
  private index: HNSWIndex;
  private idMap: Map<number, string>;

  async search(embedding: number[], k: number): Promise<string[]> {
    const results = await this.index.searchKnn(embedding, k);
    return results.map(r => this.idMap.get(r.id)!);
  }
}
```

The index file sits alongside the SQLite database:

```
~/.alexandria/projects/abc123/
├── alexandria.db      # SQLite
└── vectors.idx        # HNSW index
```

### Option 3: Hybrid with External Service

For large-scale deployments, vector search can use an external service while keeping primary data in SQLite:

```typescript
async function hybridSearch(query: string): Promise<Memory[]> {
  // Vector search (external or local)
  const vectorResults = await vectorService.search(embed(query), 50);

  // Fetch full objects from SQLite
  const memories = await db.query(`
    SELECT * FROM memory_objects
    WHERE id IN (${vectorResults.map(r => `'${r.id}'`).join(',')})
  `);

  return memories;
}
```

SQLite remains the source of truth; vectors handle similarity.

## Schema Design for AI

AI applications have specific schema patterns:

### Flexible Metadata

```sql
CREATE TABLE memory_objects (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    object_type TEXT NOT NULL,

    -- Structured fields
    scope_type TEXT,
    scope_path TEXT,
    status TEXT DEFAULT 'active',

    -- Flexible metadata as JSON
    metadata TEXT,  -- JSON object for extensibility

    -- Timestamps
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Core fields are columns (queryable, indexable). Flexible fields are JSON.

### Event Sourcing

```sql
CREATE TABLE events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    event_type TEXT NOT NULL,

    -- Event-specific data
    content TEXT,
    tool_name TEXT,
    file_path TEXT,
    exit_code INTEGER,

    -- Large content goes to blob storage
    blob_id TEXT REFERENCES blobs(id)
);

CREATE TABLE blobs (
    id TEXT PRIMARY KEY,
    content BLOB NOT NULL,
    size INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Events are append-only. Large payloads (tool outputs, diffs) go to blob storage.

### Derived Views

```sql
CREATE VIEW active_memories AS
SELECT * FROM memory_objects
WHERE status = 'active'
AND review_status = 'approved';

CREATE VIEW pending_review AS
SELECT * FROM memory_objects
WHERE review_status = 'pending'
ORDER BY created_at DESC;
```

Views simplify common queries without duplicating data.

## The Portability Win

SQLite's portability is underrated:

```bash
# Backup: copy the file
cp alexandria.db backup-$(date +%Y%m%d).db

# Sync: use any file sync tool
rsync -av alexandria.db remote:~/.alexandria/

# Share: email a database
# (carefully—it contains your project context)

# Debug: open in any SQLite client
sqlite3 alexandria.db

# Export: dump to SQL
sqlite3 alexandria.db .dump > export.sql

# Import: restore from dump
sqlite3 new.db < export.sql
```

No migration tools. No connection strings. No authentication. Just a file.

## Real Numbers from Alexandria

After six months of production use:

| Metric | Typical Value |
|--------|---------------|
| Database size (active project) | 15-30 MB |
| Events (1 month, active dev) | ~5,000 |
| Memories (1 month, active dev) | ~150 |
| Query latency (p50) | 3ms |
| Query latency (p99) | 15ms |
| Write latency (event) | 0.5ms |
| FTS5 index overhead | ~2x content size |

The database never becomes a bottleneck. Storage is negligible. Queries are instant.

## When SQLite Isn't Enough

SQLite has limits. You might need something else when:

**Multiple writers on different machines.** SQLite is single-file. Concurrent writes from multiple machines don't work.

**Massive scale.** Beyond millions of records, specialized databases may perform better.

**Complex analytics.** OLAP workloads might benefit from columnar storage.

**Real-time collaboration.** Multi-user editing needs conflict resolution that SQLite doesn't provide.

For Alexandria's use case—local-first memory for individual developers—these limits are theoretical.

## Getting Started

Using SQLite for an AI application:

```typescript
import Database from 'bun:sqlite';

const db = new Database('memory.db');

// Initial setup
db.run(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA cache_size = -64000;
`);

// Create schema
db.run(`
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    embedding BLOB,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    content,
    content='memories',
    tokenize='porter'
  );
`);

// Insert with FTS sync
function addMemory(id: string, content: string, embedding: number[]) {
  db.run(`
    INSERT INTO memories (id, content, embedding)
    VALUES (?, ?, ?);

    INSERT INTO memories_fts (rowid, content)
    VALUES (last_insert_rowid(), ?);
  `, [id, content, Buffer.from(new Float32Array(embedding).buffer), content]);
}

// Search
function search(query: string): Memory[] {
  return db.query(`
    SELECT m.*, bm25(memories_fts) as score
    FROM memories m
    JOIN memories_fts ON m.rowid = memories_fts.rowid
    WHERE memories_fts MATCH ?
    ORDER BY score
    LIMIT 10
  `).all(query);
}
```

That's it. Full-text search, JSON support, concurrent access—in 40 lines.

---

SQLite isn't the answer to everything. But for local-first AI applications, it's remarkably capable. We spent months looking for reasons to use something more complex. We didn't find any.

The schema is in `src/stores/schema.sql`. The connection management is in `src/stores/connection.ts`. The FTS5 implementation is in `src/indexes/fts.ts`.

*The most underrated database is the one that just works.*
