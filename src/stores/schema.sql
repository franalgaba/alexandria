-- Alexandria Database Schema
-- Version: 1.0.0

-- ============================================================================
-- SESSIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    
    -- Context
    working_directory TEXT,
    working_file TEXT,
    working_task TEXT,
    summary TEXT,
    
    -- Stats
    events_count INTEGER DEFAULT 0,
    objects_created INTEGER DEFAULT 0,
    objects_accessed INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);

-- ============================================================================
-- BLOBS TABLE (for large payloads)
-- ============================================================================

CREATE TABLE IF NOT EXISTS blobs (
    id TEXT PRIMARY KEY,
    content BLOB NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL
);

-- ============================================================================
-- EVENTS TABLE (append-only log)
-- ============================================================================

CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('turn', 'tool_output', 'diff', 'test_summary', 'error')),
    
    -- Content (inline for small, pointer for large)
    content TEXT,
    blob_id TEXT,
    
    -- Metadata
    tool_name TEXT,
    file_path TEXT,
    exit_code INTEGER,
    
    -- Indexing helpers
    content_hash TEXT,
    token_count INTEGER,
    
    FOREIGN KEY (session_id) REFERENCES sessions(id),
    FOREIGN KEY (blob_id) REFERENCES blobs(id)
);

CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_content_hash ON events(content_hash);

-- ============================================================================
-- MEMORY OBJECTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS memory_objects (
    id TEXT PRIMARY KEY,
    
    -- Content
    content TEXT NOT NULL,
    object_type TEXT NOT NULL CHECK (object_type IN (
        'decision',
        'preference',
        'convention',
        'known_fix',
        'constraint',
        'failed_attempt',
        'environment'
    )),
    
    -- Scope
    scope_type TEXT DEFAULT 'project' CHECK (scope_type IN (
        'global',
        'project',
        'module',
        'file'
    )),
    scope_path TEXT,
    
    -- Status lifecycle
    status TEXT DEFAULT 'active' CHECK (status IN (
        'active',
        'stale',
        'superseded',
        'retired'
    )),
    superseded_by TEXT,
    
    -- Confidence & evidence
    confidence TEXT DEFAULT 'medium' CHECK (confidence IN (
        'certain',
        'high',
        'medium',
        'low'
    )),
    evidence_event_ids TEXT,  -- JSON array
    evidence_excerpt TEXT,
    
    -- Review state
    review_status TEXT DEFAULT 'pending' CHECK (review_status IN (
        'pending',
        'approved',
        'rejected'
    )),
    reviewed_at TEXT,
    
    -- Timestamps
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    
    -- Usage tracking
    access_count INTEGER DEFAULT 0,
    last_accessed TEXT,
    
    FOREIGN KEY (superseded_by) REFERENCES memory_objects(id)
);

CREATE INDEX IF NOT EXISTS idx_memory_objects_status ON memory_objects(status);
CREATE INDEX IF NOT EXISTS idx_memory_objects_object_type ON memory_objects(object_type);
CREATE INDEX IF NOT EXISTS idx_memory_objects_review_status ON memory_objects(review_status);
CREATE INDEX IF NOT EXISTS idx_memory_objects_scope ON memory_objects(scope_type, scope_path);

-- ============================================================================
-- TOKEN INDEX (for exact matching)
-- ============================================================================

CREATE TABLE IF NOT EXISTS object_tokens (
    object_id TEXT NOT NULL,
    token TEXT NOT NULL,
    token_type TEXT CHECK (token_type IN (
        'identifier',
        'path',
        'command',
        'version',
        'error_code',
        'flag'
    )),
    PRIMARY KEY (object_id, token),
    FOREIGN KEY (object_id) REFERENCES memory_objects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tokens ON object_tokens(token);
CREATE INDEX IF NOT EXISTS idx_tokens_type ON object_tokens(token_type);

-- ============================================================================
-- FTS5 VIRTUAL TABLES
-- ============================================================================

-- FTS5 index over events
CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
    content,
    tool_name,
    file_path,
    content='events',
    content_rowid='rowid',
    tokenize='porter unicode61'
);

-- Triggers to keep events FTS in sync
CREATE TRIGGER IF NOT EXISTS events_ai AFTER INSERT ON events BEGIN
    INSERT INTO events_fts(rowid, content, tool_name, file_path)
    VALUES (NEW.rowid, NEW.content, NEW.tool_name, NEW.file_path);
END;

CREATE TRIGGER IF NOT EXISTS events_ad AFTER DELETE ON events BEGIN
    INSERT INTO events_fts(events_fts, rowid, content, tool_name, file_path)
    VALUES ('delete', OLD.rowid, OLD.content, OLD.tool_name, OLD.file_path);
END;

CREATE TRIGGER IF NOT EXISTS events_au AFTER UPDATE ON events BEGIN
    INSERT INTO events_fts(events_fts, rowid, content, tool_name, file_path)
    VALUES ('delete', OLD.rowid, OLD.content, OLD.tool_name, OLD.file_path);
    INSERT INTO events_fts(rowid, content, tool_name, file_path)
    VALUES (NEW.rowid, NEW.content, NEW.tool_name, NEW.file_path);
END;

-- FTS5 index over memory objects
CREATE VIRTUAL TABLE IF NOT EXISTS memory_objects_fts USING fts5(
    content,
    scope_path,
    content='memory_objects',
    content_rowid='rowid',
    tokenize='porter unicode61'
);

-- Triggers to keep memory objects FTS in sync
CREATE TRIGGER IF NOT EXISTS memory_objects_ai AFTER INSERT ON memory_objects BEGIN
    INSERT INTO memory_objects_fts(rowid, content, scope_path)
    VALUES (NEW.rowid, NEW.content, NEW.scope_path);
END;

CREATE TRIGGER IF NOT EXISTS memory_objects_ad AFTER DELETE ON memory_objects BEGIN
    INSERT INTO memory_objects_fts(memory_objects_fts, rowid, content, scope_path)
    VALUES ('delete', OLD.rowid, OLD.content, OLD.scope_path);
END;

CREATE TRIGGER IF NOT EXISTS memory_objects_au AFTER UPDATE ON memory_objects BEGIN
    INSERT INTO memory_objects_fts(memory_objects_fts, rowid, content, scope_path)
    VALUES ('delete', OLD.rowid, OLD.content, OLD.scope_path);
    INSERT INTO memory_objects_fts(rowid, content, scope_path)
    VALUES (NEW.rowid, NEW.content, NEW.scope_path);
END;

-- ============================================================================
-- EMBEDDING TABLES (for sqlite-vec)
-- We'll create these conditionally when sqlite-vec is available
-- ============================================================================

-- Note: Vector tables are created separately in code since they require sqlite-vec extension
-- CREATE VIRTUAL TABLE IF NOT EXISTS event_embeddings USING vec0(
--     event_id TEXT PRIMARY KEY,
--     embedding FLOAT[384]
-- );
-- 
-- CREATE VIRTUAL TABLE IF NOT EXISTS object_embeddings USING vec0(
--     object_id TEXT PRIMARY KEY,
--     embedding FLOAT[384]
-- );
