# Alexandria Technical Architecture

## Overview

This document describes the technical architecture for a coding agent memory system. It covers data models, ingestion pipelines, storage strategies, retrieval mechanisms, and integration patterns.

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Data Models](#data-models)
3. [Storage Layer](#storage-layer)
4. [Ingestion Pipeline](#ingestion-pipeline)
5. [Code Reference System](#code-reference-system)
6. [Retrieval Engine](#retrieval-engine)
7. [Staleness Detection](#staleness-detection)
8. [Memory Lifecycle](#memory-lifecycle)
9. [Agent Integration](#agent-integration)
10. [Scaling Considerations](#scaling-considerations)

---

## System Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CODING AGENT                                   │
│                    (Claude Code, Cursor, Aider, etc.)                   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                    ▼               ▼               ▼
            ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
            │    Events    │ │   Queries    │ │   Commands   │
            │   (hooks)    │ │  (context)   │ │  (explicit)  │
            └──────────────┘ └──────────────┘ └──────────────┘
                    │               │               │
                    ▼               ▼               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         ALEXANDRIA CORE                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                      INGESTION LAYER                             │    │
│  ├─────────────────────────────────────────────────────────────────┤    │
│  │  Event Buffer → Checkpoint Trigger → Tiered Extraction          │    │
│  │       │              │                    │                      │    │
│  │       ▼              ▼                    ▼                      │    │
│  │  [raw events]   [10 events     [Tier 0: Deterministic]          │    │
│  │                  or manual]     [Tier 1: Haiku LLM]              │    │
│  │                                 [Tier 2: Sonnet LLM]             │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                              │                                           │
│                              ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                       STORAGE LAYER                              │    │
│  ├─────────────────────────────────────────────────────────────────┤    │
│  │                                                                  │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │    │
│  │  │   SQLite     │  │    FTS5      │  │   Vector     │          │    │
│  │  │   (core)     │  │   Index      │  │   Index      │          │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘          │    │
│  │         │                 │                 │                   │    │
│  │         └─────────────────┴─────────────────┘                   │    │
│  │                           │                                      │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │    │
│  │  │   Symbol     │  │    Code      │  │    Git       │          │    │
│  │  │   Index      │  │    Refs      │  │   Context    │          │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘          │    │
│  │                                                                  │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                              │                                           │
│                              ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                     RETRIEVAL LAYER                              │    │
│  ├─────────────────────────────────────────────────────────────────┤    │
│  │                                                                  │    │
│  │  Query Router → Hybrid Search → Reranker → Context Pack         │    │
│  │       │              │              │            │               │    │
│  │       ▼              ▼              ▼            ▼               │    │
│  │  [classify     [FTS + Vector   [staleness   [token-aware        │    │
│  │   intent]       + symbols]      filter]      assembly]          │    │
│  │                                                                  │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                              │                                           │
│                              ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                      REVIEW LAYER                                │    │
│  ├─────────────────────────────────────────────────────────────────┤    │
│  │  Pending Queue → Human Review → Approval/Rejection → Active     │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          FILE SYSTEM                                     │
├─────────────────────────────────────────────────────────────────────────┤
│  ~/.alexandria/                                                          │
│  ├── config.json                    # Global configuration               │
│  ├── projects/                                                           │
│  │   └── <project-hash>/                                                │
│  │       ├── memories.db            # SQLite: memories + FTS5           │
│  │       ├── events.db              # SQLite: raw events                │
│  │       ├── sessions.db            # SQLite: session tracking          │
│  │       ├── vectors.idx            # Vector embeddings                 │
│  │       └── symbols.idx            # Code symbol index                 │
│  └── cache/                                                              │
│      └── embeddings/                # Cached embeddings                  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| **Event Buffer** | Collect raw agent events (tool calls, responses) |
| **Checkpoint Trigger** | Determine when to process buffered events |
| **Tiered Extraction** | Extract memories using deterministic + LLM methods |
| **Storage Layer** | Persist memories, events, indexes |
| **Retrieval Engine** | Find relevant memories for queries |
| **Review Layer** | Human-in-the-loop verification |

---

## Data Models

### Core Entities

```typescript
/**
 * Memory Object - The primary unit of stored knowledge
 */
interface MemoryObject {
  // Identity
  id: string;                    // UUID
  projectId: string;             // Hash of project root

  // Content
  content: string;               // The memory itself
  type: MemoryType;              // decision, constraint, known_fix, etc.
  summary?: string;              // One-line summary for listings

  // Extraction metadata
  extractedFrom: string[];       // Event IDs that led to this memory
  extractionMethod: 'deterministic' | 'haiku' | 'sonnet' | 'manual';
  confidence: number;            // 0-1 extraction confidence

  // Code anchoring
  codeRefs: CodeReference[];     // Anchors to specific code locations
  symbols: string[];             // Referenced symbols (functions, classes)
  files: string[];               // Referenced file paths

  // Git context at creation
  gitContext: GitContext;

  // Lifecycle
  status: MemoryStatus;
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt?: Date;
  lastVerifiedAt?: Date;
  supersededBy?: string;         // ID of superseding memory

  // Relationships
  relatedMemories: string[];     // IDs of related memories
  parentMemory?: string;         // For memory hierarchies
}

type MemoryType =
  | 'decision'        // Technical choice with rationale
  | 'constraint'      // Hard rule that cannot be violated
  | 'known_fix'       // Solution that worked
  | 'failed_attempt'  // What didn't work
  | 'convention'      // Coding standard
  | 'preference'      // Soft preference
  | 'environment'     // System configuration
  | 'architecture'    // High-level design
  | 'dependency'      // External dependency note
  | 'security';       // Security-related

type MemoryStatus =
  | 'pending'         // Awaiting human review
  | 'active'          // Verified and in use
  | 'stale'           // Likely outdated (code changed)
  | 'superseded'      // Replaced by newer memory
  | 'archived';       // No longer relevant

/**
 * Code Reference - Anchor to specific code location
 */
interface CodeReference {
  file: string;                  // Relative path from project root
  line?: number;                 // Line number (1-indexed)
  endLine?: number;              // End line for ranges
  symbol?: string;               // Symbol name (function, class, etc.)
  symbolType?: SymbolType;       // Type of symbol
  contentHash: string;           // Hash of referenced content
  snippet?: string;              // Code snippet for context
}

type SymbolType =
  | 'function'
  | 'class'
  | 'method'
  | 'variable'
  | 'constant'
  | 'type'
  | 'interface'
  | 'enum'
  | 'module';

/**
 * Git Context - Repository state at memory creation
 */
interface GitContext {
  commitHash: string;            // HEAD commit when memory created
  branch: string;                // Current branch
  isDirty: boolean;              // Uncommitted changes present
  fileHashes: Map<string, string>; // Hash of each referenced file
  remoteUrl?: string;            // Origin remote URL
}

/**
 * Session - A unit of agent work
 */
interface Session {
  id: string;
  projectId: string;

  // Timing
  startedAt: Date;
  endedAt?: Date;

  // Context
  workingDirectory: string;
  initialBranch: string;
  taskDescription?: string;

  // Activity
  eventCount: number;
  checkpointCount: number;
  memoriesExtracted: number;

  // Outcome
  status: 'active' | 'completed' | 'abandoned';
  outcome?: 'success' | 'failure' | 'partial';
}

/**
 * Event - Raw agent activity
 */
interface Event {
  id: string;
  sessionId: string;
  timestamp: Date;

  // Event type
  eventType: EventType;

  // Content
  content: string;
  metadata: Record<string, unknown>;

  // Tool context (for tool events)
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  exitCode?: number;

  // Code context
  activeFile?: string;
  recentFiles?: string[];
}

type EventType =
  | 'session_start'
  | 'session_end'
  | 'user_prompt'
  | 'assistant_response'
  | 'tool_call'
  | 'tool_result'
  | 'file_read'
  | 'file_write'
  | 'file_edit'
  | 'command_run'
  | 'error'
  | 'checkpoint';
```

### Database Schema

```sql
-- memories.db

-- Core memories table
CREATE TABLE memory_objects (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  content TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN (
    'decision', 'constraint', 'known_fix', 'failed_attempt',
    'convention', 'preference', 'environment', 'architecture',
    'dependency', 'security'
  )),
  summary TEXT,

  -- Extraction
  extracted_from TEXT,           -- JSON array of event IDs
  extraction_method TEXT NOT NULL,
  confidence REAL DEFAULT 1.0,

  -- Git context
  commit_hash TEXT,
  branch TEXT,
  is_dirty INTEGER DEFAULT 0,

  -- Lifecycle
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'active', 'stale', 'superseded', 'archived'
  )),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  last_accessed_at TEXT,
  last_verified_at TEXT,
  superseded_by TEXT,

  -- Relationships
  related_memories TEXT,         -- JSON array of IDs
  parent_memory TEXT,

  -- Indexes
  FOREIGN KEY (superseded_by) REFERENCES memory_objects(id),
  FOREIGN KEY (parent_memory) REFERENCES memory_objects(id)
);

-- FTS5 full-text search index
CREATE VIRTUAL TABLE memory_fts USING fts5(
  content,
  summary,
  content=memory_objects,
  content_rowid=rowid,
  tokenize='porter unicode61'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER memory_fts_insert AFTER INSERT ON memory_objects BEGIN
  INSERT INTO memory_fts(rowid, content, summary)
  VALUES (NEW.rowid, NEW.content, NEW.summary);
END;

CREATE TRIGGER memory_fts_delete AFTER DELETE ON memory_objects BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, content, summary)
  VALUES ('delete', OLD.rowid, OLD.content, OLD.summary);
END;

CREATE TRIGGER memory_fts_update AFTER UPDATE ON memory_objects BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, content, summary)
  VALUES ('delete', OLD.rowid, OLD.content, OLD.summary);
  INSERT INTO memory_fts(rowid, content, summary)
  VALUES (NEW.rowid, NEW.content, NEW.summary);
END;

-- Code references table
CREATE TABLE code_refs (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  file TEXT NOT NULL,
  line INTEGER,
  end_line INTEGER,
  symbol TEXT,
  symbol_type TEXT,
  content_hash TEXT NOT NULL,
  snippet TEXT,

  FOREIGN KEY (memory_id) REFERENCES memory_objects(id) ON DELETE CASCADE
);

CREATE INDEX idx_code_refs_memory ON code_refs(memory_id);
CREATE INDEX idx_code_refs_file ON code_refs(file);
CREATE INDEX idx_code_refs_symbol ON code_refs(symbol);

-- Symbols index (extracted from codebase)
CREATE TABLE symbols (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  file TEXT NOT NULL,
  line INTEGER NOT NULL,
  end_line INTEGER,
  signature TEXT,                -- Function signature, etc.
  content_hash TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_symbols_name ON symbols(name);
CREATE INDEX idx_symbols_file ON symbols(file);
CREATE INDEX idx_symbols_project ON symbols(project_id);

-- File hashes for staleness detection
CREATE TABLE file_hashes (
  project_id TEXT NOT NULL,
  file TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, file)
);
```

```sql
-- events.db

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  event_type TEXT NOT NULL,
  content TEXT,
  metadata TEXT,                 -- JSON

  -- Tool context
  tool_name TEXT,
  tool_input TEXT,
  tool_output TEXT,
  exit_code INTEGER,

  -- Code context
  active_file TEXT,
  recent_files TEXT,             -- JSON array

  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX idx_events_session ON events(session_id);
CREATE INDEX idx_events_timestamp ON events(timestamp);
CREATE INDEX idx_events_type ON events(event_type);

-- Sessions table
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  working_directory TEXT NOT NULL,
  initial_branch TEXT,
  task_description TEXT,
  event_count INTEGER DEFAULT 0,
  checkpoint_count INTEGER DEFAULT 0,
  memories_extracted INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  outcome TEXT
);

CREATE INDEX idx_sessions_project ON sessions(project_id);
CREATE INDEX idx_sessions_status ON sessions(status);

-- Checkpoints
CREATE TABLE checkpoints (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  trigger TEXT NOT NULL,          -- 'auto', 'manual', 'session_end'
  event_start_id TEXT,           -- First event in checkpoint
  event_end_id TEXT,             -- Last event in checkpoint
  memories_extracted INTEGER DEFAULT 0,

  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
```

---

## Storage Layer

### SQLite Configuration

```typescript
import { Database } from 'bun:sqlite';

function createDatabase(path: string): Database {
  const db = new Database(path);

  // Performance optimizations for local-first
  db.exec(`
    PRAGMA journal_mode = WAL;           -- Write-ahead logging
    PRAGMA synchronous = NORMAL;         -- Balance durability/speed
    PRAGMA cache_size = -64000;          -- 64MB cache
    PRAGMA temp_store = MEMORY;          -- Temp tables in memory
    PRAGMA mmap_size = 268435456;        -- 256MB memory-mapped I/O
    PRAGMA busy_timeout = 5000;          -- 5s busy timeout
  `);

  return db;
}
```

### Vector Index

```typescript
import { VectorIndex } from './vector-index';

interface VectorIndexConfig {
  dimensions: number;            // 1536 for OpenAI, 1024 for local
  metric: 'cosine' | 'euclidean' | 'dot';
  efConstruction: number;        // HNSW build-time parameter
  efSearch: number;              // HNSW query-time parameter
}

class VectorStore {
  private index: VectorIndex;
  private embedder: Embedder;

  async indexMemory(memory: MemoryObject): Promise<void> {
    const embedding = await this.embedder.embed(memory.content);
    await this.index.add(memory.id, embedding, {
      type: memory.type,
      status: memory.status,
    });
  }

  async search(
    query: string,
    options: { limit: number; filter?: Record<string, unknown> }
  ): Promise<Array<{ id: string; score: number }>> {
    const queryEmbedding = await this.embedder.embed(query);
    return this.index.search(queryEmbedding, options);
  }
}
```

### Symbol Index

```typescript
interface SymbolIndexer {
  /**
   * Index all symbols in a file
   */
  indexFile(file: string, content: string): Symbol[];

  /**
   * Find symbols matching a query
   */
  findSymbols(query: string, options?: {
    type?: SymbolType;
    file?: string;
    limit?: number;
  }): Symbol[];

  /**
   * Get symbol at a specific location
   */
  getSymbolAt(file: string, line: number): Symbol | null;

  /**
   * Check if a symbol still exists
   */
  symbolExists(file: string, name: string, type: SymbolType): boolean;
}

// Implementation using tree-sitter for parsing
class TreeSitterSymbolIndexer implements SymbolIndexer {
  private parsers: Map<string, Parser>;  // Language -> Parser

  indexFile(file: string, content: string): Symbol[] {
    const ext = path.extname(file);
    const parser = this.getParser(ext);
    const tree = parser.parse(content);

    return this.extractSymbols(tree.rootNode, file);
  }

  private extractSymbols(node: SyntaxNode, file: string): Symbol[] {
    const symbols: Symbol[] = [];

    // Traverse AST and extract function/class/etc declarations
    const visit = (node: SyntaxNode) => {
      switch (node.type) {
        case 'function_declaration':
        case 'arrow_function':
          symbols.push(this.extractFunction(node, file));
          break;
        case 'class_declaration':
          symbols.push(this.extractClass(node, file));
          break;
        // ... more symbol types
      }
      for (const child of node.children) {
        visit(child);
      }
    };

    visit(node);
    return symbols;
  }
}
```

---

## Ingestion Pipeline

### Event Flow

```
Agent Activity
      │
      ▼
┌─────────────────┐
│   Event Hook    │  ◀── Claude Code hooks, IDE plugin, CLI
└─────────────────┘
      │
      ▼
┌─────────────────┐
│  Event Buffer   │  ◀── In-memory ring buffer
│  (per session)  │
└─────────────────┘
      │
      │ Trigger conditions:
      │ • 10 events accumulated
      │ • Manual checkpoint command
      │ • Session end
      │ • Significant event (test pass, build success)
      ▼
┌─────────────────┐
│   Checkpoint    │
│    Trigger      │
└─────────────────┘
      │
      ├────────────────┬────────────────┐
      ▼                ▼                ▼
┌──────────┐    ┌──────────┐    ┌──────────┐
│  Tier 0  │    │  Tier 1  │    │  Tier 2  │
│Determin. │    │  Haiku   │    │  Sonnet  │
└──────────┘    └──────────┘    └──────────┘
      │                │                │
      ▼                ▼                ▼
   Patterns         Decisions       Complex
   • error→fix      • rationale     architecture
   • corrections    • conventions   decisions
   • repeated       • preferences   (future)
      │                │                │
      └────────────────┴────────────────┘
                       │
                       ▼
              ┌─────────────────┐
              │ Memory Objects  │
              │ (status=pending)│
              └─────────────────┘
                       │
                       ▼
              ┌─────────────────┐
              │  Human Review   │
              │   (optional)    │
              └─────────────────┘
                       │
                       ▼
              ┌─────────────────┐
              │ Memory Objects  │
              │ (status=active) │
              └─────────────────┘
```

### Tier 0: Deterministic Extraction

```typescript
interface DeterministicExtractor {
  /**
   * Extract patterns that don't require LLM
   */
  extract(events: Event[]): MemoryObject[];
}

class PatternBasedExtractor implements DeterministicExtractor {
  extract(events: Event[]): MemoryObject[] {
    const memories: MemoryObject[] = [];

    // Pattern 1: Error followed by fix
    memories.push(...this.extractErrorFixes(events));

    // Pattern 2: User correction
    memories.push(...this.extractCorrections(events));

    // Pattern 3: Repeated actions (indicates convention)
    memories.push(...this.extractRepeatedPatterns(events));

    // Pattern 4: Explicit markers
    memories.push(...this.extractExplicitMarkers(events));

    return memories;
  }

  private extractErrorFixes(events: Event[]): MemoryObject[] {
    const memories: MemoryObject[] = [];

    for (let i = 0; i < events.length - 1; i++) {
      const event = events[i];
      const nextEvents = events.slice(i + 1);

      // Look for error followed by successful resolution
      if (event.eventType === 'tool_result' && event.exitCode !== 0) {
        const errorContent = event.toolOutput || event.content;

        // Find subsequent success with same tool
        const fix = nextEvents.find(e =>
          e.eventType === 'tool_result' &&
          e.toolName === event.toolName &&
          e.exitCode === 0
        );

        if (fix) {
          memories.push({
            id: generateId(),
            type: 'known_fix',
            content: this.formatErrorFix(event, fix),
            extractedFrom: [event.id, fix.id],
            extractionMethod: 'deterministic',
            confidence: 0.9,
            // ... other fields
          });
        }
      }
    }

    return memories;
  }

  private extractCorrections(events: Event[]): MemoryObject[] {
    // Detect when user corrects agent behavior
    // e.g., "No, don't use X, use Y instead"
    const corrections: MemoryObject[] = [];

    const correctionPatterns = [
      /no,?\s+(don't|do not|never)\s+(.+)/i,
      /instead\s+(use|do|try)\s+(.+)/i,
      /actually,?\s+(.+)/i,
      /that's wrong,?\s+(.+)/i,
    ];

    for (const event of events) {
      if (event.eventType === 'user_prompt') {
        for (const pattern of correctionPatterns) {
          const match = event.content.match(pattern);
          if (match) {
            corrections.push({
              id: generateId(),
              type: 'constraint',  // User corrections become constraints
              content: event.content,
              extractedFrom: [event.id],
              extractionMethod: 'deterministic',
              confidence: 0.95,  // High confidence for explicit corrections
            });
            break;
          }
        }
      }
    }

    return corrections;
  }
}
```

### Tier 1: LLM Extraction (Haiku)

```typescript
interface LLMExtractor {
  extract(events: Event[], context: ExtractionContext): Promise<MemoryObject[]>;
}

class HaikuExtractor implements LLMExtractor {
  private client: Anthropic;

  async extract(events: Event[], context: ExtractionContext): Promise<MemoryObject[]> {
    const prompt = this.buildPrompt(events, context);

    const response = await this.client.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    return this.parseResponse(response.content[0].text, events);
  }

  private buildPrompt(events: Event[], context: ExtractionContext): string {
    return `You are extracting reusable memories from a coding agent session.

## Session Context
Project: ${context.projectPath}
Current file: ${context.activeFile}
Task: ${context.taskDescription || 'Unknown'}

## Recent Events
${this.formatEvents(events)}

## Instructions
Extract memories that would be useful in future sessions. Focus on:
1. **Decisions**: Technical choices with rationale (why X over Y)
2. **Conventions**: Coding patterns or standards used
3. **Known Fixes**: Solutions to problems encountered
4. **Failed Attempts**: What didn't work and why
5. **Constraints**: Rules that must be followed

For each memory, provide:
- type: decision|convention|known_fix|failed_attempt|constraint
- content: The memory itself (actionable, specific)
- code_refs: Files/lines referenced (if any)
- confidence: 0-1 how confident this is a real memory

## Output Format
Return JSON array:
[
  {
    "type": "decision",
    "content": "Using Zod for runtime validation because TypeScript types are compile-time only",
    "code_refs": [{"file": "src/schemas/user.ts", "line": 1}],
    "confidence": 0.9
  }
]

Only extract memories that are:
- Specific and actionable
- Likely to be useful again
- Not obvious/generic

If no memories to extract, return empty array: []`;
  }
}
```

---

## Code Reference System

### Reference Creation

```typescript
class CodeRefManager {
  private symbolIndex: SymbolIndexer;
  private gitClient: GitClient;

  /**
   * Create code references from memory content
   */
  async createReferences(
    content: string,
    context: { activeFile?: string; recentFiles?: string[] }
  ): Promise<CodeReference[]> {
    const refs: CodeReference[] = [];

    // 1. Extract explicit file:line references
    const explicitRefs = this.extractExplicitRefs(content);
    refs.push(...explicitRefs);

    // 2. Find symbol mentions
    const symbolRefs = await this.findSymbolRefs(content);
    refs.push(...symbolRefs);

    // 3. Add active file if relevant
    if (context.activeFile && this.isRelevantToContent(content, context.activeFile)) {
      refs.push(await this.createFileRef(context.activeFile));
    }

    // Deduplicate and enrich with current hashes
    return this.enrichRefs(refs);
  }

  private extractExplicitRefs(content: string): CodeReference[] {
    // Match patterns like:
    // - src/file.ts:42
    // - `src/file.ts` line 42
    // - in file.ts at line 42-50

    const patterns = [
      /([a-zA-Z0-9_\-./]+\.[a-z]+):(\d+)(?:-(\d+))?/g,
      /`([a-zA-Z0-9_\-./]+\.[a-z]+)`\s+(?:line\s+)?(\d+)/gi,
    ];

    const refs: CodeReference[] = [];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        refs.push({
          file: match[1],
          line: parseInt(match[2]),
          endLine: match[3] ? parseInt(match[3]) : undefined,
          contentHash: '', // Will be filled by enrichRefs
        });
      }
    }

    return refs;
  }

  private async findSymbolRefs(content: string): Promise<CodeReference[]> {
    // Find function/class names mentioned in content
    const words = content.match(/\b[A-Z][a-zA-Z0-9]+\b|\b[a-z]+[A-Z][a-zA-Z0-9]*\b/g) || [];

    const refs: CodeReference[] = [];
    for (const word of new Set(words)) {
      const symbols = this.symbolIndex.findSymbols(word, { limit: 1 });
      if (symbols.length > 0) {
        const sym = symbols[0];
        refs.push({
          file: sym.file,
          line: sym.line,
          symbol: sym.name,
          symbolType: sym.type,
          contentHash: sym.contentHash,
        });
      }
    }

    return refs;
  }

  private async enrichRefs(refs: CodeReference[]): Promise<CodeReference[]> {
    return Promise.all(refs.map(async ref => {
      if (!ref.contentHash) {
        ref.contentHash = await this.computeRefHash(ref);
      }
      if (!ref.snippet && ref.line) {
        ref.snippet = await this.getSnippet(ref.file, ref.line, ref.endLine);
      }
      return ref;
    }));
  }
}
```

### Reference Validation

```typescript
class CodeRefValidator {
  /**
   * Check if a code reference is still valid
   */
  async validate(ref: CodeReference): Promise<ValidationResult> {
    // 1. Check if file exists
    if (!await this.fileExists(ref.file)) {
      return {
        valid: false,
        reason: 'file_deleted',
        suggestion: await this.findSimilarFile(ref.file),
      };
    }

    // 2. Check content hash
    const currentHash = await this.computeHash(ref.file, ref.line, ref.endLine);
    if (currentHash !== ref.contentHash) {
      // Content changed - check if symbol still exists
      if (ref.symbol) {
        const symbol = await this.findSymbol(ref.file, ref.symbol);
        if (symbol) {
          return {
            valid: true,
            updated: true,
            newLine: symbol.line,
            newHash: symbol.contentHash,
          };
        }
        return {
          valid: false,
          reason: 'symbol_removed',
          suggestion: await this.findSymbolElsewhere(ref.symbol),
        };
      }

      return {
        valid: false,
        reason: 'content_changed',
        diff: await this.computeDiff(ref),
      };
    }

    return { valid: true };
  }
}
```

---

## Retrieval Engine

### Query Router

```typescript
interface QueryRouter {
  /**
   * Route query to appropriate search strategy
   */
  route(query: QueryContext): SearchStrategy;
}

interface QueryContext {
  query: string;                 // The search query
  currentFile?: string;          // File being edited
  recentFiles?: string[];        // Recently touched files
  taskDescription?: string;      // Current task
  tokenBudget: number;           // Max tokens for context
}

type SearchStrategy =
  | { type: 'file_focused'; files: string[] }
  | { type: 'symbol_search'; symbols: string[] }
  | { type: 'semantic_search'; query: string }
  | { type: 'constraint_lookup' }
  | { type: 'hybrid'; weights: SearchWeights };

class SmartQueryRouter implements QueryRouter {
  route(ctx: QueryContext): SearchStrategy {
    const query = ctx.query.toLowerCase();

    // Constraint queries
    if (/never|always|must|required|forbidden/.test(query)) {
      return { type: 'constraint_lookup' };
    }

    // File-specific queries
    if (ctx.currentFile && this.isFileSpecific(query)) {
      return {
        type: 'file_focused',
        files: [ctx.currentFile, ...(ctx.recentFiles || [])],
      };
    }

    // Symbol queries
    const symbols = this.extractSymbolMentions(query);
    if (symbols.length > 0) {
      return { type: 'symbol_search', symbols };
    }

    // Default: hybrid search
    return {
      type: 'hybrid',
      weights: this.computeWeights(ctx),
    };
  }
}
```

### Hybrid Search

```typescript
class HybridSearcher {
  private fts: FTSIndex;
  private vector: VectorStore;
  private symbols: SymbolIndex;
  private codeRefs: CodeRefManager;

  async search(
    query: string,
    options: SearchOptions
  ): Promise<ScoredMemory[]> {
    // Run searches in parallel
    const [ftsResults, vectorResults, symbolResults, refResults] = await Promise.all([
      this.fts.search(query, options.limit * 2),
      this.vector.search(query, { limit: options.limit * 2, filter: options.filter }),
      this.searchBySymbols(query, options),
      this.searchByCodeRefs(query, options),
    ]);

    // Reciprocal Rank Fusion
    const weights = options.weights || { fts: 0.3, vector: 0.3, symbol: 0.2, ref: 0.2 };
    const fused = this.rrf([
      { results: ftsResults, weight: weights.fts },
      { results: vectorResults, weight: weights.vector },
      { results: symbolResults, weight: weights.symbol },
      { results: refResults, weight: weights.ref },
    ]);

    // Filter stale memories
    const active = await this.filterStale(fused);

    // Apply constraints boost
    return this.boostConstraints(active, options.limit);
  }

  private rrf(
    inputs: Array<{ results: ScoredMemory[]; weight: number }>
  ): ScoredMemory[] {
    const k = 60;  // RRF constant
    const scores = new Map<string, number>();

    for (const { results, weight } of inputs) {
      for (let rank = 0; rank < results.length; rank++) {
        const mem = results[rank];
        const current = scores.get(mem.id) || 0;
        scores.set(mem.id, current + weight * (1 / (k + rank)));
      }
    }

    // Sort by fused score
    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, score]) => ({ id, score }));
  }
}
```

### Context Pack Generation

```typescript
interface ContextPack {
  memories: MemoryObject[];
  constraints: MemoryObject[];
  tokenCount: number;
  metadata: {
    query: string;
    strategy: SearchStrategy;
    searchTimeMs: number;
  };
}

class ContextPackGenerator {
  private searcher: HybridSearcher;
  private tokenCounter: TokenCounter;

  async generate(ctx: QueryContext): Promise<ContextPack> {
    const startTime = Date.now();

    // 1. Always include active constraints
    const constraints = await this.getActiveConstraints();
    let tokens = this.tokenCounter.count(constraints);

    // 2. Search for relevant memories
    const results = await this.searcher.search(ctx.query, {
      limit: 50,
      filter: { status: 'active' },
    });

    // 3. Select memories within token budget
    const memories: MemoryObject[] = [];
    for (const result of results) {
      const mem = await this.getMemory(result.id);
      const memTokens = this.tokenCounter.count(mem);

      if (tokens + memTokens <= ctx.tokenBudget) {
        memories.push(mem);
        tokens += memTokens;
      } else {
        break;
      }
    }

    // 4. Order by relevance and type priority
    const ordered = this.orderMemories(memories, ctx);

    return {
      memories: ordered,
      constraints,
      tokenCount: tokens,
      metadata: {
        query: ctx.query,
        strategy: this.router.route(ctx),
        searchTimeMs: Date.now() - startTime,
      },
    };
  }

  private orderMemories(memories: MemoryObject[], ctx: QueryContext): MemoryObject[] {
    // Priority order:
    // 1. Constraints (always first)
    // 2. File-specific memories (if file context provided)
    // 3. Recent decisions
    // 4. Known fixes
    // 5. Other

    return memories.sort((a, b) => {
      const priorityA = this.getPriority(a, ctx);
      const priorityB = this.getPriority(b, ctx);
      return priorityB - priorityA;
    });
  }
}
```

---

## Staleness Detection

### Staleness Checker

```typescript
interface StalenessChecker {
  /**
   * Check if a memory is stale
   */
  check(memory: MemoryObject): Promise<StalenessResult>;

  /**
   * Batch check all memories with code refs
   */
  checkAll(): Promise<StalenessReport>;
}

interface StalenessResult {
  isStale: boolean;
  reason?: StalenessReason;
  details?: string;
  suggestion?: string;
}

type StalenessReason =
  | 'file_deleted'
  | 'file_moved'
  | 'content_changed'
  | 'symbol_removed'
  | 'symbol_renamed'
  | 'branch_diverged';

class GitAwareStalenessChecker implements StalenessChecker {
  private git: GitClient;
  private refValidator: CodeRefValidator;
  private db: Database;

  async check(memory: MemoryObject): Promise<StalenessResult> {
    // Skip if no code refs
    if (memory.codeRefs.length === 0) {
      return { isStale: false };
    }

    // Check each code ref
    for (const ref of memory.codeRefs) {
      const validation = await this.refValidator.validate(ref);
      if (!validation.valid) {
        return {
          isStale: true,
          reason: validation.reason as StalenessReason,
          details: `${ref.file}:${ref.line} - ${validation.reason}`,
          suggestion: validation.suggestion,
        };
      }
    }

    // Check if memory's git context diverged significantly
    if (memory.gitContext) {
      const diverged = await this.checkGitDivergence(memory);
      if (diverged) {
        return {
          isStale: true,
          reason: 'branch_diverged',
          details: `Memory from ${memory.gitContext.branch}, now on different history`,
        };
      }
    }

    return { isStale: false };
  }

  async checkAll(): Promise<StalenessReport> {
    // Get all active memories with code refs
    const memories = await this.db.query<MemoryObject>(`
      SELECT m.* FROM memory_objects m
      JOIN code_refs r ON m.id = r.memory_id
      WHERE m.status = 'active'
      GROUP BY m.id
    `);

    const results: Map<string, StalenessResult> = new Map();
    const stale: string[] = [];

    for (const memory of memories) {
      const result = await this.check(memory);
      results.set(memory.id, result);
      if (result.isStale) {
        stale.push(memory.id);
      }
    }

    return {
      total: memories.length,
      stale: stale.length,
      results,
      staleIds: stale,
    };
  }
}
```

### Automatic Staleness Updates

```typescript
class StalenessWatcher {
  private checker: StalenessChecker;
  private watcher: FSWatcher;

  /**
   * Watch for file changes and update staleness
   */
  start(): void {
    this.watcher = watch(
      this.projectRoot,
      { recursive: true },
      async (event, filename) => {
        if (!filename || this.shouldIgnore(filename)) return;

        // Find memories referencing this file
        const affected = await this.findAffectedMemories(filename);

        for (const memory of affected) {
          const result = await this.checker.check(memory);
          if (result.isStale) {
            await this.markStale(memory.id, result);
          }
        }
      }
    );
  }

  private async findAffectedMemories(file: string): Promise<MemoryObject[]> {
    return this.db.query(`
      SELECT m.* FROM memory_objects m
      JOIN code_refs r ON m.id = r.memory_id
      WHERE r.file = ? AND m.status = 'active'
    `, [file]);
  }
}
```

---

## Memory Lifecycle

### State Machine

```
                    ┌─────────────┐
                    │   PENDING   │
                    └──────┬──────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
           ▼               ▼               ▼
    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │ APPROVED │    │ REJECTED │    │  EDITED  │
    └────┬─────┘    └──────────┘    └────┬─────┘
         │                               │
         └───────────────┬───────────────┘
                         │
                         ▼
                  ┌──────────┐
                  │  ACTIVE  │◀───────────────┐
                  └────┬─────┘                │
                       │                      │
         ┌─────────────┼─────────────┐        │
         │             │             │        │
         ▼             ▼             ▼        │
  ┌──────────┐  ┌───────────┐  ┌──────────┐  │
  │  STALE   │  │SUPERSEDED │  │ ARCHIVED │  │
  └────┬─────┘  └───────────┘  └──────────┘  │
       │                                      │
       │      ┌─────────────┐                 │
       └─────▶│  REVALIDATE │─────────────────┘
              └─────────────┘
```

### Lifecycle Manager

```typescript
class MemoryLifecycle {
  /**
   * Transition memory between states
   */
  async transition(
    memoryId: string,
    action: LifecycleAction,
    options?: TransitionOptions
  ): Promise<void> {
    const memory = await this.getMemory(memoryId);
    const newStatus = this.getNewStatus(memory.status, action);

    if (!this.isValidTransition(memory.status, newStatus)) {
      throw new Error(`Invalid transition: ${memory.status} -> ${newStatus}`);
    }

    await this.db.run(`
      UPDATE memory_objects
      SET status = ?,
          updated_at = datetime('now'),
          superseded_by = ?
      WHERE id = ?
    `, [newStatus, options?.supersededBy, memoryId]);

    // Handle side effects
    if (action === 'supersede' && options?.supersededBy) {
      // Create relationship
      await this.addRelationship(memoryId, options.supersededBy, 'superseded_by');
    }

    if (action === 'revalidate') {
      // Update verification timestamp
      await this.updateVerification(memoryId);
    }
  }

  /**
   * Supersede one memory with another
   */
  async supersede(oldId: string, newMemory: MemoryObject): Promise<string> {
    // Create new memory
    const newId = await this.create(newMemory);

    // Mark old as superseded
    await this.transition(oldId, 'supersede', { supersededBy: newId });

    return newId;
  }

  /**
   * Archive old/unused memories
   */
  async archiveUnused(daysThreshold: number): Promise<number> {
    const result = await this.db.run(`
      UPDATE memory_objects
      SET status = 'archived',
          updated_at = datetime('now')
      WHERE status = 'active'
        AND last_accessed_at < datetime('now', '-' || ? || ' days')
        AND type NOT IN ('constraint', 'security')
    `, [daysThreshold]);

    return result.changes;
  }
}
```

---

## Agent Integration

### Claude Code Hooks

```typescript
// integrations/claude-code/hooks.ts

interface HookHandlers {
  onSessionStart(ctx: SessionContext): Promise<void>;
  onUserPrompt(prompt: string, ctx: SessionContext): Promise<void>;
  onAssistantResponse(response: string, ctx: SessionContext): Promise<void>;
  onToolCall(tool: string, input: unknown, ctx: SessionContext): Promise<void>;
  onToolResult(tool: string, result: unknown, ctx: SessionContext): Promise<void>;
  onSessionEnd(ctx: SessionContext): Promise<void>;
}

const handlers: HookHandlers = {
  async onSessionStart(ctx) {
    // Start new session
    await alexandria.session.start({
      projectId: ctx.projectPath,
      workingDirectory: ctx.cwd,
    });

    // Load context pack for current state
    const pack = await alexandria.pack({
      currentFile: ctx.activeFile,
      tokenBudget: 2000,
    });

    // Inject into system prompt
    ctx.injectContext(formatContextPack(pack));
  },

  async onToolResult(tool, result, ctx) {
    // Buffer event
    await alexandria.events.append({
      type: 'tool_result',
      toolName: tool,
      toolOutput: JSON.stringify(result),
      exitCode: result.exitCode,
      activeFile: ctx.activeFile,
    });

    // Check for checkpoint trigger
    if (await alexandria.shouldCheckpoint()) {
      await alexandria.checkpoint();
    }
  },

  async onSessionEnd(ctx) {
    // Final checkpoint
    await alexandria.checkpoint({ trigger: 'session_end' });

    // End session
    await alexandria.session.end({
      outcome: ctx.outcome,
    });
  },
};
```

### Context Injection

```typescript
function formatContextPack(pack: ContextPack): string {
  const sections: string[] = [];

  // Constraints section (always first)
  if (pack.constraints.length > 0) {
    sections.push(`## Constraints (MUST follow)
${pack.constraints.map(c => `- ${c.content}`).join('\n')}`);
  }

  // Relevant memories
  if (pack.memories.length > 0) {
    const byType = groupBy(pack.memories, m => m.type);

    if (byType.decision) {
      sections.push(`## Relevant Decisions
${byType.decision.map(m => `- ${m.content}`).join('\n')}`);
    }

    if (byType.known_fix) {
      sections.push(`## Known Solutions
${byType.known_fix.map(m => `- ${m.content}`).join('\n')}`);
    }

    if (byType.failed_attempt) {
      sections.push(`## Known Issues (avoid these)
${byType.failed_attempt.map(m => `- ${m.content}`).join('\n')}`);
    }
  }

  return sections.join('\n\n');
}
```

---

## Scaling Considerations

### Monorepo Support

```typescript
interface MonorepoConfig {
  root: string;
  packages: PackageConfig[];
  sharedMemories: boolean;  // Share memories across packages
}

interface PackageConfig {
  name: string;
  path: string;
  isolated: boolean;  // Isolated memory store
}

class MonorepoMemoryManager {
  /**
   * Get memories for a specific package
   */
  async getPackageMemories(packageName: string): Promise<MemoryObject[]> {
    const pkg = this.config.packages.find(p => p.name === packageName);
    if (!pkg) throw new Error(`Unknown package: ${packageName}`);

    if (pkg.isolated) {
      // Return only package-specific memories
      return this.db.query(`
        SELECT * FROM memory_objects
        WHERE project_id = ?
          AND status = 'active'
      `, [this.getPackageId(pkg)]);
    }

    // Return package memories + shared root memories
    return this.db.query(`
      SELECT * FROM memory_objects
      WHERE (project_id = ? OR project_id = ?)
        AND status = 'active'
    `, [this.getPackageId(pkg), this.rootProjectId]);
  }
}
```

### Memory Consolidation

```typescript
class MemoryConsolidator {
  /**
   * Consolidate similar memories to reduce noise
   */
  async consolidate(): Promise<ConsolidationResult> {
    // Find similar memories
    const clusters = await this.clusterSimilar();

    const merged: string[] = [];
    for (const cluster of clusters) {
      if (cluster.length > 1) {
        // Create consolidated memory
        const consolidated = await this.merge(cluster);
        merged.push(consolidated.id);

        // Supersede old memories
        for (const old of cluster) {
          await this.lifecycle.transition(old.id, 'supersede', {
            supersededBy: consolidated.id,
          });
        }
      }
    }

    return { mergedCount: merged.length };
  }

  private async clusterSimilar(): Promise<MemoryObject[][]> {
    // Use embedding similarity to find clusters
    const all = await this.getAllActive();
    const embeddings = await Promise.all(
      all.map(m => this.embedder.embed(m.content))
    );

    // Hierarchical clustering
    return this.hierarchicalCluster(all, embeddings, {
      threshold: 0.9,  // High similarity threshold
    });
  }
}
```

### Performance Optimizations

```typescript
// Caching layer
class MemoryCache {
  private lru: LRUCache<string, MemoryObject>;
  private contextCache: LRUCache<string, ContextPack>;

  async getMemory(id: string): Promise<MemoryObject> {
    const cached = this.lru.get(id);
    if (cached) return cached;

    const memory = await this.db.get(id);
    this.lru.set(id, memory);
    return memory;
  }

  async getContextPack(key: string): Promise<ContextPack | null> {
    return this.contextCache.get(key) || null;
  }
}

// Batch operations
class BatchProcessor {
  async batchValidate(memoryIds: string[]): Promise<Map<string, boolean>> {
    // Batch file existence checks
    const files = await this.getUniqueFiles(memoryIds);
    const fileExists = await this.batchCheckFiles(files);

    // Batch hash computations
    const hashes = await this.batchComputeHashes(files);

    // Validate each memory
    const results = new Map<string, boolean>();
    for (const id of memoryIds) {
      const memory = await this.cache.getMemory(id);
      const valid = this.validateWithCache(memory, fileExists, hashes);
      results.set(id, valid);
    }

    return results;
  }
}
```

---

## Future Considerations

### Cross-Project Learning

```typescript
// Share anonymized patterns across projects
interface CrossProjectLearning {
  // Export generalizable patterns
  exportPatterns(): Pattern[];

  // Import patterns from community
  importPatterns(patterns: Pattern[]): void;
}
```

### Memory Importance Scoring

```typescript
interface MemoryImportance {
  // Track memory usage
  trackAccess(memoryId: string): void;

  // Calculate importance score
  getImportance(memoryId: string): number;

  // Decay unused memories
  applyDecay(): void;
}
```

### Conflict Resolution

```typescript
interface ConflictResolver {
  // Detect conflicting memories
  detectConflicts(): Conflict[];

  // Resolve with user input
  resolve(conflict: Conflict, resolution: Resolution): void;
}
```

---

*Last updated: January 2025*
