/**
 * LLM-as-Judge evaluator for memorybench
 *
 * Uses Claude to:
 * 1. Generate answers from retrieved context
 * 2. Judge answer correctness against ground truth
 */

import { getAnthropicApiKey } from '../../src/utils/claude-auth.ts';
import type { AlexandriaSearchResult } from './types.ts';

interface JudgeResult {
  generatedAnswer: string;
  score: number; // 0-1 score
  reasoning: string;
}

interface ClaudeResponse {
  content: Array<{ text: string }>;
  usage?: { input_tokens: number; output_tokens: number };
}

export class LLMJudge {
  private apiKey: string;
  private model: string;
  private isOAuth: boolean;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;

  constructor(apiKey: string, model = 'claude-3-5-haiku-20241022') {
    this.apiKey = apiKey;
    this.model = model;
    this.isOAuth = apiKey.startsWith('sk-ant-oat');
  }

  /**
   * Generate an answer from retrieved context
   */
  async generateAnswer(
    question: string,
    context: AlexandriaSearchResult[],
  ): Promise<string> {
    const contextText = context
      .map((c, i) => `[${i + 1}] ${c.role}: ${c.content}`)
      .join('\n\n');

    // Detect question type for specialized handling
    const isTemporalQuestion = /when|date|time|how long|ago|before|after|during/i.test(question);
    const isListQuestion = /what (activities|events|things|items)|list|name all/i.test(question);
    const isReasoningQuestion = /would|could|likely|probably|why/i.test(question);

    let instructions = '';
    if (isTemporalQuestion) {
      instructions = `
TEMPORAL QUESTION DETECTED. Follow these steps:
1. First, identify ALL dates, times, and temporal references in the context
2. Match the question's time frame to the relevant date/event
3. Provide the specific date or time period`;
    } else if (isListQuestion) {
      instructions = `
LIST QUESTION DETECTED. Follow these steps:
1. Scan ALL context entries for relevant items
2. Compile a complete list from different parts of the conversation
3. Include all mentioned items, not just the first few`;
    } else if (isReasoningQuestion) {
      instructions = `
INFERENCE QUESTION DETECTED. Follow these steps:
1. Identify relevant facts from the context
2. Apply logical reasoning based on those facts
3. State your inference with supporting evidence`;
    } else {
      instructions = `
FACTUAL QUESTION. Follow these steps:
1. Find the most relevant passage in the context
2. Extract the specific answer
3. Be precise and concise`;
    }

    const prompt = `You are answering questions based on conversation history. Be accurate and thorough.

CONVERSATION HISTORY:
${contextText}

QUESTION: ${question}
${instructions}

Think step by step, then provide your final answer.

REASONING: <brief analysis of relevant context>
ANSWER: <your concise answer based on the context>`;

    const response = await this.complete(prompt);

    // Extract just the answer part for cleaner output
    const answerMatch = response.match(/ANSWER:\s*(.+?)(?:\n|$)/s);
    return answerMatch ? answerMatch[1].trim() : response;
  }

  /**
   * Judge if the generated answer matches the ground truth
   */
  async judgeAnswer(
    question: string,
    groundTruth: string,
    generatedAnswer: string,
  ): Promise<{ score: number; reasoning: string }> {
    const prompt = `You are a fair evaluator comparing an AI-generated answer to a reference answer.

QUESTION: ${question}

REFERENCE ANSWER: ${groundTruth}

GENERATED ANSWER: ${generatedAnswer}

SCORING GUIDELINES:
- Focus on SEMANTIC EQUIVALENCE, not exact wording
- Accept reasonable paraphrases and synonyms
- For dates: "May 7, 2023", "7 May 2023", "May 2023" are all acceptable if the key date is captured
- For lists: Partial credit if some items are correct
- For temporal: "the week before June 9" and "early June" are close enough
- "I don't know" or refusing to answer = 0.0

SCORING SCALE:
- 1.0: Semantically equivalent or captures the essential answer
- 0.75: Correct main point with minor differences in detail
- 0.5: Partially correct, captures some but not all key information
- 0.25: Tangentially related but misses the main point
- 0.0: Wrong, contradictory, or no answer provided

Evaluate fairly and respond in this exact format:
SCORE: <number>
REASONING: <one sentence explanation>`;

    const response = await this.complete(prompt);

    // Parse score and reasoning
    const scoreMatch = response.match(/SCORE:\s*([\d.]+)/);
    const reasoningMatch = response.match(/REASONING:\s*(.+)/s);

    const score = scoreMatch ? parseFloat(scoreMatch[1]) : 0;
    const reasoning = reasoningMatch ? reasoningMatch[1].trim() : response;

    return { score: Math.max(0, Math.min(1, score)), reasoning };
  }

  /**
   * Full evaluation: generate answer and judge it
   */
  async evaluate(
    question: string,
    groundTruth: string,
    context: AlexandriaSearchResult[],
  ): Promise<JudgeResult> {
    const generatedAnswer = await this.generateAnswer(question, context);
    const { score, reasoning } = await this.judgeAnswer(
      question,
      groundTruth,
      generatedAnswer,
    );

    return { generatedAnswer, score, reasoning };
  }

  /**
   * Get token usage stats
   */
  getUsage(): { inputTokens: number; outputTokens: number } {
    return {
      inputTokens: this.totalInputTokens,
      outputTokens: this.totalOutputTokens,
    };
  }

  private async complete(prompt: string): Promise<string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };

    if (this.isOAuth) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
      headers['anthropic-beta'] = 'oauth-2025-04-20';
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    } else {
      headers['x-api-key'] = this.apiKey;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024, // Increased for chain-of-thought reasoning
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as ClaudeResponse;

    // Track usage
    if (data.usage) {
      this.totalInputTokens += data.usage.input_tokens;
      this.totalOutputTokens += data.usage.output_tokens;
    }

    return data.content[0].text;
  }
}

/**
 * Create LLM judge if API key available
 */
export async function createLLMJudge(): Promise<LLMJudge | null> {
  const apiKey = await getAnthropicApiKey();
  if (!apiKey) {
    console.log('[Judge] No API key available. Set ANTHROPIC_API_KEY or use Claude Code.');
    return null;
  }

  console.log('[Judge] Using Claude Haiku for evaluation');
  return new LLMJudge(apiKey);
}
