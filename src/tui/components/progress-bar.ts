/**
 * Progress Bar Component
 *
 * Reusable progress bar for displaying progress, budgets, etc.
 */

import { fg } from '@opentui/core';
import { COLORS } from '../utils/constants.ts';

export interface ProgressBarOptions {
  width?: number;
  filledChar?: string;
  emptyChar?: string;
  showPercent?: boolean;
  showBrackets?: boolean;
  colorThresholds?: { percent: number; color: string }[];
}

const DEFAULT_OPTIONS: ProgressBarOptions = {
  width: 20,
  filledChar: '█',
  emptyChar: '░',
  showPercent: true,
  showBrackets: true,
  colorThresholds: [
    { percent: 100, color: COLORS.error },
    { percent: 80, color: COLORS.warning },
    { percent: 0, color: COLORS.success },
  ],
};

/**
 * Create a simple progress bar string
 */
export function progressBar(value: number, max: number, options: ProgressBarOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const percent = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const filled = Math.round((percent / 100) * opts.width!);

  const bar = opts.filledChar!.repeat(filled) + opts.emptyChar!.repeat(opts.width! - filled);

  const wrapped = opts.showBrackets ? `[${bar}]` : bar;

  if (opts.showPercent) {
    return `${wrapped} ${percent.toFixed(0)}%`;
  }
  return wrapped;
}

/**
 * Create a colored progress bar based on thresholds
 */
export function coloredProgressBar(
  value: number,
  max: number,
  options: ProgressBarOptions = {},
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const percent = max > 0 ? (value / max) * 100 : 0;

  // Find appropriate color based on thresholds (sorted high to low)
  let color = COLORS.success;
  const thresholds = opts.colorThresholds || DEFAULT_OPTIONS.colorThresholds!;
  for (const threshold of thresholds) {
    if (percent >= threshold.percent) {
      color = threshold.color;
      break;
    }
  }

  const filled = Math.round((Math.min(percent, 100) / 100) * opts.width!);
  const bar = opts.filledChar!.repeat(filled) + opts.emptyChar!.repeat(opts.width! - filled);

  const coloredBar = fg(color)(bar);
  const wrapped = opts.showBrackets ? `[${coloredBar}]` : String(coloredBar);

  if (opts.showPercent) {
    return `${wrapped} ${percent.toFixed(0)}%`;
  }
  return String(wrapped);
}

/**
 * Create a compact progress indicator (e.g., "5/10")
 */
export function compactProgress(current: number, max: number): string {
  return `${current}/${max}`;
}

/**
 * Create a mini progress bar for status bar
 */
export function miniProgressBar(value: number, max: number, width: number = 10): string {
  const percent = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const filled = Math.round((percent / 100) * width);

  return '[' + '#'.repeat(filled) + '-'.repeat(width - filled) + ']';
}

/**
 * Create a budget gauge with color coding
 */
export function budgetGauge(
  used: number,
  limit: number,
  options: { width?: number; label?: string } = {},
): string {
  const { width = 20, label } = options;
  const percent = limit > 0 ? (used / limit) * 100 : 0;

  let color = COLORS.success;
  let icon = 'G';
  if (percent >= 100) {
    color = COLORS.error;
    icon = '!';
  } else if (percent >= 80) {
    color = COLORS.warning;
    icon = 'W';
  }

  const filled = Math.round((Math.min(percent, 100) / 100) * width);
  const bar = fg(color)('█'.repeat(filled) + '░'.repeat(width - filled));

  const percentStr = `${percent.toFixed(0)}%`;
  const labelStr = label ? `${label}: ` : '';

  return `${labelStr}[${bar}] ${percentStr} ${icon}`;
}
