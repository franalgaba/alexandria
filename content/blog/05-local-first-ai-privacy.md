# Local-First AI: Privacy-Preserving Agent Memory

> "Your AI coding assistant remembers everything. Where does that memory live?"

Every interaction with your AI coding assistant reveals something about your work. The codebase structure. The bugs you encounter. The decisions you make. The mistakes you try to hide.

Over weeks of development, this context accumulates into a detailed portrait of your project—and potentially, your organization's proprietary code and practices.

The question nobody asks enough: *where does this memory live?*

## The Privacy Problem

Consider what a coding agent learns about you:

**Code structure and patterns**
- File organization and naming conventions
- API endpoints and database schemas
- Authentication flows and security mechanisms

**Business logic**
- How your product works
- Edge cases and special handling
- Integration points and dependencies

**Development practices**
- Decisions and their rationale
- What approaches failed
- Constraints and requirements

**Potentially sensitive information**
- Error messages that might contain user data
- Configuration patterns (even if not actual secrets)
- Internal tool names and infrastructure details

Cloud-based memory systems store all of this on someone else's servers. The memory provider sees your agent's entire learning history.

## Cloud vs Local Architecture

Let's compare the two approaches:

### Cloud Memory

```
Your Machine → API Call → Memory Service → Cloud Database
                  ↑                              ↓
              (encrypted)                   (decrypted for processing)
```

With cloud memory:
- Every memory is transmitted over the network
- The provider's servers store and index your data
- Search and retrieval happen on their infrastructure
- You trust their encryption and access controls
- Your data may be used for service improvement

### Local Memory

```
Your Machine → Local Database
     ↓
  (stays here)
```

With local memory:
- Data never leaves your machine
- No network transmission
- No third-party access
- No trust required
- Your data is yours

The difference is fundamental. Cloud memory requires trusting the provider's security, policies, and intentions. Local memory requires trusting only your own machine.

## Trade-offs

Neither approach is objectively better. They optimize for different things:

| Aspect | Cloud | Local |
|--------|-------|-------|
| **Privacy** | Third-party access | Your machine only |
| **Latency** | Network round-trip | Disk access |
| **Availability** | Requires internet | Always available |
| **Cost** | Per-query pricing | Free after setup |
| **Sync** | Built-in multi-device | Manual sync required |
| **Backup** | Provider handles it | You handle it |
| **Portability** | Vendor lock-in | Your data, your format |
| **Scalability** | Infinite | Machine limits |

For individual developers and small teams working with sensitive code, local usually wins. For enterprises with centralized infrastructure and security teams, cloud might make sense.

We built Alexandria for the first case.

## The Alexandria Architecture

Alexandria stores all data locally in your project directory:

```
~/.alexandria/
└── projects/
    └── <project-hash>/
        ├── alexandria.db      # SQLite database
        ├── events.db          # Event log (can be large)
        └── vectors/           # Optional vector index
```

The `<project-hash>` is derived from your project's root path. Different projects get different databases. Your web app's memories don't mix with your API's memories.

### Why SQLite?

SQLite is the perfect fit for local-first AI:

**Single file.** The entire database is one file. Copy it to back up. Delete it to reset. Email it to share (if you want to).

**Zero configuration.** No server to run. No connection strings. No authentication. Open the file and query.

**Full SQL.** Not a key-value store. Real queries, joins, indexes, transactions.

**WAL mode.** Write-Ahead Logging enables concurrent reads while writing. Perfect for agents that read context while capturing events.

**FTS5.** Built-in full-text search with BM25 ranking. No external search service needed.

**Battle-tested.** SQLite runs on billions of devices. It's probably the most tested software in existence.

```sql
-- The core memories table
CREATE TABLE memory_objects (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    object_type TEXT NOT NULL,
    status TEXT DEFAULT 'active',

    -- Confidence and review
    confidence_tier TEXT,
    review_status TEXT DEFAULT 'pending',

    -- Brain-inspired decay
    strength REAL DEFAULT 1.0,
    last_reinforced_at DATETIME,
    access_count INTEGER DEFAULT 0,

    -- Code awareness
    code_refs TEXT,  -- JSON array
    last_verified_at DATETIME,

    -- Timestamps
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Full-text search
CREATE VIRTUAL TABLE memory_objects_fts USING fts5(
    content,
    scope_path,
    content='memory_objects',
    tokenize='porter unicode61'
);
```

### Performance

Local storage isn't just private—it's fast:

| Operation | Time | Notes |
|-----------|------|-------|
| Insert event | 0.5ms | Append-only, WAL mode |
| Search 10k memories | 5ms | FTS5 with BM25 |
| Context pack generation | 15ms | Token-budgeted retrieval |
| Checkpoint execution | 100-500ms | Includes Tier 0 extraction |

Compare to cloud roundtrips:
- Network latency: 50-200ms per call
- Cold start: 500-2000ms for serverless
- Rate limiting: Potential throttling

For interactive use, local storage is typically 10-100x faster.

### Storage Efficiency

How much space does Alexandria use?

| Content | Size | Notes |
|---------|------|-------|
| 1,000 events | ~5 MB | Compressed, blob storage for large outputs |
| 100 memories | ~0.5 MB | Including FTS index |
| Vector index | ~2 MB | Optional, for semantic search |
| Typical project (1 month) | ~20 MB | Active development |

For comparison, a single high-resolution image is 5-10 MB. Alexandria's storage is negligible on modern machines.

## What You Give Up

Local-first has costs:

### No Cross-Device Sync

Your laptop's memories don't automatically appear on your desktop. Solutions:

- **Git:** Check in `.alexandria/` (careful with size)
- **Syncthing:** P2P sync of the database directory
- **Cloud storage:** Dropbox/iCloud for the directory
- **Manual:** Copy the database file

We're exploring built-in sync in future versions.

### No Cloud Backup

If your disk fails, your memories are gone. Solutions:

- **Time Machine / Windows Backup:** Include `.alexandria/`
- **Regular exports:** `alex export > backup.json`
- **Sync services:** See above

Your responsibility, not ours.

### Single-Machine Scaling

SQLite scales to terabytes but has limits:

- Single-writer (no concurrent writes from multiple processes)
- Machine memory bounds
- No distributed queries

For most individual and small team use, these limits are theoretical. If you're hitting them, you have different problems than memory storage.

## The Privacy Payoff

What do you get for these trade-offs?

### Code Never Leaves Your Machine

The memories about your codebase—file paths, function names, API structures—stay local. No cloud service sees your code organization.

### Decisions Stay Private

Your architectural choices, rejected approaches, and problem-solving patterns are yours alone. No provider analyzes your development style.

### No Vendor Lock-in

Your data is in SQLite, a public domain format. Export to JSON anytime. Switch tools without migration pain.

### Full Data Portability

```bash
# Take your memories to a new machine
cp -r ~/.alexandria /path/to/new/machine/

# Or export to JSON
alex export --all > my-memories.json
```

Your data. Your format. Your choice.

### Works Offline

No internet? No problem. Alexandria works entirely locally. Flights, remote locations, network outages—your memories are always available.

### Free After Setup

No per-query costs. No usage tiers. No surprise bills. Run as many queries as you want.

## Security Considerations

Local doesn't mean secure by default:

**File permissions.** The database files should be readable only by your user:
```bash
chmod 700 ~/.alexandria
chmod 600 ~/.alexandria/projects/*/alexandria.db
```

**Disk encryption.** Use FileVault (Mac), BitLocker (Windows), or LUKS (Linux) to encrypt your disk. Unencrypted databases are readable by anyone with physical access.

**Backup security.** If you back up to cloud storage, ensure it's encrypted. Alexandria exports are plaintext JSON.

**Sharing caution.** Don't share database files casually. They contain your project's full memory context.

Alexandria doesn't implement encryption itself—we rely on the operating system's security features.

## The Hybrid Approach

Some teams want local privacy with cloud convenience. A hybrid is possible:

1. **Local storage** for sensitive code context
2. **Cloud sync** for shareable knowledge (team conventions, approved decisions)
3. **Selective export** for memories marked as shareable

We're considering this architecture for future versions. The challenge is distinguishing sensitive from shareable automatically.

## Getting Started

Alexandria is local-first by default. No configuration needed:

```bash
# Install
curl -fsSL https://get.alexandria.dev | bash

# Start using - database created automatically
alex session start

# Check where data lives
alex where
~/.alexandria/projects/abc123/alexandria.db
```

Your first memory is created locally. Every subsequent memory stays local. That's it.

## The Philosophy

We believe in a principle: **your AI's memories about your code should be as private as your code itself.**

Most developers wouldn't upload their entire codebase to a random third-party service. But they'll happily let memory services accumulate comprehensive knowledge about that codebase.

Alexandria takes the opposite stance. Your memories are as sensitive as your source code. They should be stored with the same care.

This isn't paranoia—it's engineering for the obvious case. AI assistants will become more central to development. The context they accumulate will become more valuable. The question of where that context lives will become more consequential.

We'd rather solve it now, with local-first architecture, than retrofit privacy later.

---

The most secure memory is the one that never leaves your machine.

*Alexandria is open source and local-first by default. Your memories stay on your hardware, in a format you control, accessible only to you.*
