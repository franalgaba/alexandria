/**
 * TUI Formatting Utilities
 */

import { fg } from '@opentui/core';
import { COLORS } from './constants.ts';

/**
 * Format relative time (e.g., "2m ago", "1h ago")
 */
export function formatRelativeTime(date: Date | null): string {
  if (!date) return 'never';

  const ms = Date.now() - date.getTime();
  const seconds = Math.floor(ms / 1000);

  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Format duration in milliseconds to human readable
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

/**
 * Format cost with appropriate precision
 */
export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `${(cost * 100).toFixed(2)}¢`;
  }
  return `$${cost.toFixed(4)}`;
}

/**
 * Format token count with K suffix for large numbers
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }
  return String(tokens);
}

/**
 * Truncate string with ellipsis
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Pad string to fixed width
 */
export function padRight(str: string, width: number): string {
  return str.padEnd(width);
}

export function padLeft(str: string, width: number): string {
  return str.padStart(width);
}

/**
 * Create a simple progress bar
 */
export function progressBar(
  value: number,
  max: number,
  width: number = 20,
  filledChar: string = '#',
  emptyChar: string = '-',
): string {
  const percent = max > 0 ? Math.min(value / max, 1) : 0;
  const filled = Math.round(percent * width);
  return '[' + filledChar.repeat(filled) + emptyChar.repeat(width - filled) + ']';
}

/**
 * Create a colored progress bar based on thresholds
 */
export function coloredProgressBar(value: number, max: number, width: number = 20): string {
  const percent = max > 0 ? (value / max) * 100 : 0;
  const bar = progressBar(value, max, width, '█', '░');

  let color = COLORS.success;
  if (percent >= 100) {
    color = COLORS.error;
  } else if (percent >= 80) {
    color = COLORS.warning;
  }

  return String(fg(color)(bar));
}

/**
 * Format timestamp for display
 */
export function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/**
 * Get health score color
 */
export function getHealthColor(score: number): string {
  if (score >= 80) return COLORS.success;
  if (score >= 60) return COLORS.warning;
  return COLORS.error;
}

/**
 * Get health score emoji
 */
export function getHealthEmoji(score: number): string {
  if (score >= 80) return 'G'; // Green
  if (score >= 60) return 'Y'; // Yellow
  return 'R'; // Red
}
