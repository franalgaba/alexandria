/**
 * Review Queue View
 *
 * Display and process pending memories from Tier 1 extraction.
 * Activated with 'Shift+P' key.
 */

import type { KeyEvent, ScrollBoxRenderable, TextRenderable } from '@opentui/core';
import { bold, fg, t } from '@opentui/core';
import { getConnection } from '../../stores/connection.ts';
import type { ReviewQueueItem } from '../../types/retriever.ts';
import { getConfidenceTierEmoji } from '../../utils/confidence.ts';
import { type ReviewAction, reviewService } from '../services/index.ts';
import { COLORS, TYPE_ABBREV } from '../utils/constants.ts';
import { truncate } from '../utils/formatters.ts';

// Module state (bridged from main TUI)
let currentProject: string | null = null;
let inputPanel: ScrollBoxRenderable | null = null;
let inputText: TextRenderable | null = null;
let helpText: TextRenderable | null = null;

// Review mode state
let items: ReviewQueueItem[] = [];
let selectedIndex = 0;
let isLoading = false;

// Callbacks
let onExitMode: (() => void) | null = null;
let onShowFeedback: ((msg: string) => void) | null = null;

/**
 * Initialize view with TUI elements (called before entering mode)
 */
export function initReviewView(options: {
  project: string | null;
  inputPanelRef: ScrollBoxRenderable;
  inputTextRef: TextRenderable;
  helpTextRef: TextRenderable;
  exitModeCallback: () => void;
  showFeedbackCallback: (msg: string) => void;
}): void {
  currentProject = options.project;
  inputPanel = options.inputPanelRef;
  inputText = options.inputTextRef;
  helpText = options.helpTextRef;
  onExitMode = options.exitModeCallback;
  onShowFeedback = options.showFeedbackCallback;
}

/**
 * Enter review mode
 */
export async function enterReviewMode(): Promise<void> {
  selectedIndex = 0;
  isLoading = true;
  showReviewPanel();
  updateReviewPanel();

  await loadReviewData();

  isLoading = false;
  updateReviewPanel();
  updateReviewHelpText();
}

/**
 * Load review queue data
 */
async function loadReviewData(): Promise<void> {
  if (!currentProject) return;

  try {
    const db = getConnection(currentProject);
    reviewService.initialize(db);

    items = await reviewService.getReviewQueue(20);
    selectedIndex = 0;
  } catch (error) {
    items = [];
  }
}

/**
 * Show review panel
 */
function showReviewPanel(): void {
  if (inputPanel) {
    inputPanel.visible = true;
  }
}

/**
 * Update review panel content
 */
export function updateReviewPanel(): void {
  let content = '';

  // Header
  content += `${bold('╔══════════════════════════════════════════════════════════════╗')}\n`;
  content += `${bold('║')}                    ${bold('PENDING REVIEW QUEUE')}                       ${bold('║')}\n`;
  content += `${bold('╠══════════════════════════════════════════════════════════════╣')}\n`;

  if (isLoading) {
    content += `${bold('║')}                                                              ${bold('║')}\n`;
    content += `${bold('║')}  Loading pending memories...                                ${bold('║')}\n`;
    content += `${bold('║')}                                                              ${bold('║')}\n`;
    content += `${bold('╚══════════════════════════════════════════════════════════════╝')}\n`;
  } else if (items.length === 0) {
    content += `${bold('║')}                                                              ${bold('║')}\n`;
    content += `${bold('║')}  ${fg(COLORS.success)('All caught up!')}                                          ${bold('║')}\n`;
    content += `${bold('║')}                                                              ${bold('║')}\n`;
    content += `${bold('║')}  No pending memories to review.                             ${bold('║')}\n`;
    content += `${bold('║')}  Tier 1 extracted memories have been processed.             ${bold('║')}\n`;
    content += `${bold('║')}                                                              ${bold('║')}\n`;
    content += `${bold('╚══════════════════════════════════════════════════════════════╝')}\n`;
  } else {
    const item = items[selectedIndex];
    const obj = item.object;

    // Navigation indicator
    content += `${bold('║')}  ${fg(COLORS.muted)(`Item ${selectedIndex + 1} of ${items.length}`)}                                            ${bold('║')}\n`;
    content += `${bold('╠══════════════════════════════════════════════════════════════╣')}\n`;

    // Memory type and tier
    const typeAbbrev = TYPE_ABBREV[obj.objectType] || obj.objectType.slice(0, 3).toUpperCase();
    const tierEmoji = getConfidenceTierEmoji(obj.confidenceTier);

    content += `${bold('║')}  ${bold(`[${typeAbbrev}]`)} ${tierEmoji} ${obj.objectType.toUpperCase().padEnd(15)}                          ${bold('║')}\n`;
    content += `${bold('╠══════════════════════════════════════════════════════════════╣')}\n`;

    // Memory content (wrapped)
    content += `${bold('║')}  ${bold('Content:')}                                                    ${bold('║')}\n`;
    const contentLines = wrapText(obj.content, 58);
    for (const line of contentLines.slice(0, 4)) {
      content += `${bold('║')}  ${line.padEnd(60)}${bold('║')}\n`;
    }
    if (contentLines.length > 4) {
      content += `${bold('║')}  ${fg(COLORS.muted)('...')}                                                         ${bold('║')}\n`;
    }

    content += `${bold('╠══════════════════════════════════════════════════════════════╣')}\n`;

    // Suggestion
    const actionColor = getActionColor(item.suggestedAction);
    content += `${bold('║')}  ${bold('Suggested:')} ${fg(actionColor)(item.suggestedAction.toUpperCase().padEnd(10))}                           ${bold('║')}\n`;
    content += `${bold('║')}  ${fg(COLORS.muted)(truncate(item.reason, 58))}  ${bold('║')}\n`;

    // Similar objects (if any)
    if (item.similarObjects && item.similarObjects.length > 0) {
      content += `${bold('╠══════════════════════════════════════════════════════════════╣')}\n`;
      content += `${bold('║')}  ${bold('Similar Memories:')}                                          ${bold('║')}\n`;
      for (const sim of item.similarObjects.slice(0, 2)) {
        const simContent = truncate(sim.content, 55);
        content += `${bold('║')}  ${fg(COLORS.muted)('*')} ${simContent.padEnd(58)}${bold('║')}\n`;
      }
    }

    content += `${bold('╠══════════════════════════════════════════════════════════════╣')}\n`;

    // Actions
    content += `${bold('║')}  ${bold('Actions:')}                                                    ${bold('║')}\n`;
    content += `${bold('║')}                                                              ${bold('║')}\n`;
    content += `${bold('║')}  ${fg(COLORS.success)('[A]')} Approve   ${fg(COLORS.primary)('[E]')} Edit   ${fg(COLORS.warning)('[M]')} Merge                  ${bold('║')}\n`;
    content += `${bold('║')}  ${fg(COLORS.error)('[R]')} Reject    ${fg(COLORS.muted)('[K]')} Skip   ${fg(COLORS.muted)('[S]')} Supersede              ${bold('║')}\n`;
    content += `${bold('║')}                                                              ${bold('║')}\n`;
    content += `${bold('╚══════════════════════════════════════════════════════════════╝')}\n`;
  }

  // Navigation help
  content += `\n${fg(COLORS.muted)('[</>] Navigate  [Esc] Close')}`;

  if (inputText) {
    inputText.content = t`${content}`;
  }
}

/**
 * Get color for suggested action
 */
function getActionColor(action: string): string {
  switch (action) {
    case 'approve':
      return COLORS.success;
    case 'reject':
      return COLORS.error;
    case 'edit':
      return COLORS.primary;
    case 'merge':
    case 'supersede':
      return COLORS.warning;
    case 'skip':
    default:
      return COLORS.muted;
  }
}

/**
 * Wrap text to fit within width
 */
function wrapText(text: string, width: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if ((currentLine + ' ' + word).trim().length <= width) {
      currentLine = (currentLine + ' ' + word).trim();
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word.slice(0, width);
    }
  }
  if (currentLine) lines.push(currentLine);

  return lines;
}

/**
 * Update help text for review mode
 */
function updateReviewHelpText(): void {
  if (helpText) {
    helpText.content = t`${fg(COLORS.muted)('[A]pprove [E]dit [M]erge [R]eject [K]ip [S]upersede | [</>] Nav [Esc] Close')}`;
  }
}

/**
 * Handle review mode input
 */
export async function handleReviewInput(key: KeyEvent): Promise<void> {
  if (key.name === 'escape') {
    exitReviewMode();
    return;
  }

  if (items.length === 0) return;

  // Navigation
  if (key.name === 'left' || key.name === 'h') {
    selectedIndex = Math.max(0, selectedIndex - 1);
    updateReviewPanel();
    return;
  }

  if (key.name === 'right' || key.name === 'l') {
    selectedIndex = Math.min(items.length - 1, selectedIndex + 1);
    updateReviewPanel();
    return;
  }

  const item = items[selectedIndex];
  if (!item) return;

  // Actions
  let action: ReviewAction | null = null;
  let feedback = '';

  switch (key.name) {
    case 'a':
      action = 'approve';
      feedback = 'Memory approved';
      break;
    case 'r':
      action = 'reject';
      feedback = 'Memory rejected';
      break;
    case 'k':
      action = 'skip';
      feedback = 'Skipped';
      break;
    case 'e':
      if (onShowFeedback) onShowFeedback('Edit mode not yet implemented');
      return;
    case 'm':
      action = 'merge';
      feedback = 'Memories merged';
      break;
    case 's':
      action = 'supersede';
      feedback = 'Memory superseded';
      break;
  }

  if (action) {
    const success = await reviewService.processAction(item.object.id, action);

    if (success) {
      if (onShowFeedback) onShowFeedback(feedback);

      // Reload queue
      await loadReviewData();

      // Adjust index if needed
      if (items.length > 0 && selectedIndex >= items.length) {
        selectedIndex = items.length - 1;
      }

      updateReviewPanel();
    } else {
      if (onShowFeedback) onShowFeedback('Action failed');
    }
  }
}

/**
 * Exit review mode
 */
function exitReviewMode(): void {
  if (inputPanel) {
    inputPanel.visible = false;
  }
  if (onExitMode) onExitMode();
}
