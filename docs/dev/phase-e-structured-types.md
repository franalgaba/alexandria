# Phase E: Structured Types

## Overview

Phase E adds structured data to memory types for richer semantics:
- **E1. Decision Type** - alternatives, rationale, tradeoffs
- **E2. Contract Type** - API specs, interfaces, schemas
- **E3. Plan Type** - goals with step tracking

## E1. Decision Type Enhancement

### Structure

```typescript
interface DecisionStructured {
  decision: string;           // The actual decision
  alternatives?: string[];    // What was considered
  rationale?: string;         // Why this choice
  tradeoffs?: string[];       // Known tradeoffs
  decidedBy?: 'team' | 'user' | 'inferred';
}
```

### Storage

Structured data stored in `structured` JSON column, content remains human-readable summary.

### CLI

```bash
# Add decision with structure
alex add-decision "Use SQLite" \
  --alternatives "PostgreSQL,MongoDB" \
  --rationale "Simpler deployment" \
  --tradeoffs "Limited concurrent writes"

# Display shows structured data
alex show <id>
# Decision: Use SQLite
# Alternatives: PostgreSQL, MongoDB
# Rationale: Simpler deployment
# Tradeoffs: Limited concurrent writes
```

## E2. Contract Type

### Structure

```typescript
interface ContractStructured {
  name: string;                    // "User API"
  contractType: 'api' | 'schema' | 'interface' | 'protocol';
  definition?: string;             // OpenAPI spec, TypeScript interface
  version?: string;
}
```

### CLI

```bash
alex add-contract "User API" \
  --type api \
  --definition "GET /users/{id} -> User"
```

## E3. Plan Type (Removed)

Plan type was removed - it doesn't fit Alexandria's core purpose as a memory system. 
Task/progress tracking is better handled by dedicated tools (GitHub Issues, Linear, etc.).

Could be revisited for multi-agent coordination in the future.

## Implementation Order

### Step 1: Schema Update (15 min) ✅ COMPLETE
- [x] Add `structured` column to memory_objects
- [x] Migration for existing databases

### Step 2: Type Definitions (20 min) ✅ COMPLETE
- [x] Create `src/types/structured.ts`
- [x] Define interfaces for each structured type
- [x] Type guards for each type
- [x] Formatters for display

### Step 3: Store Updates (30 min) ✅ COMPLETE
- [x] Update MemoryObjectStore to handle structured data
- [x] Parse/serialize structured JSON
- [x] Add `structured` field to MemoryObject type

### Step 4: Decision Command (30 min) ✅ COMPLETE
- [x] Create `alex add-decision` command
- [x] Update `alex show` to display structured data

### Step 5: Contract Command (20 min) ✅ COMPLETE
- [x] Create `alex add-contract` command

### Step 6: Plan Command - REMOVED
- Plan type removed (doesn't fit core purpose)

### Step 7: Format Updates (20 min) ✅ COMPLETE
- [x] Update `alex show` to display structured data
- [x] Formatted output for decisions, contracts, plans

### Step 8: Tests (30 min) ✅ COMPLETE
- [x] Structured type tests (11 tests)
- [x] Type guards, serialization, formatting
