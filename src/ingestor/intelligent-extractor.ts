/**
 * Intelligent Memory Extractor
 *
 * Uses LLM to analyze session context and extract meaningful memories.
 * Works in two modes:
 * 1. Streaming: Analyzes chunks of conversation as they happen
 * 2. Session-end: Synthesizes patterns from the full session
 */

import type { Database } from 'bun:sqlite';
import { FTSIndex } from '../indexes/fts.ts';
import { VectorIndex } from '../indexes/vector.ts';
import { EventStore } from '../stores/events.ts';
import { MemoryObjectStore } from '../stores/memory-objects.ts';
import type { Event } from '../types/events.ts';
import type { Confidence, MemoryObject, ObjectType } from '../types/memory-objects.ts';

// Buffer for accumulating context
interface ContextBuffer {
  events: Event[];
  content: string[];
  startTime: Date;
  toolSequences: ToolSequence[];
  pendingAnalysis: boolean;
}

// Track tool call -> result sequences
interface ToolSequence {
  toolName: string;
  input: string;
  output: string;
  exitCode?: number;
  timestamp: Date;
}

// Extracted memory candidate from LLM
interface ExtractedMemory {
  type: ObjectType;
  content: string;
  reasoning: string;
  confidence: Confidence;
  evidenceEventIds: string[];
}

// Analysis triggers
const ANALYSIS_TRIGGERS = {
  // Minimum events before considering analysis
  minEvents: 5,
  // Maximum events before forcing analysis
  maxEvents: 20,
  // Time-based trigger (ms)
  maxAge: 60000, // 1 minute
  // Patterns that suggest a learning moment
  learningPatterns: [
    // Error -> multiple attempts -> success
    { name: 'error_resolution', detect: detectErrorResolution },
    // Explicit decision statement
    { name: 'explicit_decision', detect: detectExplicitDecision },
    // User correction
    { name: 'user_correction', detect: detectUserCorrection },
    // Architecture/pattern discussion
    { name: 'architecture_pattern', detect: detectArchitecturePattern },
  ],
};

const DUPLICATE_SIMILARITY_THRESHOLD = 0.8;

/**
 * Detect error -> attempts -> resolution pattern
 */
function detectErrorResolution(buffer: ContextBuffer): boolean {
  const sequences = buffer.toolSequences;
  if (sequences.length < 2) return false;

  // Look for: failed tool -> ... -> successful tool with similar context
  let hasError = false;
  let hasSuccess = false;

  for (const seq of sequences) {
    if (seq.exitCode !== undefined && seq.exitCode !== 0) {
      hasError = true;
    }
    if (hasError && seq.exitCode === 0) {
      hasSuccess = true;
    }
  }

  return hasError && hasSuccess;
}

/**
 * Detect explicit decision statements
 */
function detectExplicitDecision(buffer: ContextBuffer): boolean {
  const content = buffer.content.join('\n').toLowerCase();
  const decisionPhrases = [
    'i decided to',
    'we should use',
    'the approach will be',
    'going with',
    'choosing',
    'instead of using',
    'rather than',
  ];
  return decisionPhrases.some((phrase) => content.includes(phrase));
}

/**
 * Detect user corrections
 */
function detectUserCorrection(buffer: ContextBuffer): boolean {
  const content = buffer.content.join('\n').toLowerCase();
  const correctionPhrases = [
    "no, don't",
    'no, use',
    "that's wrong",
    'actually,',
    'not like that',
    'instead,',
    'you should',
    'never do',
    'always use',
  ];
  return correctionPhrases.some((phrase) => content.includes(phrase));
}

/**
 * Detect architecture/pattern discussions
 */
function detectArchitecturePattern(buffer: ContextBuffer): boolean {
  const content = buffer.content.join('\n').toLowerCase();
  const patternPhrases = [
    'pattern',
    'architecture',
    'structure',
    'organize',
    'convention',
    'standard',
    'best practice',
    'in this project',
    'we follow',
  ];
  const matchCount = patternPhrases.filter((phrase) => content.includes(phrase)).length;
  return matchCount >= 2; // Multiple pattern-related terms
}

export class IntelligentExtractor {
  private store: MemoryObjectStore;
  private eventStore: EventStore;
  private fts: FTSIndex;
  private vector: VectorIndex;
  private buffer: ContextBuffer;
  private llmProvider: LLMProvider | null = null;

  constructor(db: Database, llmProvider?: LLMProvider) {
    this.store = new MemoryObjectStore(db);
    this.eventStore = new EventStore(db);
    this.fts = new FTSIndex(db);
    this.vector = new VectorIndex(db);
    this.llmProvider = llmProvider || null;
    this.buffer = this.createEmptyBuffer();
  }

  private createEmptyBuffer(): ContextBuffer {
    return {
      events: [],
      content: [],
      startTime: new Date(),
      toolSequences: [],
      pendingAnalysis: false,
    };
  }

  /**
   * Process an event and add to buffer
   */
  async processEvent(event: Event, content: string): Promise<ExtractedMemory[]> {
    // Add to buffer
    this.buffer.events.push(event);
    this.buffer.content.push(content);

    // Track tool sequences
    if (event.eventType === 'tool_output' && event.toolName) {
      this.buffer.toolSequences.push({
        toolName: event.toolName,
        input: '', // Would need to correlate with tool_call
        output: content,
        exitCode: event.exitCode,
        timestamp: event.timestamp,
      });
    }

    // Check if we should analyze
    const shouldAnalyze = this.shouldTriggerAnalysis();
    if (shouldAnalyze) {
      return this.analyzeBuffer();
    }

    return [];
  }

  /**
   * Check if analysis should be triggered
   */
  private shouldTriggerAnalysis(): boolean {
    const buffer = this.buffer;

    // Already pending
    if (buffer.pendingAnalysis) return false;

    // Force analysis if buffer is large
    if (buffer.events.length >= ANALYSIS_TRIGGERS.maxEvents) {
      return true;
    }

    // Skip if too few events
    if (buffer.events.length < ANALYSIS_TRIGGERS.minEvents) {
      return false;
    }

    // Check time-based trigger
    const age = Date.now() - buffer.startTime.getTime();
    if (age >= ANALYSIS_TRIGGERS.maxAge) {
      return true;
    }

    // Check for learning moment patterns
    for (const trigger of ANALYSIS_TRIGGERS.learningPatterns) {
      if (trigger.detect(buffer)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Analyze buffer and extract memories
   */
  private async analyzeBuffer(): Promise<ExtractedMemory[]> {
    this.buffer.pendingAnalysis = true;

    try {
      // If no LLM provider, use heuristic extraction
      if (!this.llmProvider) {
        return this.heuristicExtraction();
      }

      // Use LLM for intelligent extraction
      const memories = await this.llmExtraction();

      // Save extracted memories
      for (const memory of memories) {
        await this.saveMemory(memory);
      }

      return memories;
    } finally {
      // Reset buffer
      this.buffer = this.createEmptyBuffer();
    }
  }

  /**
   * Heuristic extraction when no LLM available
   * Focuses on high-signal patterns only
   */
  private heuristicExtraction(): ExtractedMemory[] {
    const memories: ExtractedMemory[] = [];
    const buffer = this.buffer;

    // Pattern 1: Error resolution
    if (detectErrorResolution(buffer)) {
      const errorSeq = buffer.toolSequences.find((s) => s.exitCode !== 0);
      const successSeq = buffer.toolSequences.find((s) => s.exitCode === 0);

      if (errorSeq && successSeq) {
        memories.push({
          type: 'known_fix',
          content: `When ${errorSeq.toolName} fails, the fix involves: ${successSeq.output.slice(0, 200)}`,
          reasoning: 'Detected error followed by successful resolution',
          confidence: 'medium',
          evidenceEventIds: buffer.events.map((e) => e.id),
        });
      }
    }

    // Pattern 2: Explicit decisions (conservative)
    if (detectExplicitDecision(buffer)) {
      const decisionContent = buffer.content.find(
        (c) => /(?:decided|choosing|going with|instead of)/i.test(c) && c.includes('because'),
      );

      if (decisionContent) {
        memories.push({
          type: 'decision',
          content: decisionContent.slice(0, 300),
          reasoning: 'Explicit decision statement with reasoning',
          confidence: 'medium',
          evidenceEventIds: buffer.events.map((e) => e.id),
        });
      }
    }

    // Pattern 3: User corrections (high signal)
    if (detectUserCorrection(buffer)) {
      const correctionContent = buffer.content.find((c) =>
        /(?:no,|don't|never|always|instead,)/i.test(c),
      );

      if (correctionContent && correctionContent.length > 20) {
        memories.push({
          type: 'constraint',
          content: correctionContent.slice(0, 300),
          reasoning: 'User correction or explicit rule',
          confidence: 'high',
          evidenceEventIds: buffer.events.map((e) => e.id),
        });
      }
    }

    return memories;
  }

  /**
   * LLM-based extraction
   */
  private async llmExtraction(): Promise<ExtractedMemory[]> {
    if (!this.llmProvider) return [];

    const prompt = this.buildExtractionPrompt();
    const response = await this.llmProvider.complete(prompt);

    return this.parseExtractionResponse(response);
  }

  /**
   * Build prompt for LLM extraction
   */
  private buildExtractionPrompt(): string {
    const context = this.buffer.content.slice(-10).join('\n\n---\n\n');
    const toolSummary = this.buffer.toolSequences
      .map((s) => `${s.toolName}: ${s.exitCode === 0 ? 'success' : 'failed'}`)
      .join(', ');

    return `Analyze this coding session excerpt and extract actionable memories.

## Context
${context}

## Tool Activity
${toolSummary || 'No tool calls'}

## Instructions
Extract memories that would be useful in FUTURE coding sessions. Each memory should be:
1. Actionable - something that can be applied
2. Specific - includes enough context to understand
3. Grounded - based on what actually happened, not speculation

Memory types:
- decision: Technical choice with rationale
- constraint: Hard rule that must be followed
- known_fix: Solution to a specific problem
- convention: Coding pattern or standard
- preference: Preferred approach (less strict than constraint)
- failed_attempt: Something that was tried and didn't work

## Output Format (JSON)
{
  "memories": [
    {
      "type": "known_fix",
      "content": "When X fails with error Y, the fix is to Z",
      "reasoning": "Why this is worth remembering",
      "confidence": "high|medium|low"
    }
  ]
}

If nothing is worth extracting, return {"memories": []}.

Only extract memories that would genuinely help in future sessions.`;
  }

  /**
   * Parse LLM response into memories
   */
  private parseExtractionResponse(response: string): ExtractedMemory[] {
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]);
      if (!parsed.memories || !Array.isArray(parsed.memories)) return [];

      return parsed.memories.map((m: any) => ({
        type: m.type as ObjectType,
        content: m.content,
        reasoning: m.reasoning || '',
        confidence: (m.confidence || 'medium') as Confidence,
        evidenceEventIds: this.buffer.events.map((e) => e.id),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Save extracted memory to store
   */
  private async saveMemory(memory: ExtractedMemory): Promise<MemoryObject> {
    const duplicate = this.findDuplicate(memory);
    if (duplicate) {
      return duplicate;
    }

    const hasEvidence = memory.evidenceEventIds.length > 0;
    const isHighConfidence = memory.confidence === 'high' || memory.confidence === 'certain';
    const obj = this.store.create({
      content: memory.content,
      objectType: memory.type,
      confidence: memory.confidence,
      evidenceEventIds: memory.evidenceEventIds,
      evidenceExcerpt: memory.reasoning,
      reviewStatus: isHighConfidence && hasEvidence ? 'approved' : 'pending',
    });

    // Index for vector search
    await this.vector.indexObject(obj.id, obj.content);

    return obj;
  }

  /**
   * Find duplicate memory based on content similarity
   */
  private findDuplicate(memory: ExtractedMemory): MemoryObject | null {
    const candidates = this.findCandidateMemories(memory);
    let best: { object: MemoryObject; score: number } | null = null;

    for (const candidate of candidates) {
      if (candidate.objectType !== memory.type) continue;
      const similarity = this.calculateSimilarity(memory.content, candidate.content);
      if (similarity >= DUPLICATE_SIMILARITY_THRESHOLD) {
        if (!best || similarity > best.score) {
          best = { object: candidate, score: similarity };
        }
      }
    }

    return best?.object ?? null;
  }

  /**
   * Find likely candidate memories for deduplication
   */
  private findCandidateMemories(memory: ExtractedMemory): MemoryObject[] {
    try {
      const ftsResults = this.fts.searchObjects(memory.content, ['active'], 10);
      if (ftsResults.length > 0) {
        return ftsResults.map((r) => r.object);
      }
    } catch {
      // Fallback to a bounded list
    }

    return this.store.list({ status: ['active'], limit: 200 });
  }

  /**
   * Calculate content similarity (simple Jaccard-like)
   */
  private calculateSimilarity(a: string, b: string): number {
    const tokensA = new Set(this.tokenize(a));
    const tokensB = new Set(this.tokenize(b));

    if (tokensA.size === 0 || tokensB.size === 0) return 0;

    const intersection = new Set([...tokensA].filter((x) => tokensB.has(x)));
    const union = new Set([...tokensA, ...tokensB]);

    return intersection.size / union.size;
  }

  /**
   * Tokenize text for comparison
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2);
  }

  /**
   * Force analysis of current buffer (e.g., on session end)
   */
  async flushBuffer(): Promise<ExtractedMemory[]> {
    if (this.buffer.events.length === 0) return [];
    return this.analyzeBuffer();
  }

  /**
   * Get buffer statistics
   */
  getBufferStats(): { events: number; age: number; sequences: number } {
    return {
      events: this.buffer.events.length,
      age: Date.now() - this.buffer.startTime.getTime(),
      sequences: this.buffer.toolSequences.length,
    };
  }
}

/**
 * LLM Provider interface
 */
export interface LLMProvider {
  complete(prompt: string): Promise<string>;
  /** Get last call's token usage (if available) */
  getLastUsage?(): { inputTokens: number; outputTokens: number; model: string } | null;
}

// API Response types for type safety
interface OllamaResponse {
  response: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface ClaudeResponse {
  content: Array<{ type: string; text: string }>;
  usage?: { input_tokens: number; output_tokens: number };
}

interface OpenAIResponse {
  choices: Array<{ message: { content: string } }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

/**
 * Simple LLM provider using local Ollama
 */
export class OllamaProvider implements LLMProvider {
  private lastUsage: { inputTokens: number; outputTokens: number; model: string } | null = null;

  constructor(
    private model: string = 'llama3.2',
    private baseUrl: string = 'http://localhost:11434',
  ) {}

  async complete(prompt: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status}`);
    }

    const data = (await response.json()) as OllamaResponse;

    // Track usage (Ollama provides token counts)
    this.lastUsage = {
      inputTokens: data.prompt_eval_count || Math.ceil(prompt.length / 4),
      outputTokens: data.eval_count || Math.ceil(data.response.length / 4),
      model: 'local',
    };

    return data.response;
  }

  getLastUsage() {
    return this.lastUsage;
  }
}

/**
 * Anthropic Claude provider
 * Supports both API keys and OAuth tokens (from Claude Code)
 */
export class ClaudeProvider implements LLMProvider {
  private lastUsage: { inputTokens: number; outputTokens: number; model: string } | null = null;
  private isOAuth: boolean;

  constructor(
    private apiKey: string,
    private model: string = 'claude-3-5-haiku-20241022',
  ) {
    // OAuth tokens start with sk-ant-oat
    this.isOAuth = apiKey.startsWith('sk-ant-oat');
  }

  async complete(prompt: string): Promise<string> {
    // Build headers based on auth type
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };

    if (this.isOAuth) {
      // OAuth token requires different headers
      headers['Authorization'] = `Bearer ${this.apiKey}`;
      headers['anthropic-beta'] = 'oauth-2025-04-20';
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    } else {
      // Standard API key
      headers['x-api-key'] = this.apiKey;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as ClaudeResponse;

    // Track usage from API response
    this.lastUsage = {
      inputTokens: data.usage?.input_tokens || Math.ceil(prompt.length / 4),
      outputTokens: data.usage?.output_tokens || Math.ceil(data.content[0].text.length / 4),
      model: this.model,
    };

    return data.content[0].text;
  }

  getLastUsage() {
    return this.lastUsage;
  }
}

/**
 * OpenAI provider
 */
export class OpenAIProvider implements LLMProvider {
  private lastUsage: { inputTokens: number; outputTokens: number; model: string } | null = null;

  constructor(
    private apiKey: string,
    private model: string = 'gpt-4o-mini',
  ) {}

  async complete(prompt: string): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI error: ${response.status}`);
    }

    const data = (await response.json()) as OpenAIResponse;

    // Track usage from API response
    this.lastUsage = {
      inputTokens: data.usage?.prompt_tokens || Math.ceil(prompt.length / 4),
      outputTokens:
        data.usage?.completion_tokens || Math.ceil(data.choices[0].message.content.length / 4),
      model: this.model,
    };

    return data.choices[0].message.content;
  }

  getLastUsage() {
    return this.lastUsage;
  }
}
