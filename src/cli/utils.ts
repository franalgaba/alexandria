/**
 * CLI utility functions
 */

import * as readline from 'node:readline';

/**
 * Format a date for display
 */
export function formatDate(date: Date): string {
  return date
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, '');
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

/**
 * Create a simple table
 */
export function table(headers: string[], rows: string[][]): string {
  // Calculate column widths
  const widths = headers.map((h, i) => {
    const colValues = [h, ...rows.map((r) => r[i] || '')];
    return Math.max(...colValues.map((v) => v.length));
  });

  // Format header
  const headerRow = headers.map((h, i) => h.padEnd(widths[i])).join(' | ');
  const separator = widths.map((w) => '-'.repeat(w)).join('-+-');

  // Format rows
  const dataRows = rows.map((row) =>
    row.map((cell, i) => (cell || '').padEnd(widths[i])).join(' | '),
  );

  return [headerRow, separator, ...dataRows].join('\n');
}

/**
 * Print with color (simple ANSI codes)
 */
export const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

export function colorize(text: string, color: keyof typeof colors): string {
  return `${colors[color]}${text}${colors.reset}`;
}

/**
 * Print success message
 */
export function success(message: string): void {
  console.log(colorize(`✓ ${message}`, 'green'));
}

/**
 * Print error message
 */
export function error(message: string): void {
  console.error(colorize(`✗ ${message}`, 'red'));
}

/**
 * Print warning message
 */
export function warn(message: string): void {
  console.warn(colorize(`⚠ ${message}`, 'yellow'));
}

/**
 * Print info message
 */
export function info(message: string): void {
  console.log(colorize(`ℹ ${message}`, 'blue'));
}

/**
 * Prompt user for input
 */
export async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Prompt for confirmation
 */
export async function confirm(question: string): Promise<boolean> {
  const answer = await prompt(`${question} [y/N] `);
  return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
}

/**
 * Prompt for selection from list
 */
export async function select(question: string, options: string[]): Promise<number> {
  console.log(question);
  options.forEach((opt, i) => {
    console.log(`  ${i + 1}. ${opt}`);
  });

  const answer = await prompt('Selection: ');
  const num = Number.parseInt(answer, 10);

  if (Number.isNaN(num) || num < 1 || num > options.length) {
    return -1;
  }

  return num - 1;
}

/**
 * Type emoji helpers
 */
export function getTypeEmoji(type: string): string {
  const emojis: Record<string, string> = {
    decision: '🎯',
    preference: '⭐',
    convention: '📏',
    known_fix: '✅',
    constraint: '🚫',
    failed_attempt: '❌',
    environment: '⚙️',
  };
  return emojis[type] || '📝';
}

/**
 * Status badge
 */
export function getStatusBadge(status: string): string {
  const badges: Record<string, string> = {
    active: colorize('●', 'green'),
    stale: colorize('●', 'yellow'),
    superseded: colorize('●', 'blue'),
    retired: colorize('●', 'gray'),
  };
  return badges[status] || status;
}
