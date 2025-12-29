/**
 * Event type detection and classification
 */

import type { EventType } from '../types/events.ts';

/**
 * Classify content into an event type
 */
export function classifyEventType(
  content: string,
  hints: { toolName?: string; exitCode?: number; filePath?: string } = {},
): EventType {
  // Tool output takes priority if we have a tool name
  if (hints.toolName) {
    return 'tool_output';
  }

  // Check for error patterns
  if (isError(content, hints.exitCode)) {
    return 'error';
  }

  // Check for diff patterns
  if (isDiff(content)) {
    return 'diff';
  }

  // Check for test summary patterns
  if (isTestSummary(content)) {
    return 'test_summary';
  }

  // Default to turn
  return 'turn';
}

/**
 * Check if content looks like an error
 */
function isError(content: string, exitCode?: number): boolean {
  if (exitCode !== undefined && exitCode !== 0) {
    return true;
  }

  const errorPatterns = [
    /^error:/im,
    /^fatal:/im,
    /exception/i,
    /traceback/i,
    /stack trace/i,
    /panic:/i,
    /failed with exit code/i,
    /command failed/i,
    /compilation error/i,
    /syntax error/i,
  ];

  return errorPatterns.some((p) => p.test(content));
}

/**
 * Check if content looks like a diff
 */
function isDiff(content: string): boolean {
  const diffPatterns = [
    /^diff --git/m,
    /^@@.*@@/m,
    /^\+\+\+ /m,
    /^--- /m,
    /^index [a-f0-9]+\.\.[a-f0-9]+/m,
  ];

  return diffPatterns.some((p) => p.test(content));
}

/**
 * Check if content looks like a test summary
 */
function isTestSummary(content: string): boolean {
  const testPatterns = [
    /\d+ tests? passed/i,
    /\d+ tests? failed/i,
    /tests?:\s*\d+/i,
    /passed:\s*\d+/i,
    /failed:\s*\d+/i,
    /\btest suite\b/i,
    /^PASS /m,
    /^FAIL /m,
    /test run/i,
  ];

  return testPatterns.some((p) => p.test(content));
}
