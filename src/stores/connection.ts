/**
 * Database connection and initialization
 * Uses Bun's built-in SQLite support (bun:sqlite)
 *
 * Database Location Strategy:
 * All databases are stored under ~/.alexandria/projects/<project-hash>/
 * This allows:
 * 1. Unified UI to browse all project memories
 * 2. Easy backup/sync
 * 3. No pollution of project directories
 */

import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

const ALEXANDRIA_HOME = join(homedir(), '.alexandria');
const PROJECTS_DIR = join(ALEXANDRIA_HOME, 'projects');
const GLOBAL_DB_NAME = '_global';

let _connection: Database | null = null;
let _currentDbPath: string | null = null;

/**
 * Generate a short hash for a project path
 */
function hashProjectPath(projectPath: string): string {
  const hash = createHash('sha256').update(projectPath).digest('hex');
  return hash.substring(0, 12);
}

/**
 * Get a safe directory name from project path
 */
function getProjectDirName(projectPath: string): string {
  const name = basename(projectPath).replace(/[^a-zA-Z0-9-_]/g, '_');
  const hash = hashProjectPath(projectPath);
  return `${name}_${hash}`;
}

/**
 * Find project root by looking for .git, package.json, etc.
 */
function findProjectRoot(startDir: string = process.cwd()): string | null {
  let dir = startDir;
  const root = dirname(dir);

  while (dir !== root) {
    if (
      existsSync(join(dir, '.git')) ||
      existsSync(join(dir, 'package.json')) ||
      existsSync(join(dir, 'Cargo.toml')) ||
      existsSync(join(dir, 'pyproject.toml')) ||
      existsSync(join(dir, 'go.mod'))
    ) {
      return dir;
    }
    dir = dirname(dir);
  }

  return null;
}

/**
 * Get database path for a project
 *
 * Structure: ~/.alexandria/projects/<project-name>_<hash>/alexandria.db
 */
export function getDbPathForProject(projectPath: string): string {
  const dirName = getProjectDirName(projectPath);
  return join(PROJECTS_DIR, dirName, 'alexandria.db');
}

/**
 * Get database file path
 *
 * Priority:
 * 1. ALEXANDRIA_DB_PATH environment variable
 * 2. Project-specific database under ~/.alexandria/projects/
 * 3. Global database ~/.alexandria/projects/_global/
 */
export function getDbPath(): string {
  // Environment variable takes priority
  if (process.env.ALEXANDRIA_DB_PATH) {
    return process.env.ALEXANDRIA_DB_PATH;
  }

  // Find project root
  const projectRoot = findProjectRoot();
  if (projectRoot) {
    return getDbPathForProject(projectRoot);
  }

  // Fall back to global
  return join(PROJECTS_DIR, GLOBAL_DB_NAME, 'alexandria.db');
}

/**
 * Get the Alexandria home directory
 */
export function getAlexandriaHome(): string {
  return ALEXANDRIA_HOME;
}

/**
 * Get or create database connection
 */
export function getConnection(dbPath?: string): Database {
  const finalPath = dbPath ?? getDbPath();

  // Reuse existing connection if path matches
  if (_connection && _currentDbPath === finalPath) {
    return _connection;
  }

  // Close existing connection if switching databases
  if (_connection && _currentDbPath !== finalPath) {
    _connection.close();
    _connection = null;
  }

  const dataDir = dirname(finalPath);

  // Ensure data directory exists
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  // Store project metadata
  const metadataPath = join(dataDir, 'project.json');
  if (!existsSync(metadataPath)) {
    const projectRoot = findProjectRoot();
    const metadata = {
      projectPath: projectRoot || 'global',
      projectName: projectRoot ? basename(projectRoot) : 'global',
      createdAt: new Date().toISOString(),
    };
    Bun.write(metadataPath, JSON.stringify(metadata, null, 2));
  }

  const db = new Database(finalPath);

  // Enable WAL mode for better concurrency
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');

  // Run migrations
  runMigrations(db);

  // Cache connection
  _connection = db;
  _currentDbPath = finalPath;

  return db;
}

/**
 * Get an in-memory database for testing
 */
export function getMemoryConnection(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db);
  return db;
}

/**
 * Close the cached connection
 */
export function closeConnection(): void {
  if (_connection) {
    _connection.close();
    _connection = null;
    _currentDbPath = null;
  }
}

/**
 * List all project databases
 */
export function listProjectDatabases(): Array<{
  name: string;
  path: string;
  projectPath: string;
  dbPath: string;
}> {
  const projects: Array<{
    name: string;
    path: string;
    projectPath: string;
    dbPath: string;
  }> = [];

  if (!existsSync(PROJECTS_DIR)) {
    return projects;
  }

  const dirs = readdirSync(PROJECTS_DIR, { withFileTypes: true });

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;

    const metadataPath = join(PROJECTS_DIR, dir.name, 'project.json');
    const dbPath = join(PROJECTS_DIR, dir.name, 'alexandria.db');

    if (existsSync(dbPath)) {
      let projectPath = 'unknown';
      let projectName = dir.name;

      if (existsSync(metadataPath)) {
        try {
          const content = require('node:fs').readFileSync(metadataPath, 'utf-8');
          const metadata = JSON.parse(content);
          projectPath = metadata.projectPath || projectPath;
          projectName = metadata.projectName || projectName;
        } catch {
          // Ignore parse errors
        }
      }

      projects.push({
        name: projectName,
        path: join(PROJECTS_DIR, dir.name),
        projectPath,
        dbPath,
      });
    }
  }

  return projects;
}

/**
 * Check if using the global database
 */
export function isUsingGlobalDatabase(): boolean {
  const dbPath = getDbPath();
  return dbPath.includes(GLOBAL_DB_NAME);
}

/**
 * Get current project info
 */
export function getCurrentProjectInfo(): { name: string; path: string } | null {
  const projectRoot = findProjectRoot();
  if (!projectRoot) return null;

  return {
    name: basename(projectRoot),
    path: projectRoot,
  };
}

/**
 * Run database migrations
 */
function runMigrations(db: Database): void {
  const schema = `
-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    working_directory TEXT,
    working_file TEXT,
    working_task TEXT,
    summary TEXT,
    events_count INTEGER DEFAULT 0,
    objects_created INTEGER DEFAULT 0,
    objects_accessed INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);

-- Blobs table
CREATE TABLE IF NOT EXISTS blobs (
    id TEXT PRIMARY KEY,
    content BLOB NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL
);

-- Events table
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    event_type TEXT NOT NULL,
    content TEXT,
    blob_id TEXT,
    tool_name TEXT,
    file_path TEXT,
    exit_code INTEGER,
    content_hash TEXT,
    token_count INTEGER,
    FOREIGN KEY (session_id) REFERENCES sessions(id),
    FOREIGN KEY (blob_id) REFERENCES blobs(id)
);
CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_content_hash ON events(content_hash);

-- Memory objects table
CREATE TABLE IF NOT EXISTS memory_objects (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    object_type TEXT NOT NULL,
    scope_type TEXT DEFAULT 'project',
    scope_path TEXT,
    status TEXT DEFAULT 'active',
    superseded_by TEXT,
    confidence TEXT DEFAULT 'medium',
    evidence_event_ids TEXT,
    evidence_excerpt TEXT,
    review_status TEXT DEFAULT 'pending',
    reviewed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    access_count INTEGER DEFAULT 0,
    last_accessed TEXT,
    code_refs TEXT DEFAULT '[]',
    last_verified_at TEXT,
    supersedes TEXT,
    structured TEXT,
    strength REAL DEFAULT 1.0,
    last_reinforced_at TEXT,
    outcome_score REAL DEFAULT 0.5,
    FOREIGN KEY (superseded_by) REFERENCES memory_objects(id)
);
CREATE INDEX IF NOT EXISTS idx_memory_objects_status ON memory_objects(status);
CREATE INDEX IF NOT EXISTS idx_memory_objects_object_type ON memory_objects(object_type);
CREATE INDEX IF NOT EXISTS idx_memory_objects_review_status ON memory_objects(review_status);
CREATE INDEX IF NOT EXISTS idx_memory_objects_scope ON memory_objects(scope_type, scope_path);
CREATE INDEX IF NOT EXISTS idx_memory_objects_strength ON memory_objects(strength);

-- Memory code references (normalized)
CREATE TABLE IF NOT EXISTS memory_code_refs (
    id TEXT PRIMARY KEY,
    memory_id TEXT NOT NULL,
    path TEXT NOT NULL,
    ref_type TEXT NOT NULL CHECK (ref_type IN ('file', 'symbol', 'line_range')),
    symbol TEXT,
    line_start INTEGER,
    line_end INTEGER,
    verified_at_commit TEXT,
    content_hash TEXT,
    FOREIGN KEY (memory_id) REFERENCES memory_objects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_memory_code_refs_memory_id ON memory_code_refs(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_code_refs_path ON memory_code_refs(path);

-- Token index
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

-- Fallback embedding tables
CREATE TABLE IF NOT EXISTS event_embeddings_fallback (
    id TEXT PRIMARY KEY,
    embedding BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS object_embeddings_fallback (
    id TEXT PRIMARY KEY,
    embedding BLOB NOT NULL
);

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
CREATE INDEX IF NOT EXISTS idx_memory_outcomes_memory_id ON memory_outcomes(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_outcomes_session_id ON memory_outcomes(session_id);
`;

  db.exec(schema);
  runColumnMigrations(db);
  tryCreateFTSTables(db);
  tryCreateVectorTables(db);
}

/**
 * Run column migrations for existing databases
 */
function runColumnMigrations(db: Database): void {
  // Check if code_refs column exists
  const columns = db.query('PRAGMA table_info(memory_objects)').all() as Array<{ name: string }>;
  const columnNames = columns.map((c) => c.name);

  if (!columnNames.includes('code_refs')) {
    db.exec("ALTER TABLE memory_objects ADD COLUMN code_refs TEXT DEFAULT '[]'");
  }

  if (!columnNames.includes('last_verified_at')) {
    db.exec('ALTER TABLE memory_objects ADD COLUMN last_verified_at TEXT');
  }

  if (!columnNames.includes('structured')) {
    db.exec('ALTER TABLE memory_objects ADD COLUMN structured TEXT');
  }

  if (!columnNames.includes('supersedes')) {
    db.exec('ALTER TABLE memory_objects ADD COLUMN supersedes TEXT');
  }

  // Memory strength and decay (brain-inspired evolution)
  if (!columnNames.includes('strength')) {
    db.exec('ALTER TABLE memory_objects ADD COLUMN strength REAL DEFAULT 1.0');
  }

  if (!columnNames.includes('last_reinforced_at')) {
    db.exec('ALTER TABLE memory_objects ADD COLUMN last_reinforced_at TEXT');
  }

  if (!columnNames.includes('outcome_score')) {
    db.exec('ALTER TABLE memory_objects ADD COLUMN outcome_score REAL DEFAULT 0.5');
  }

  // Session tracking for progressive disclosure
  runSessionMigrations(db);

  // Memory outcomes table for tracking helpfulness
  tryCreateOutcomesTable(db);

  // Normalized code reference table
  tryCreateCodeRefsTable(db);

  // Ensure supporting indexes exist
  ensureIndexes(db);
}

/**
 * Run session-related migrations
 */
function runSessionMigrations(db: Database): void {
  const sessionColumns = db.query('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
  const sessionColumnNames = sessionColumns.map((c) => c.name);

  if (!sessionColumnNames.includes('last_checkpoint_at')) {
    db.exec('ALTER TABLE sessions ADD COLUMN last_checkpoint_at TEXT');
  }

  if (!sessionColumnNames.includes('events_since_checkpoint')) {
    db.exec('ALTER TABLE sessions ADD COLUMN events_since_checkpoint INTEGER DEFAULT 0');
  }

  if (!sessionColumnNames.includes('injected_memory_ids')) {
    db.exec("ALTER TABLE sessions ADD COLUMN injected_memory_ids TEXT DEFAULT '[]'");
  }

  if (!sessionColumnNames.includes('last_disclosure_at')) {
    db.exec('ALTER TABLE sessions ADD COLUMN last_disclosure_at TEXT');
  }

  if (!sessionColumnNames.includes('error_count')) {
    db.exec('ALTER TABLE sessions ADD COLUMN error_count INTEGER DEFAULT 0');
  }

  if (!sessionColumnNames.includes('disclosure_level')) {
    db.exec("ALTER TABLE sessions ADD COLUMN disclosure_level TEXT DEFAULT 'task'");
  }

  if (!sessionColumnNames.includes('last_topic')) {
    db.exec('ALTER TABLE sessions ADD COLUMN last_topic TEXT');
  }
}

/**
 * Create memory outcomes table for tracking helpfulness
 */
function tryCreateOutcomesTable(db: Database): void {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_outcomes (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('helpful', 'unhelpful', 'neutral')),
        context TEXT,
        FOREIGN KEY (memory_id) REFERENCES memory_objects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_memory_outcomes_memory_id ON memory_outcomes(memory_id);
      CREATE INDEX IF NOT EXISTS idx_memory_outcomes_session_id ON memory_outcomes(session_id);
    `);
  } catch {
    // Table may already exist
  }
}

/**
 * Create normalized code references table
 */
function tryCreateCodeRefsTable(db: Database): void {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_code_refs (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        path TEXT NOT NULL,
        ref_type TEXT NOT NULL CHECK (ref_type IN ('file', 'symbol', 'line_range')),
        symbol TEXT,
        line_start INTEGER,
        line_end INTEGER,
        verified_at_commit TEXT,
        content_hash TEXT,
        FOREIGN KEY (memory_id) REFERENCES memory_objects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_memory_code_refs_memory_id ON memory_code_refs(memory_id);
      CREATE INDEX IF NOT EXISTS idx_memory_code_refs_path ON memory_code_refs(path);
    `);
  } catch {
    // Table may already exist
  }
}

/**
 * Ensure core indexes exist for older databases
 */
function ensureIndexes(db: Database): void {
  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_objects_scope ON memory_objects(scope_type, scope_path);
      CREATE INDEX IF NOT EXISTS idx_memory_objects_strength ON memory_objects(strength);
      CREATE INDEX IF NOT EXISTS idx_tokens_type ON object_tokens(token_type);
    `);
  } catch {
    // Indexes may already exist
  }
}

/**
 * Try to create FTS5 tables
 */
function tryCreateFTSTables(db: Database): void {
  try {
    const eventsResult = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='events_fts'")
      .get();
    if (!eventsResult) {
      db.exec(`
        CREATE VIRTUAL TABLE events_fts USING fts5(
          content,
          tool_name,
          file_path,
          content='events',
          content_rowid='rowid',
          tokenize='porter unicode61'
        );
      `);

      db.exec(`
        CREATE TRIGGER IF NOT EXISTS events_ai AFTER INSERT ON events BEGIN
          INSERT INTO events_fts(rowid, content, tool_name, file_path)
          VALUES (NEW.rowid, NEW.content, NEW.tool_name, NEW.file_path);
        END;
      `);
    }

    const objectsResult = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_objects_fts'")
      .get();
    if (!objectsResult) {
      db.exec(`
        CREATE VIRTUAL TABLE memory_objects_fts USING fts5(
          content,
          scope_path,
          content='memory_objects',
          content_rowid='rowid',
          tokenize='porter unicode61'
        );
      `);

      db.exec(`
        CREATE TRIGGER IF NOT EXISTS memory_objects_ai AFTER INSERT ON memory_objects BEGIN
          INSERT INTO memory_objects_fts(rowid, content, scope_path)
          VALUES (NEW.rowid, NEW.content, NEW.scope_path);
        END;
      `);
    }
  } catch (error) {
    console.debug('Failed to create FTS tables:', error);
  }
}

/**
 * Try to create vector tables (requires sqlite-vec extension)
 */
function tryCreateVectorTables(db: Database): boolean {
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS event_embeddings USING vec0(
        event_id TEXT PRIMARY KEY,
        embedding FLOAT[384]
      );
    `);
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS object_embeddings USING vec0(
        object_id TEXT PRIMARY KEY,
        embedding FLOAT[384]
      );
    `);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if vector tables are available
 */
export function hasVectorSupport(db: Database): boolean {
  try {
    db.query('SELECT * FROM event_embeddings LIMIT 0').all();
    return true;
  } catch {
    return false;
  }
}
