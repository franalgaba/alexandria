/**
 * Context Window Monitor
 *
 * Parses Claude Code transcript JSONL to calculate token usage
 * and determine when to suggest checkpoint + clear.
 */

import { readFileSync, existsSync } from 'node:fs';

// Claude Sonnet 4.5 context window
const MAX_CONTEXT_TOKENS = 200_000;

// Default threshold for suggesting clear (50%)
const DEFAULT_THRESHOLD_PERCENT = Number(process.env.ALEXANDRIA_CONTEXT_THRESHOLD) || 50;

export interface TranscriptUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface TranscriptEntry {
  timestamp?: string;
  isSidechain?: boolean;
  isApiErrorMessage?: boolean;
  message?: {
    usage?: TranscriptUsage;
  };
}

export interface ContextUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  percentage: number;
  exceeds50Percent: boolean;
  exceedsThreshold: boolean;
  threshold: number;
  recommendation: 'continue' | 'checkpoint_and_clear';
}

/**
 * Parse transcript JSONL and calculate context usage
 */
export function calculateContextUsage(transcriptPath: string): ContextUsage | null {
  if (!existsSync(transcriptPath)) {
    return null;
  }

  try {
    const content = readFileSync(transcriptPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    // Parse all entries
    const entries: TranscriptEntry[] = lines
      .map((line) => {
        try {
          return JSON.parse(line) as TranscriptEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is TranscriptEntry => e !== null);

    // Filter to main chain entries with usage data
    const validEntries = entries.filter(
      (e) => !e.isSidechain && !e.isApiErrorMessage && e.message?.usage,
    );

    if (validEntries.length === 0) {
      return {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 0,
        percentage: 0,
        exceeds50Percent: false,
        exceedsThreshold: false,
        threshold: DEFAULT_THRESHOLD_PERCENT,
        recommendation: 'continue',
      };
    }

    // Sort by timestamp and get most recent (Anthropic provides cumulative usage)
    validEntries.sort((a, b) => {
      const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return timeB - timeA;
    });

    const latest = validEntries[0];
    const usage = latest.message!.usage!;

    // Sum all token types (all count toward context window)
    const inputTokens = usage.input_tokens || 0;
    const outputTokens = usage.output_tokens || 0;
    const cacheReadTokens = usage.cache_read_input_tokens || 0;
    const cacheCreationTokens = usage.cache_creation_input_tokens || 0;

    // Total context usage
    const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;
    const percentage = (totalTokens / MAX_CONTEXT_TOKENS) * 100;

    const exceeds50Percent = percentage >= 50;
    const exceedsThreshold = percentage >= DEFAULT_THRESHOLD_PERCENT;

    return {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      totalTokens,
      percentage: Math.round(percentage * 10) / 10, // Round to 1 decimal
      exceeds50Percent,
      exceedsThreshold,
      threshold: DEFAULT_THRESHOLD_PERCENT,
      recommendation: exceedsThreshold ? 'checkpoint_and_clear' : 'continue',
    };
  } catch (error) {
    console.error('Error parsing transcript:', error);
    return null;
  }
}

/**
 * Format context usage for display
 */
export function formatContextUsage(usage: ContextUsage): string {
  const bar = createProgressBar(usage.percentage, 20);
  const warning = usage.exceedsThreshold ? '⚠️ ' : '';

  return `${warning}Context: ${bar} ${usage.percentage}% (${formatTokenCount(usage.totalTokens)} tokens)
  Input: ${formatTokenCount(usage.inputTokens)} | Output: ${formatTokenCount(usage.outputTokens)}
  Cache Read: ${formatTokenCount(usage.cacheReadTokens)} | Cache Create: ${formatTokenCount(usage.cacheCreationTokens)}
  Recommendation: ${usage.recommendation === 'checkpoint_and_clear' ? '🔄 Checkpoint and clear' : '✅ Continue'}`;
}

/**
 * Create a progress bar string
 */
function createProgressBar(percentage: number, width: number): string {
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  const filledChar = percentage >= 50 ? '█' : '▓';
  return `[${filledChar.repeat(filled)}${'░'.repeat(empty)}]`;
}

/**
 * Format token count with K suffix
 */
function formatTokenCount(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toString();
}
