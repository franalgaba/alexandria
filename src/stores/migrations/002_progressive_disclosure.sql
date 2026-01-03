-- Migration 002: Progressive Disclosure Tracking
-- Adds fields for tracking injected memories and escalation state

-- Track which memory IDs have been injected this session (to avoid duplicates)
ALTER TABLE sessions ADD COLUMN injected_memory_ids TEXT DEFAULT '[]';

-- When was the last disclosure/injection
ALTER TABLE sessions ADD COLUMN last_disclosure_at TEXT;

-- Error count since last disclosure (for error burst detection)
ALTER TABLE sessions ADD COLUMN error_count INTEGER DEFAULT 0;

-- Current disclosure level (minimal, task, deep)
ALTER TABLE sessions ADD COLUMN disclosure_level TEXT DEFAULT 'task';

-- Last detected topic/file (for topic shift detection)
ALTER TABLE sessions ADD COLUMN last_topic TEXT;
