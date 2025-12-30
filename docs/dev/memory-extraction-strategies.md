# Memory Extraction Strategies

## Implementation Status

✅ **Implemented**: `IntelligentExtractor` in `src/ingestor/intelligent-extractor.ts`

The intelligent extractor uses a buffer-based approach with pattern detection triggers
and optional LLM-based extraction for high-quality memories.

## Current Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Event Stream                              │
│  user_prompt → assistant_response → tool_call → tool_output │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Context Buffer                              │
│  - Accumulates events (5-20 before analysis)                │
│  - Tracks tool sequences (call → result pairs)              │
│  - Monitors for trigger patterns                            │
└─────────────────────────────────────────────────────────────┘
                              │
            ┌─────────────────┴─────────────────┐
            ▼                                   ▼
   ┌────────────────┐                 ┌────────────────┐
   │ Pattern Detect │                 │  Time/Size    │
   │ - Error→Fix    │                 │  Threshold    │
   │ - Correction   │                 │  - 20 events  │
   │ - Decision     │                 │  - 60 seconds │
   │ - Architecture │                 └────────────────┘
   └────────────────┘
            │                                   │
            └─────────────────┬─────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Analysis (LLM or Heuristic)                     │
│  - LLM: Sends context with structured extraction prompt     │
│  - Heuristic: Pattern-specific logic (fallback)             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Memory Objects                             │
│  - Grounded in multiple events                              │
│  - Includes reasoning/evidence                              │
│  - Auto-approved if high confidence                         │
└─────────────────────────────────────────────────────────────┘
```

## Analysis Triggers

The extractor watches for these patterns to trigger analysis:

| Trigger | Detection | Memory Type |
|---------|-----------|-------------|
| Error Resolution | Failed tool → attempts → success | `known_fix` |
| Explicit Decision | "decided to", "going with", "instead of" | `decision` |
| User Correction | "no, don't", "never", "always use" | `constraint` |
| Architecture Pattern | Multiple pattern/structure terms | `convention` |

## Previous Problems (Solved)

### Strategy 1: Aggregation-Based Extraction (Recommended)

Instead of extracting memories immediately, **buffer observations and aggregate patterns**:

```
┌─────────────────────────────────────────────────────────────┐
│                    Session Events                            │
│  prompt → response → tool_call → tool_output → ...          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Observation Buffer                          │
│  - "User tried X, got error Y"                              │
│  - "User tried X again with flag Z"                         │
│  - "User tried X with flag Z, it worked"                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ (on session end or threshold)
┌─────────────────────────────────────────────────────────────┐
│              Pattern Aggregation (LLM)                       │
│  "When doing X, use flag Z (tried without, got error Y)"    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Memory Object                              │
│  Type: known_fix                                            │
│  Content: "When doing X, use flag Z to avoid error Y"       │
│  Evidence: [event1, event2, event3]                         │
└─────────────────────────────────────────────────────────────┘
```

**Benefits:**
- Memories are grounded in multiple observations
- Context is preserved across the session
- LLM can synthesize actionable insights
- Reduces noise by requiring pattern consistency

### Strategy 2: Intent-Based Extraction

Only extract memories when **explicit intent signals** are detected:

| Signal | Memory Type | Example |
|--------|-------------|---------|
| User correction | constraint | "No, don't use X, use Y instead" |
| Explicit teaching | convention | "In this project we always..." |
| Problem resolution | known_fix | Error → multiple attempts → success |
| Repeated behavior | preference | User consistently chooses X over Y |

**Implementation:**
```typescript
interface IntentSignal {
  type: 'correction' | 'teaching' | 'resolution' | 'repetition';
  confidence: number;
  evidence: Event[];
}

function detectIntent(events: Event[]): IntentSignal[] {
  // Look for patterns across multiple events, not single sentences
}
```

### Strategy 3: Session-End Summarization

**Don't extract in real-time at all.** Instead:

1. Buffer all events during session
2. On session end, use LLM to summarize:
   - What problems were encountered?
   - What solutions worked?
   - What decisions were made and why?
   - What patterns should be remembered?

**Prompt template:**
```
Analyze this coding session and extract actionable memories:

Session events:
{events}

For each memory, provide:
1. Type (decision/constraint/known_fix/convention/preference)
2. Content (actionable statement)
3. Evidence (which events support this)
4. Confidence (how certain based on evidence)

Only extract memories that would be useful in future sessions.
Do NOT extract:
- Casual conversation
- Meta-commentary about the session
- Code fragments without context
- Obvious or trivial observations
```

### Strategy 4: Failure-Success Pair Detection

Focus specifically on **problem-solution pairs**:

```typescript
interface FailureSuccessPair {
  failure: {
    event: Event;
    errorType: string;
    context: string;
  };
  attempts: Event[];
  success: {
    event: Event;
    solution: string;
  };
}

function detectPairs(events: Event[]): FailureSuccessPair[] {
  // 1. Find error events
  // 2. Track subsequent attempts
  // 3. Identify when problem is resolved
  // 4. Extract the delta between failure and success
}
```

### Strategy 5: Explicit Memory Commands

Let the **user/agent explicitly create memories**:

```bash
# User explicitly adds
alex add "Always use --frozen-lockfile in CI" --type constraint

# Agent can suggest
"I noticed this pattern. Should I remember: 'Use bun instead of npm for this project'? [y/n]"
```

This has highest signal-to-noise but lowest automation.

## Recommended Approach: Hybrid

Combine multiple strategies:

1. **Real-time:** Only extract on high-confidence signals (Strategy 2)
   - User corrections ("no, use X instead")
   - Explicit teaching ("in this project we...")
   - Clear error → fix sequences

2. **Session-end:** Aggregate and summarize (Strategy 1 + 3)
   - Use LLM to review session
   - Synthesize observations into memories
   - Merge with existing similar memories

3. **Continuous:** Track patterns over multiple sessions
   - If same decision made 3+ times, elevate to convention
   - If same fix applied repeatedly, mark as known_fix

## Implementation Priority

1. **Quick win:** Tighten patterns and add negative filters
   - Exclude code blocks, error stack traces, meta-commentary
   - Require more specific pattern matches
   - Add minimum semantic quality threshold

2. **Medium term:** Session-end summarization
   - Buffer events, summarize on session end
   - Use LLM for extraction with strict prompt

3. **Long term:** Cross-session aggregation
   - Track observation frequency
   - Merge similar memories
   - Promote repeated patterns

## Pattern Improvements (Quick Wins)

### Current (Too Broad)
```typescript
decision: [
  /(?:chose|decided|going with|using|switched to)/i,  // Matches "using X" anywhere
]
```

### Improved (More Specific)
```typescript
decision: [
  /^(?:I|we|let's)\s+(?:chose|decided|will use|going with)/i,  // Must start with subject
  /(?:instead of|rather than)\s+\w+\s+(?:because|since|as)/i,  // Requires reasoning
  /decision:\s*.+/i,  // Explicit marker
]

// Negative patterns (exclude these)
const EXCLUDE_PATTERNS = [
  /^```/,  // Code blocks
  /^\s*\/\//,  // Comments
  /^\s*#/,  // Comments
  /^\d+\.\s/,  // Numbered lists (likely examples)
  /error:|exception:|at\s+\w+\.\w+:\d+/i,  // Stack traces
  /^(let me|now|first|then|next)/i,  // Meta-commentary
];
```

### Content Quality Filters

```typescript
function isHighQualityContent(content: string): boolean {
  // Must be a complete thought
  if (content.split(' ').length < 5) return false;
  
  // Must not be a code fragment
  if (/^[{}\[\]();]|[{}\[\]();]$/.test(content.trim())) return false;
  
  // Must not be a file path or URL
  if (/^(\/|https?:)/.test(content.trim())) return false;
  
  // Must contain actionable language
  const actionablePatterns = [
    /\b(use|avoid|always|never|should|must|prefer|require)\b/i,
    /\b(because|since|when|if|to avoid|to prevent)\b/i,
  ];
  return actionablePatterns.some(p => p.test(content));
}
```
