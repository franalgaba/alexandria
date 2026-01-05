# Alexandria Blog Content Plan

A collection of blog post ideas, outlines, and technical deep-dives based on the Alexandria project - a local-first memory system for coding agents.

---

## Content Overview

| Post | Topic | Audience | Difficulty |
|------|-------|----------|------------|
| 1 | Why Coding Agents Need Their Own Memory | General/AI | Beginner |
| 2 | Building a Hook System for Claude Code | Developers | Intermediate |
| 3 | Checkpoint-Driven Memory Curation | AI Engineers | Advanced |
| 4 | The LoCoMo Benchmark Deep Dive | Researchers | Advanced |
| 5 | Local-First AI: Privacy-Preserving Agent Memory | General/AI | Beginner |
| 6 | Git-Aware Staleness Detection | Developers | Intermediate |
| 7 | Lessons from Building Dev Tools for AI Agents | Developers | Intermediate |
| 8 | SQLite as the Universal AI Database | Developers | Intermediate |
| 9 | The Human-in-the-Loop Problem | AI/Product | Beginner |
| 10 | Benchmarking Memory Systems: What We Learned | Researchers | Advanced |

---

## Post 1: Why Coding Agents Need Their Own Memory

### Hook
> "We gave our AI coding assistant the memory of a goldfish. Here's why that was a mistake."

### Thesis
Generic conversational memory systems (Mem0, Zep) are optimized for personal assistants remembering birthdays and preferences. Coding agents need something fundamentally different - memory grounded in code, decisions with rationale, and knowledge that can be verified against the source of truth.

### Outline

1. **The Problem: Groundhog Day Development**
   - Every session starts from zero
   - Agent makes the same mistakes repeatedly
   - Decisions are forgotten, rationale lost
   - Real example: Sharp on Alpine story

2. **Why Generic Memory Fails**
   - Optimized for "user likes coffee" not "use Postgres for ACID"
   - No concept of code references
   - Can't verify against source of truth
   - Treats all facts equally (no constraints)

3. **What Coding Memory Needs**
   - Decision tracking with rationale
   - Failed attempt recording
   - Hard constraints that cannot be violated
   - Code-anchored references
   - Git-aware staleness

4. **The Alexandria Approach**
   - Memory types designed for coding
   - Checkpoint-driven extraction
   - Human-in-the-loop review
   - Local-first, privacy-preserving

### Key Quotes
> "Knowing what didn't work is as valuable as knowing what did."

> "A memory system that can't tell you if its knowledge is still accurate is just a hallucination waiting to happen."

### Call to Action
Link to repo, invite contributions

---

## Post 2: Building a Hook System for Claude Code

### Hook
> "How we built an event-driven architecture for AI coding assistants using shell scripts and JSON"

### Thesis
Creating an integration layer between coding agents and external systems requires careful event design. Here's how we built Alexandria's hook system for Claude Code, the design decisions we made, and what we learned.

### Outline

1. **The Challenge**
   - Claude Code is the host, we're the guest
   - Need to capture events without blocking
   - Fire-and-forget for performance
   - Must handle all event types

2. **Event Model Design**
   ```
   session_start → user_prompt → assistant_response
   → tool_call → tool_result → ... → session_end
   ```

3. **The Hook Architecture**
   ```
   hooks.json (configuration)
   ├── session-start.sh
   ├── user-prompt.sh
   ├── tool-call.sh
   ├── tool-result.sh
   └── session-end.sh
   ```

4. **Implementation Details**
   - Using environment variables for context
   - JSON parsing in shell (jq)
   - Async execution patterns
   - Error handling without blocking

5. **The Skill System**
   - User-invokable commands
   - SKILL.md format
   - Integration with agent workflow

6. **Lessons Learned**
   - Keep hooks fast (< 100ms)
   - Fail silently, log verbosely
   - Buffer events, process in batches
   - Test with edge cases

### Code Snippets
```bash
#!/bin/bash
# tool-result.sh - Capture tool results for memory extraction

# Fire-and-forget to alexandria
alex events append \
  --type tool_result \
  --tool "$TOOL_NAME" \
  --exit-code "$EXIT_CODE" \
  --content "$TOOL_OUTPUT" &

exit 0  # Never block the agent
```

### Technical Diagram
Event flow diagram showing hooks → buffer → checkpoint → extraction

---

## Post 3: Checkpoint-Driven Memory Curation

### Hook
> "Most AI memory systems are fire hoses. We built a curator."

### Thesis
Streaming every agent interaction into memory creates noise. Checkpoint-driven curation captures memories at decision points, when context is richest and signal is strongest.

### Outline

1. **The Noise Problem**
   - Agents generate thousands of events per session
   - Most are exploratory, not memorable
   - Streaming creates low-signal memory stores
   - Retrieval drowns in irrelevant results

2. **What Are Checkpoints?**
   - Natural decision points in agent workflow
   - Triggers: N events, manual, session end, significant events
   - Buffer → Process → Extract → Clear

3. **Tiered Extraction**
   ```
   Tier 0: Deterministic patterns
   - Error followed by fix
   - User corrections ("no, don't do that")
   - Repeated patterns (conventions)

   Tier 1: LLM extraction (Haiku)
   - Decisions with rationale
   - Preferences and conventions
   - Known fixes

   Tier 2: Complex reasoning (Sonnet)
   - Architecture decisions
   - Cross-session patterns
   ```

4. **Why Checkpoints Work**
   - Context is complete at checkpoint
   - Can see problem → attempt → solution arc
   - Reduces extraction costs (batch vs stream)
   - Higher quality memories

5. **Implementation Patterns**
   - Ring buffer for events
   - Trigger detection
   - Parallel extraction tiers
   - Confidence scoring

### Key Insight
> "The best time to capture a decision is right after it's made, when the context that led to it is still fresh."

---

## Post 4: The LoCoMo Benchmark Deep Dive

### Hook
> "We ran Alexandria against the same benchmark Mem0 uses. Here's exactly what happened."

### Thesis
Benchmarking memory systems is hard. LoCoMo tests conversational memory, not coding memory. Understanding the gap between benchmark performance and real-world utility is crucial.

### Outline

1. **What is LoCoMo?**
   - Long-term Conversational Memory benchmark
   - 10 conversations, 272 sessions, 5882 messages
   - 200 questions across 5 categories
   - Created by Snap Research

2. **The Evaluation Setup**
   - Haystack Hit Rate: Did we find the right session?
   - J-Score: LLM-as-judge answer correctness
   - Our provider implementation
   - Fair comparison methodology

3. **The Results**
   | System | J-Score |
   |--------|---------|
   | Mem0 | 66.9% |
   | Alexandria | 39.0% |
   | Gap | 27.9pp |

4. **Why We Score Lower**
   - No memory abstraction (raw messages vs extracted facts)
   - No entity graph (flat search vs graph traversal)
   - Weak temporal reasoning
   - Different optimization target

5. **Features We Tried**
   - Dynamic RRF weights: +1%
   - HyDE: +2% but 40x latency
   - LLM Reranking: +5% but 300x latency
   - Session grouping: +8.5% with no latency cost

6. **The Key Insight**
   > "LoCoMo measures conversational memory. We're building coding memory. Different problem, different benchmark needed."

7. **What a Coding Memory Benchmark Would Test**
   - Decision recall across sessions
   - Mistake avoidance
   - Staleness detection accuracy
   - Constraint enforcement

### Data Visualizations
- Results table
- Per-category breakdown
- Feature ablation chart

---

## Post 5: Local-First AI: Privacy-Preserving Agent Memory

### Hook
> "Your AI coding assistant remembers everything. Where does that memory live?"

### Thesis
Cloud-based memory systems require trusting third parties with your code context, decisions, and potentially proprietary information. Local-first architecture keeps memories on your machine.

### Outline

1. **The Privacy Problem**
   - AI assistants see your code
   - They learn your patterns and decisions
   - That context is valuable - and sensitive
   - Who has access to your agent's memories?

2. **Cloud vs Local Memory**
   | Aspect | Cloud | Local |
   |--------|-------|-------|
   | Privacy | Third-party access | Your machine only |
   | Latency | Network round-trip | Disk access |
   | Availability | Requires internet | Always available |
   | Cost | Per-query pricing | Free after setup |
   | Portability | Vendor lock-in | Your data, your format |

3. **The Alexandria Architecture**
   ```
   ~/.alexandria/
   └── projects/
       └── <project-hash>/
           ├── memories.db    # SQLite
           ├── events.db
           └── vectors.idx
   ```

4. **SQLite: The Perfect Fit**
   - Single file, zero configuration
   - Full SQL query capability
   - FTS5 for text search
   - WAL mode for performance
   - Works offline

5. **Trade-offs We Accept**
   - No cross-device sync (yet)
   - No cloud backup (yet)
   - Single-machine scaling limits
   - User manages storage

6. **The Privacy Payoff**
   - Code never leaves your machine
   - Decisions stay private
   - No vendor lock-in
   - Full data portability

### Pull Quote
> "The most secure memory is the one that never leaves your machine."

---

## Post 6: Git-Aware Staleness Detection

### Hook
> "Your code changed. Does your AI still know what it's talking about?"

### Thesis
Code memories become outdated as codebases evolve. Git-aware staleness detection automatically identifies when memories reference code that has changed, preventing agents from acting on stale information.

### Outline

1. **The Staleness Problem**
   - Memory: "Rate limiting is in src/middleware/rateLimit.ts:42"
   - Reality: File was refactored, line 42 is now something else
   - Agent confidently uses outdated information
   - Subtle bugs ensue

2. **What Can Change?**
   - File deleted
   - File moved/renamed
   - Line content changed
   - Symbol renamed
   - Logic refactored

3. **Code References as Anchors**
   ```typescript
   interface CodeReference {
     file: string;
     line: number;
     symbol?: string;       // Function/class name
     contentHash: string;   // Hash of referenced content
   }
   ```

4. **The Detection Algorithm**
   ```
   For each memory with code refs:
     1. Check file exists
     2. Compare content hash
     3. If changed, look for symbol
     4. If symbol moved, update reference
     5. If symbol gone, mark stale
   ```

5. **Automatic vs Manual Review**
   - Auto-mark as stale
   - Human reviews and either:
     - Updates the memory
     - Supersedes with new memory
     - Archives as no longer relevant

6. **Integration with Git**
   - Track commit hash at memory creation
   - Detect branch divergence
   - Handle rebases and merges
   - Watch for file changes

### Code Example
```typescript
async function checkStaleness(memory: Memory): Promise<boolean> {
  for (const ref of memory.codeRefs) {
    const currentHash = await hashFile(ref.file);
    if (currentHash !== ref.contentHash) {
      if (ref.symbol) {
        // Try to find symbol at new location
        const newLocation = await findSymbol(ref.file, ref.symbol);
        if (!newLocation) return true; // Symbol removed
      } else {
        return true; // Content changed, no symbol to track
      }
    }
  }
  return false;
}
```

---

## Post 7: Lessons from Building Dev Tools for AI Agents

### Hook
> "We spent months building memory for coding agents. Here's what we wish we knew on day one."

### Thesis
Building tools that integrate with AI agents is a new discipline with its own patterns and pitfalls. These are the lessons we learned building Alexandria.

### Outline

1. **Lesson 1: Agents Are Impatient**
   - Every millisecond of latency compounds
   - Fire-and-forget is your friend
   - Never block the agent's main loop
   - Background processing is essential

2. **Lesson 2: Context Windows Are Currency**
   - Tokens are expensive
   - Every memory competes for attention
   - Quality > quantity
   - Summarization is an art

3. **Lesson 3: Agents Make Mistakes**
   - Extracted memories can be wrong
   - Confidence scores aren't confidence
   - Human review is essential
   - Correction mechanisms matter

4. **Lesson 4: Benchmarks Lie**
   - Academic benchmarks test academic problems
   - Real-world usage is different
   - Build your own evaluation
   - Dogfood relentlessly

5. **Lesson 5: Simplicity Wins**
   - SQLite beats Postgres for local
   - Shell scripts beat microservices
   - Files beat databases for config
   - KISS principle applies 10x

6. **Lesson 6: The Agent Knows Things**
   - Leverage what the agent already sees
   - Don't duplicate tool calls
   - Work with the agent, not around it
   - Context is already rich

7. **Lesson 7: Users Don't Trust Magic**
   - Show your work
   - Explain memory sources
   - Allow editing and deletion
   - Transparency builds trust

### Format
List-style with anecdotes and examples for each lesson

---

## Post 8: SQLite as the Universal AI Database

### Hook
> "The most underrated database for AI applications runs on a single file."

### Thesis
SQLite's simplicity, portability, and performance make it ideal for AI applications that need local storage, full-text search, and zero configuration.

### Outline

1. **Why AI Apps Need Different Storage**
   - Local-first requirements
   - Embedded in applications
   - Zero ops overhead
   - Works offline

2. **SQLite's Superpowers**
   - Single file, full SQL
   - FTS5 for text search
   - JSON support built-in
   - WAL mode for concurrent reads
   - 281 TB max size (plenty)

3. **FTS5: Full-Text Search Done Right**
   ```sql
   CREATE VIRTUAL TABLE memory_fts USING fts5(
     content,
     tokenize='porter unicode61'
   );

   SELECT * FROM memory_fts
   WHERE memory_fts MATCH 'authentication AND jwt';
   ```

4. **Performance Tuning for AI Workloads**
   ```sql
   PRAGMA journal_mode = WAL;
   PRAGMA synchronous = NORMAL;
   PRAGMA cache_size = -64000;  -- 64MB
   PRAGMA mmap_size = 268435456;  -- 256MB
   ```

5. **Vector Search Options**
   - sqlite-vec extension
   - Separate index file (HNSW)
   - Hybrid with external service

6. **The Portability Win**
   - Copy file = backup
   - Sync file = replication
   - Email file = share database
   - No server, no config, no ops

7. **Real Numbers from Alexandria**
   - 10k memories: 5ms query time
   - 100k events: 50MB file
   - FTS5 index: 2x content size
   - Zero cold start

### Code Examples
Schema, query examples, performance benchmarks

---

## Post 9: The Human-in-the-Loop Problem

### Hook
> "AI extraction is 90% accurate. That 10% will ruin your memory system."

### Thesis
LLM-extracted memories are confident but sometimes wrong. Building effective human review workflows is essential for memory quality but challenging for UX.

### Outline

1. **The Accuracy Problem**
   - LLMs hallucinate patterns
   - Context can be misunderstood
   - Confidence ≠ correctness
   - Garbage in, garbage forever

2. **Why Review Matters**
   - Catch extraction errors
   - Add human context
   - Build trust in the system
   - Improve over time

3. **The UX Challenge**
   - Developers hate interruptions
   - Review fatigue is real
   - Batch vs inline review
   - Mobile vs desktop

4. **Alexandria's Approach**
   ```
   Extraction → Pending Queue → Async Review → Active
   ```

   - Non-blocking extraction
   - TUI for batch review
   - Confidence-based prioritization
   - Quick approve/reject/edit

5. **Design Patterns That Work**
   - Show source context
   - One-key approve/reject
   - Bulk operations
   - "Trust this session" mode

6. **Design Patterns That Failed**
   - Inline pop-ups (interrupt flow)
   - Email notifications (ignored)
   - Mandatory review (abandoned)
   - Complex edit forms (skipped)

7. **Metrics We Track**
   - Review rate (% reviewed)
   - Time to review
   - Approval rate
   - Edit frequency

### Screenshots
TUI review interface, approval flow

---

## Post 10: Benchmarking Memory Systems: What We Learned

### Hook
> "We implemented 8 retrieval techniques. Only one was worth keeping."

### Thesis
Systematic benchmarking of memory retrieval techniques reveals surprising results. Expensive features often underperform simple baselines. Here's our data.

### Outline

1. **The Setup**
   - LoCoMo benchmark
   - 200 questions, 272 sessions
   - LLM-as-judge scoring
   - Latency measurement

2. **The Techniques We Tested**
   | Technique | Description |
   |-----------|-------------|
   | FTS5 | Full-text search |
   | Entity Matching | Named entity extraction |
   | Vector Search | Embedding similarity |
   | HyDE | Hypothetical document |
   | LLM Reranking | Claude scores results |
   | Dynamic RRF | Query-type weights |
   | Context Expansion | Adjacent messages |
   | Session Grouping | Conversation chunks |

3. **The Results**
   | Configuration | J-Score | Latency |
   |---------------|---------|---------|
   | Baseline | 27.5% | 7ms |
   | + Vectors | 29.0% | 200ms |
   | + HyDE | 30.0% | 400ms |
   | + Reranking | 32.0% | 1800ms |
   | + Session Group | 36.0% | 5ms |

4. **The Surprises**
   - Session grouping beats everything (free!)
   - Vector search barely helps
   - HyDE not worth the latency
   - Reranking too slow for interactive use

5. **Why Session Grouping Wins**
   - LLM judge needs conversation context
   - Scattered messages lose meaning
   - Ordering matters for comprehension
   - Zero additional latency

6. **Recommendations**
   - Start with FTS5 + session grouping
   - Add vectors only if FTS fails
   - Skip reranking for interactive use
   - Measure, don't assume

### Charts
- Feature ablation chart
- Latency vs accuracy scatter plot
- Per-category breakdown

---

## Bonus Content Ideas

### Twitter/X Threads

1. **"The 7 types of memory coding agents need"**
   - Thread walking through each memory type with examples

2. **"We benchmarked 8 retrieval techniques..."**
   - Results thread with key findings

3. **"Why your AI coding assistant forgets everything"**
   - Problem statement thread leading to Alexandria

### Short-Form Content

1. **"One Weird Trick for Better AI Memory"**
   - Session grouping explained in 2 minutes

2. **"SQLite for AI: The Setup"**
   - Quick config guide

3. **"The Staleness Problem in 60 Seconds"**
   - Visual explainer

### Technical Tutorials

1. **"Build Your Own Claude Code Hook"**
   - Step-by-step integration guide

2. **"FTS5 for AI Applications"**
   - SQLite full-text search tutorial

3. **"Checkpoint-Based Event Processing"**
   - Architecture pattern deep dive

### Podcast/Interview Topics

1. **"Local-First AI Infrastructure"**
   - Privacy, performance, portability

2. **"What We Learned Building Alexandria"**
   - Founder story, lessons learned

3. **"The Future of Coding Agent Memory"**
   - Where the field is heading

---

## Content Calendar Suggestion

| Week | Post | Promotion |
|------|------|-----------|
| 1 | Why Coding Agents Need Their Own Memory | Twitter thread |
| 2 | Building a Hook System for Claude Code | HN submission |
| 3 | Checkpoint-Driven Memory Curation | Dev.to cross-post |
| 4 | The LoCoMo Benchmark Deep Dive | Twitter thread |
| 5 | Local-First AI | Privacy angle for general audience |
| 6 | Git-Aware Staleness Detection | Technical deep dive |
| 7 | Lessons from Building Dev Tools | Founder content |
| 8 | SQLite as the Universal AI Database | Tutorial format |
| 9 | The Human-in-the-Loop Problem | UX/Product angle |
| 10 | Benchmarking Memory Systems | Data-driven content |

---

## Writing Guidelines

### Voice
- Technical but accessible
- Show don't tell (code examples)
- Honest about trade-offs
- Opinionated but reasoned

### Structure
- Hook in first paragraph
- Clear thesis statement
- Numbered/bulleted lists
- Code snippets with context
- Data when available
- Clear call to action

### SEO Keywords
- AI memory systems
- Coding agents
- Claude Code
- Local-first AI
- LLM memory
- AI development tools
- Conversational AI memory

---

*Last updated: January 2025*
