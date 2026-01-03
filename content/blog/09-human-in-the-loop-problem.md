# The Human-in-the-Loop Problem

> "AI extraction is 90% accurate. That 10% will ruin your memory system."

Here's a dirty secret about LLM-extracted memories: they're confidently wrong about 10% of the time.

Not wrong in obvious ways. Wrong in subtle, plausible-sounding ways that you don't notice until the agent applies the memory and creates a bug. Wrong in ways that accumulate over time, degrading retrieval quality until users stop trusting the system.

This is the human-in-the-loop problem: AI extraction is good enough to be useful, but not good enough to be autonomous.

## The Accuracy Problem

Let's look at real extraction failures:

**False decisions:**
```
Session: User explores Web Workers, then Server-Side Rendering, settles on neither
Extracted: [decision] "Use Web Workers for background processing"
Reality: User was just exploring options, no decision was made
```

**Missing context:**
```
Session: "In this specific edge case with legacy browsers, use polyfills"
Extracted: [convention] "Always use polyfills"
Reality: Convention only applies to a narrow case, now over-applied
```

**Reversed meaning:**
```
Session: "We tried Redis caching but it didn't work for our use case"
Extracted: [decision] "Use Redis for caching"
Reality: User explicitly rejected Redis
```

**Hallucinated rationale:**
```
Session: User chooses SQLite (no explicit reasoning)
Extracted: [decision] "Use SQLite because it's faster than Postgres"
Reality: Speed wasn't the reason; user never compared performance
```

Each of these is plausible. Each would pass a casual review. Each creates problems downstream.

## Why Extraction Fails

LLMs make specific types of extraction errors:

**Over-inference.** The model sees exploration and infers decision. "User considered X" becomes "User chose X."

**Context collapse.** Nuanced statements lose their qualifiers. "In this case, maybe try X" becomes "Always do X."

**False confidence.** The model presents all extractions with equal certainty, whether grounded in explicit statements or inferred from patterns.

**Recency bias.** Recent events in the session are weighted more heavily, even if earlier events are more important.

**Pattern matching.** The model recognizes structural patterns ("tried X, then tried Y, Y worked") and extracts memories even when the pattern doesn't represent a real learning.

These aren't model bugs—they're fundamental limitations of extracting structured knowledge from unstructured conversation.

## The Review Imperative

Given these failure modes, autonomous extraction is dangerous. Every extracted memory needs human review.

But here's the tension: developers hate interruptions. Review fatigue is real. If review is annoying, users will skip it. Skipped review means bad memories accumulate.

The challenge is designing review that's:
- Fast (under 30 seconds per memory)
- Non-blocking (doesn't interrupt flow)
- Effective (catches real errors)
- Sustainable (doesn't cause fatigue)

## Alexandria's Approach

We designed review around these principles:

### 1. Extraction Creates Candidates, Not Memories

```typescript
async function extractMemories(episode: Episode): Promise<void> {
  const candidates = await runExtraction(episode);

  for (const candidate of candidates) {
    await db.insert('memory_objects', {
      ...candidate,
      reviewStatus: 'pending',  // Always pending
      status: 'active',         // But usable immediately
    });
  }
}
```

Pending memories are retrievable (with a warning) but not trusted. They influence agent behavior but users know to verify.

### 2. Async Review Workflow

Review happens when convenient, not when extraction happens:

```bash
$ alex review
3 memories pending review

────────────────────────────────────────────────────────────
[decision] Use Bun instead of Node for native TypeScript support

Source: Session 2024-01-15, 2:34 PM
Evidence: "Let's use Bun since it handles TypeScript natively"

[a]pprove  [r]eject  [e]dit  [s]kip  [q]uit
────────────────────────────────────────────────────────────
>
```

No pop-ups. No interruptions. Review when you have 5 minutes between tasks.

### 3. One-Key Actions

Every action is a single keystroke:

| Key | Action | Time |
|-----|--------|------|
| `a` | Approve as-is | <1s |
| `r` | Reject (delete) | <1s |
| `e` | Edit content | 10-30s |
| `s` | Skip for later | <1s |
| `q` | Quit review | <1s |

Most memories take 2-3 seconds to review. The friction is minimal.

### 4. Context Preservation

Reviews show source context:

```
[known_fix] "When Sharp fails on Alpine, install vips-dev first"

─── Source Context ───
Session: 2024-01-15, debugging session
Trigger: Error followed by successful resolution

Tool output (error):
  npm ERR! sharp: Installation failed

User prompt:
  "let's try installing vips-dev first"

Tool output (success):
  Successfully compiled sharp@0.33.0
──────────────────────

This memory was extracted because an error was followed by
a resolution within 5 minutes.
```

Reviewers can verify the extraction against the source.

### 5. Confidence-Based Prioritization

Not all memories need equal scrutiny:

```typescript
function prioritizeForReview(memories: Memory[]): Memory[] {
  return memories.sort((a, b) => {
    // Tier 0 (deterministic) extractions need less review
    if (a.extractionTier === 0 && b.extractionTier !== 0) return 1;

    // Constraints are high-impact, review first
    if (a.objectType === 'constraint') return -1;

    // Decisions with rationale are more reliable
    if (a.structured?.rationale) return 1;

    // Newer memories first
    return b.createdAt - a.createdAt;
  });
}
```

Deterministic extractions (error→fix patterns) are usually correct. LLM extractions of constraints need careful review.

## Patterns That Work

After iteration, these review patterns proved effective:

### Batch Review Sessions

Review 10-20 memories at once, not one at a time. Batching creates rhythm and reduces context-switching.

```bash
# End-of-day review ritual
alex review --limit 20
```

### Source Verification

Always show the source. Reviewers catch more errors when they can see what actually happened.

```typescript
interface ReviewUI {
  memory: Memory;
  sourceEvents: Event[];        // What triggered extraction
  extractionReason: string;     // Why we thought this was memorable
  confidence: number;           // How certain we are
}
```

### "Trust This Session" Mode

For high-quality sessions (pair programming, careful development), users can bulk-approve:

```bash
alex review --session xyz123 --approve-all
```

Use sparingly. But sometimes you know the session was clean.

### Correction Tracking

When users edit memories, we learn:

```typescript
async function recordCorrection(
  original: Memory,
  edited: Memory
): Promise<void> {
  await db.insert('corrections', {
    originalContent: original.content,
    editedContent: edited.content,
    extractionMethod: original.extractionMethod,
    correctionType: classifyCorrection(original, edited)
  });

  // Use corrections to improve future extraction
  await updateExtractionModel(await getCorrections());
}
```

Pattern: Users frequently change "Use X" to "Consider X when Y"—we're over-stating certainty.

## Patterns That Failed

Some review approaches didn't work:

### Inline Pop-ups

Interrupting the agent session to show a review dialog. Users hated it. Rejection rate: near 100%.

### Email Notifications

"You have 5 memories pending review!" Users ignored them completely.

### Mandatory Review

Requiring review before memories become active. Users would bulk-approve without reading.

### Complex Edit Forms

Multi-field edit dialogs with dropdowns and validation. Users skipped editing entirely.

The lesson: review must be frictionless or it won't happen.

## Metrics We Track

We measure review effectiveness:

```typescript
interface ReviewMetrics {
  reviewRate: number;      // % of memories reviewed within 7 days
  timeToReview: number;    // Median time from creation to review
  approvalRate: number;    // % approved vs rejected
  editRate: number;        // % approved with edits
  rejectReasons: Map<string, number>;  // Why memories are rejected
}
```

Current targets:
- Review rate: >80%
- Time to review: <48 hours
- Approval rate: 70-85% (lower means extraction is too aggressive, higher means we're not capturing enough)
- Edit rate: <20% (higher means extraction quality is low)

## The Trust Curve

New users review everything carefully. Over time, they learn to trust certain extraction patterns:

```
Week 1: Review every memory, 30 seconds each
Week 2: Quick-approve Tier 0, review Tier 1
Week 4: Batch approve, spot-check suspicious ones
Week 8: Trust the system, review only flagged memories
```

This is expected. The system earns trust through consistent accuracy.

The danger is premature trust. We intentionally slow the trust curve:
- New projects start with higher review priority
- Errors are surfaced prominently
- Correction patterns are highlighted

## The Philosophical Position

Some argue AI should be autonomous. "The model is smart enough. Human review is legacy thinking."

We disagree.

For memory systems, the cost of errors is high:
- Wrong memories persist indefinitely
- Retrieval surfaces wrong information
- Agents make wrong decisions
- Trust erodes slowly, then completely

The 10% error rate isn't acceptable for a system that influences every future session.

Human review isn't a bug—it's a feature. It's the quality control that makes the system trustworthy.

## Future Directions

We're exploring ways to reduce review burden while maintaining quality:

**Selective review.** Use confidence scoring to identify which memories need human attention. High-confidence extractions might be auto-approved.

**Peer review.** For teams, other developers can review memories. Fresh eyes catch different errors.

**Outcome-based learning.** When a memory leads to a correction ("no, that's wrong"), automatically flag similar memories for review.

**Explanation generation.** Show why the model extracted each memory, making review faster.

None of these eliminate human review. They make it more efficient.

---

The human-in-the-loop problem doesn't have a clever technical solution. The solution is good UX for review workflows.

Make review fast. Make it non-blocking. Make it effective. Accept that humans are part of the system.

*AI extraction is 90% accurate. Human review handles the other 10%.*
