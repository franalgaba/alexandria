/**
 * Conflicts View
 *
 * Resolve memory conflicts with visual comparison.
 * Activated with 'c' key.
 */

import type { KeyEvent, ScrollBoxRenderable, TextRenderable } from '@opentui/core';
import { bold, fg, t } from '@opentui/core';
import { type Conflict, ConflictDetector } from '../../ingestor/conflict-detector.ts';
import { getConnection } from '../../stores/connection.ts';

// Module state
let currentProject: string | null = null;
let inputPanel: ScrollBoxRenderable | null = null;
let inputText: TextRenderable | null = null;

// Conflicts mode state
let pendingConflicts: Conflict[] = [];
let conflictSelectedIndex = 0;

// Callbacks
let onExitMode: (() => void) | null = null;
let onShowFeedback: ((msg: string) => void) | null = null;
let onRefreshMemories: (() => void) | null = null;
let onAddDebugLog: ((type: string, message: string) => void) | null = null;

/**
 * Initialize view with TUI elements
 */
export function initConflictsView(options: {
  project: string | null;
  inputPanelRef: ScrollBoxRenderable;
  inputTextRef: TextRenderable;
  exitModeCallback: () => void;
  showFeedbackCallback: (msg: string) => void;
  refreshMemoriesCallback: () => void;
  addDebugLogCallback: (type: string, message: string) => void;
}): void {
  currentProject = options.project;
  inputPanel = options.inputPanelRef;
  inputText = options.inputTextRef;
  onExitMode = options.exitModeCallback;
  onShowFeedback = options.showFeedbackCallback;
  onRefreshMemories = options.refreshMemoriesCallback;
  onAddDebugLog = options.addDebugLogCallback;
}

/**
 * Update project reference
 */
export function setConflictsViewProject(project: string | null): void {
  currentProject = project;
}

/**
 * Enter conflicts mode
 */
export function enterConflictsMode(): void {
  conflictSelectedIndex = 0;
  loadConflicts();
  showConflictsPanel();
  updateConflictsPanel();
}

/**
 * Show conflicts panel
 */
function showConflictsPanel(): void {
  if (inputPanel) {
    inputPanel.visible = true;
  }
}

/**
 * Load conflicts from database
 */
export function loadConflicts(): void {
  if (!currentProject) {
    pendingConflicts = [];
    return;
  }

  try {
    const db = getConnection(currentProject);
    const detector = new ConflictDetector(db);
    pendingConflicts = detector.getPendingConflicts();
  } catch (error) {
    pendingConflicts = [];
    if (onAddDebugLog) onAddDebugLog('info', `Failed to load conflicts: ${error}`);
  }
}

/**
 * Get pending conflicts count
 */
export function getPendingConflictsCount(): number {
  return pendingConflicts.length;
}

/**
 * Update conflicts panel content
 */
export function updateConflictsPanel(): void {
  if (!inputText) return;

  if (pendingConflicts.length === 0) {
    inputText.content = t`
${bold('No Pending Conflicts')}

${fg('#888888')('All memory conflicts have been resolved.')}

${fg('#666666')('[Esc] to close')}
`;
    return;
  }

  const conflict = pendingConflicts[conflictSelectedIndex];
  const severityColor =
    conflict.severity === 'high'
      ? '#ff6b6b'
      : conflict.severity === 'medium'
        ? '#ffd93d'
        : '#6bff6b';
  const severityEmoji =
    conflict.severity === 'high' ? '🔴' : conflict.severity === 'medium' ? '🟡' : '🟢';

  inputText.content = t`
${bold('Pending Conflicts')} (${conflictSelectedIndex + 1}/${pendingConflicts.length})

${severityEmoji} ${fg(severityColor)(conflict.type.toUpperCase())} - ${conflict.severity}
${fg('#888888')(conflict.description)}

${bold('New Candidate:')}
${fg('#58a6ff')(conflict.newCandidate.content.slice(0, 200))}...

${bold('Existing Memory:')}
${fg('#ffa500')(conflict.existingMemories[0]?.content.slice(0, 200) || 'None')}...

${bold('Suggested Resolution:')} ${conflict.suggestedResolution}

${fg('#666666')('[1] Keep Existing  [2] Replace  [3] Keep Both  [4] Reject Both')}
${fg('#666666')('[←/→] Navigate conflicts  [Esc] Close')}
`;
}

/**
 * Handle conflicts mode input
 */
export async function handleConflictsInput(key: KeyEvent): Promise<void> {
  if (key.name === 'escape') {
    exitConflictsMode();
    return;
  }

  if (key.name === 'left' && pendingConflicts.length > 0) {
    conflictSelectedIndex = Math.max(0, conflictSelectedIndex - 1);
    updateConflictsPanel();
  } else if (key.name === 'right' && pendingConflicts.length > 0) {
    conflictSelectedIndex = Math.min(pendingConflicts.length - 1, conflictSelectedIndex + 1);
    updateConflictsPanel();
  } else if (key.sequence === '1') {
    await resolveCurrentConflict('keep_existing');
  } else if (key.sequence === '2') {
    await resolveCurrentConflict('replace');
  } else if (key.sequence === '3') {
    await resolveCurrentConflict('keep_both');
  } else if (key.sequence === '4') {
    await resolveCurrentConflict('reject_both');
  }
}

/**
 * Resolve the current conflict
 */
async function resolveCurrentConflict(
  option: 'keep_existing' | 'replace' | 'keep_both' | 'reject_both',
): Promise<void> {
  if (!currentProject || pendingConflicts.length === 0) return;

  const conflict = pendingConflicts[conflictSelectedIndex];

  try {
    const db = getConnection(currentProject);
    const detector = new ConflictDetector(db);

    detector.resolveConflict(conflict.id, {
      option,
      resolvedBy: 'human',
      reason: `Resolved via TUI: ${option}`,
    });

    if (onShowFeedback) onShowFeedback(`Conflict resolved: ${option}`);
    if (onAddDebugLog) onAddDebugLog('info', `Conflict resolved: ${option}`);

    // Reload conflicts
    loadConflicts();

    if (pendingConflicts.length === 0) {
      exitConflictsMode();
      // Refresh memories as they may have changed
      if (onRefreshMemories) onRefreshMemories();
    } else {
      conflictSelectedIndex = Math.min(conflictSelectedIndex, pendingConflicts.length - 1);
      updateConflictsPanel();
    }
  } catch (error) {
    if (onShowFeedback) onShowFeedback(`Error: ${error}`);
  }
}

/**
 * Exit conflicts mode
 */
function exitConflictsMode(): void {
  if (inputPanel) {
    inputPanel.visible = false;
  }
  if (onExitMode) onExitMode();
}
