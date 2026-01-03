/**
 * TUI Constants
 */

import type { ContextLevel } from '../../retriever/progressive.ts';
import type { ScopeType } from '../../types/common.ts';
import type { Confidence, ObjectType } from '../../types/memory-objects.ts';

// Type abbreviations (clean, no emojis)
export const TYPE_ABBREV: Record<string, string> = {
  decision: 'DEC',
  constraint: 'CON',
  convention: 'CNV',
  known_fix: 'FIX',
  failed_attempt: 'FAL',
  preference: 'PRF',
  environment: 'ENV',
};

// Type icons
export const TYPE_ICON: Record<string, string> = {
  decision: 'D',
  constraint: '!',
  convention: 'C',
  known_fix: 'F',
  failed_attempt: 'X',
  preference: 'P',
  environment: 'E',
};

// Review status indicators
export const REVIEW_INDICATOR: Record<string, string> = {
  pending: '?',
  approved: '+',
  rejected: '-',
};

// Memory status indicators
export const STATUS_INDICATOR: Record<string, string> = {
  active: ' ',
  stale: '~',
  superseded: '^',
  retired: 'x',
};

// Available options for forms
export const MEMORY_TYPES: ObjectType[] = [
  'decision',
  'preference',
  'convention',
  'known_fix',
  'constraint',
  'failed_attempt',
  'environment',
];

export const CONFIDENCE_LEVELS: Confidence[] = ['certain', 'high', 'medium', 'low'];

export const SCOPE_TYPES: ScopeType[] = ['global', 'project', 'module', 'file'];

export const PACK_LEVELS: ContextLevel[] = ['minimal', 'task', 'deep'];

// Timing constants
export const REFRESH_INTERVAL_MS = 3000;
export const DEBUG_REFRESH_INTERVAL_MS = 500;
export const MAX_DEBUG_LOGS = 100;
export const MAX_CONTEXT_HISTORY = 50;

// Debug panel constants
export const DEBUG_PANEL_MIN_HEIGHT = 8;
export const DEBUG_PANEL_MAX_HEIGHT = 60;
export const DEBUG_PANEL_DEFAULT_HEIGHT = 20;

// Checkpoint threshold (can be overridden by env)
export const DEFAULT_CHECKPOINT_THRESHOLD = 10;

// Colors
export const COLORS = {
  primary: '#58a6ff',
  secondary: '#8b949e',
  success: '#3fb950',
  warning: '#d29922',
  error: '#f85149',
  muted: '#666666',
  highlight: '#ffd93d',
};
