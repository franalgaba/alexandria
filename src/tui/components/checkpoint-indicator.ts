/**
 * Checkpoint Progress Indicator Component
 *
 * Shows checkpoint progress in the status bar:
 * - Events buffered (X/10)
 * - Time since last checkpoint
 * - Extraction status
 */

import { fg } from '@opentui/core';
import { getConnection } from '../../stores/connection.ts';
import { SessionStore } from '../../stores/sessions.ts';
import { state } from '../state/index.ts';
import { COLORS, DEFAULT_CHECKPOINT_THRESHOLD } from '../utils/constants.ts';
import { formatDuration } from '../utils/formatters.ts';
import { miniProgressBar } from './progress-bar.ts';

export interface CheckpointIndicatorData {
  eventsSinceCheckpoint: number;
  threshold: number;
  timeSinceLastCheckpoint: number;
  isExtracting: boolean;
}

/**
 * Get current checkpoint status from the database
 */
export function getCheckpointData(): CheckpointIndicatorData | null {
  if (!state.currentProject) return null;

  try {
    const db = getConnection(state.currentProject);
    const sessionStore = new SessionStore(db);
    const currentSession = sessionStore.getCurrent();

    if (!currentSession) return null;

    const threshold = parseInt(
      process.env.ALEXANDRIA_AUTO_CHECKPOINT_THRESHOLD || String(DEFAULT_CHECKPOINT_THRESHOLD),
    );

    const lastCheckpoint = currentSession.lastCheckpointAt
      ? new Date(currentSession.lastCheckpointAt)
      : null;

    const timeSince = lastCheckpoint ? Date.now() - lastCheckpoint.getTime() : 0;

    return {
      eventsSinceCheckpoint: currentSession.eventsSinceCheckpoint || 0,
      threshold,
      timeSinceLastCheckpoint: timeSince,
      isExtracting: false, // TODO: Track extraction state
    };
  } catch {
    return null;
  }
}

/**
 * Render checkpoint indicator for status bar
 *
 * Format: [5/10 ####------] 2m
 */
export function renderCheckpointIndicator(): string {
  const data = getCheckpointData();
  if (!data) return '';

  const { eventsSinceCheckpoint, threshold, timeSinceLastCheckpoint, isExtracting } = data;

  // Progress bar
  const progress = miniProgressBar(eventsSinceCheckpoint, threshold, 8);

  // Time since last checkpoint
  const timeStr = timeSinceLastCheckpoint > 0 ? formatDuration(timeSinceLastCheckpoint) : '-';

  // Extraction indicator
  if (isExtracting) {
    return String(fg(COLORS.highlight)(`[Extracting...] ${progress}`));
  }

  // Color based on how close we are to checkpoint
  const percent = (eventsSinceCheckpoint / threshold) * 100;
  let color = COLORS.muted;
  if (percent >= 90) {
    color = COLORS.warning;
  } else if (percent >= 70) {
    color = COLORS.primary;
  }

  return String(fg(color)(`${eventsSinceCheckpoint}/${threshold} ${progress} ${timeStr}`));
}

/**
 * Render detailed checkpoint status (for stats view)
 */
export function renderCheckpointDetails(): string {
  const data = getCheckpointData();
  if (!data) return 'No active session';

  const { eventsSinceCheckpoint, threshold, timeSinceLastCheckpoint, isExtracting } = data;

  const percent = Math.round((eventsSinceCheckpoint / threshold) * 100);
  const progressBar =
    '█'.repeat(Math.round(percent / 5)) + '░'.repeat(20 - Math.round(percent / 5));

  let status = 'Buffering events...';
  if (isExtracting) {
    status = 'Extracting memories with Haiku...';
  } else if (eventsSinceCheckpoint >= threshold) {
    status = 'Checkpoint ready to trigger';
  }

  const timeStr = timeSinceLastCheckpoint > 0 ? formatDuration(timeSinceLastCheckpoint) : 'never';

  return `
CHECKPOINT STATUS
─────────────────────────────────
Events:    ${eventsSinceCheckpoint}/${threshold} [${progressBar}] ${percent}%
Last:      ${timeStr} ago
Status:    ${status}
─────────────────────────────────
`;
}

/**
 * Update checkpoint status in app state
 */
export function updateCheckpointState(): void {
  const data = getCheckpointData();
  if (data) {
    state.checkpoint.eventsSinceCheckpoint = data.eventsSinceCheckpoint;
    state.checkpoint.checkpointThreshold = data.threshold;
    state.checkpoint.timeSinceLastCheckpoint = data.timeSinceLastCheckpoint;
    state.checkpoint.isExtracting = data.isExtracting;
  }
}
