-- Migration 001: Add checkpoint tracking columns to sessions
ALTER TABLE sessions ADD COLUMN last_checkpoint_at TEXT;
ALTER TABLE sessions ADD COLUMN events_since_checkpoint INTEGER DEFAULT 0;
