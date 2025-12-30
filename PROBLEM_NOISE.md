# Analysis: The Noise Problem in Alexandria's Memory System

## Executive Summary

Alexandria's current memory generation strategy is fundamentally flawed because it relies on **real-time, per-event pattern matching** rather than intelligent, session-level synthesis. 

This results in a database polluted with conversational filler ("Let me check..."), redundant error logs, and immediate intentions ("I will try...") that are often reversed moments later. The absence of an active LLM layer to digest and curate these events leads to a **signal-to-noise ratio estimated at <20%**.

## Methodology Analysis

### 1. The Ingestion Pipeline
The system currently uses a `RealtimeExtractor` (`src/ingestor/realtime-extractor.ts`) which runs on every single event (user message, tool output, error log). 

### 2. The Extraction Mechanism (Regex vs. Intelligence)
Instead of using an LLM to understand context, the system relies on `RegExp` patterns:
*   **Decision Pattern**: matches `/(?:I|we)\s+(?:chose|decided\s+to|will\s+use)/i`
*   **Failure Pattern**: matches `/(?:got|getting|received)\s+(?:an?\s+)?error\s+when/i`

### 3. The Structural Flaw
The `IntelligentExtractor` (LLM-based) exists but appears to be secondary or inactive by default. The primary stream is the "dumb" regex extractor. 

**Why this fails:**
1.  **Lack of Object Permanence**: The extractor sees "I decided to use strategy A" and stores it. Two minutes later, when the user says "Actually, strategy A failed, let's use B", the system stores *another* decision. It does not update or invalidate the first one.
2.  **Literal Interpretation**: A user saying "I am *getting an error* when I do X" triggers the failure pattern. A raw log output containing `console.error` also triggers it. This leads to massive duplication.
3.  **Context Blindness**: It captures "But let me simplify by using `push`" as a permanent architectural decision, rather than a transient thought process.

## Data Analysis (Evidence of Noise)

A review of the active memory store reveals significant pollution:

### 1. The "Stream of Consciousness" Noise
Memories that are merely conversational narration, not facts.
*   *Stored*: "Now let me check the `loadMemories` function..." (Type: `decision`)
*   *Stored*: "But let me simplify by using `push` instead..." (Type: `decision`)
*   *Reality*: These are transient intents, not decisions.

### 2. The "Echo Chamber" of Errors
The system indiscriminately captures raw logs as unique memories.
*   *Stored*: `console.error("Uncaught exception:", err);` (Type: `failed_attempt`)
*   *Count*: 6 separate instances of this exact string.
*   *Reality*: Raw logs are data, not wisdom. The *cause* of the error is the memory, not the log line itself.

### 3. False Positives
*   *Stored*: "The memories are now showing relative time..." (Type: `decision`)
*   *Reality*: This is an observation of UI state, not a technical decision.

## The Missing Intelligent Layer

A true memory system requires **synthesis**, not just recording. The current implementation is akin to a court stenographer recording every cough and stammer, rather than a clerk summarizing the verdict.

**What is missing:**
1.  **Session-Level Buffer**: A mechanism to hold 20-50 turns in "short-term memory" before committing anything to long-term storage.
2.  **LLM Synthesis**: An agent that looks at the buffer and says:
    *   "The user tried X, Y, and Z."
    *   "X and Y failed (discard the noise of the attempt, keep the lesson)."
    *   "Z worked (store this as the Solution)."
3.  **Deduplication**: Logic to recognize that `console.error` appearing 6 times is one event, not six.

## Conclusion

The current "store everything matching a regex" approach generates more noise than signal. To fix this, Alexandria must move from **Event-Triggered Extraction** to **Session-Phase Extraction** (e.g., "Analyze after task completion"), where an LLM reviews the transcript to separate the journey (noise) from the destination (memory).
