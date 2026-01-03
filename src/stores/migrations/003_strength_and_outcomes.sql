-- Migration 003: Memory Strength and Outcomes
-- Adds brain-inspired memory evolution features

-- Phase 1: Memory strength and decay
ALTER TABLE memory_objects ADD COLUMN strength REAL DEFAULT 1.0;
ALTER TABLE memory_objects ADD COLUMN last_reinforced_at TEXT;

-- Phase 2: Outcome tracking
ALTER TABLE memory_objects ADD COLUMN outcome_score REAL DEFAULT 0.5;

-- Memory outcomes table for tracking helpfulness
CREATE TABLE IF NOT EXISTS memory_outcomes (
    id TEXT PRIMARY KEY,
    memory_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('helpful', 'unhelpful', 'neutral')),
    context TEXT,
    FOREIGN KEY (memory_id) REFERENCES memory_objects(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_memory_objects_strength ON memory_objects(strength);
CREATE INDEX IF NOT EXISTS idx_memory_outcomes_memory_id ON memory_outcomes(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_outcomes_session_id ON memory_outcomes(session_id);
