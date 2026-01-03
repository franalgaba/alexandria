/**
 * Debug View
 *
 * Live debug console showing agent activity, events, and memory operations.
 * Toggled with Shift+D key.
 */

import type { MouseEvent, ScrollBoxRenderable, TextRenderable } from '@opentui/core';
import { fg, t } from '@opentui/core';
import { EventStore } from '../../stores/events.ts';
import { MemoryObjectStore } from '../../stores/memory-objects.ts';

// Debug log categories
export type DebugLogType =
  | 'recv_prompt'
  | 'recv_response'
  | 'recv_tool'
  | 'inject_context'
  | 'inject_memory'
  | 'store_memory'
  | 'store_pending'
  | 'info';

export interface DebugLogEntry {
  timestamp: Date;
  type: DebugLogType;
  message: string;
  details?: string;
}

// Module state
let currentProject: string | null = null;
let debugPanel: ScrollBoxRenderable | null = null;
let debugText: TextRenderable | null = null;

// Debug console state
let debugConsoleVisible = true;
let debugLogs: DebugLogEntry[] = [];
const MAX_DEBUG_LOGS = 100;
let lastSeenEventId: string | null = null;
let lastSeenMemoryCount = 0;
let debugRefreshInterval: ReturnType<typeof setInterval> | null = null;
const DEBUG_REFRESH_INTERVAL_MS = 500;

// Debug panel resize state
let debugPanelHeightPercent = 20;
const DEBUG_PANEL_MIN_HEIGHT = 8;
const DEBUG_PANEL_MAX_HEIGHT = 60;
let isResizingDebugPanel = false;
let lastMouseY = 0;

// Type abbreviations for memory logging
const TYPE_ABBREV: Record<string, string> = {
  decision: 'DEC',
  constraint: 'CON',
  convention: 'CNV',
  known_fix: 'FIX',
  failed_attempt: 'FAL',
  preference: 'PRF',
  environment: 'ENV',
};

// Callbacks
let onShowFeedback: ((msg: string) => void) | null = null;
let onUpdatePanelLayout: (() => void) | null = null;
let onUpdateHelpText: (() => void) | null = null;
let getInputMode: (() => string) | null = null;

/**
 * Initialize view with TUI elements
 */
export function initDebugView(options: {
  project: string | null;
  debugPanelRef: ScrollBoxRenderable;
  debugTextRef: TextRenderable;
  showFeedbackCallback: (msg: string) => void;
  updatePanelLayoutCallback: () => void;
  updateHelpTextCallback: () => void;
  getInputModeCallback: () => string;
}): void {
  currentProject = options.project;
  debugPanel = options.debugPanelRef;
  debugText = options.debugTextRef;
  onShowFeedback = options.showFeedbackCallback;
  onUpdatePanelLayout = options.updatePanelLayoutCallback;
  onUpdateHelpText = options.updateHelpTextCallback;
  getInputMode = options.getInputModeCallback;
}

/**
 * Update project reference
 */
export function setDebugViewProject(project: string | null): void {
  currentProject = project;
}

/**
 * Check if debug console is visible
 */
export function isDebugConsoleVisible(): boolean {
  return debugConsoleVisible;
}

/**
 * Get debug panel height percentage
 */
export function getDebugPanelHeightPercent(): number {
  return debugPanelHeightPercent;
}

/**
 * Add a debug log entry
 */
export function addDebugLog(type: DebugLogType, message: string, details?: string): void {
  debugLogs.push({
    timestamp: new Date(),
    type,
    message: message.slice(0, 200),
    details: details?.slice(0, 500),
  });

  // Keep bounded
  if (debugLogs.length > MAX_DEBUG_LOGS) {
    debugLogs = debugLogs.slice(-MAX_DEBUG_LOGS);
  }

  updateDebugPanel();
}

/**
 * Get debug type label with icon and color
 */
function getDebugTypeLabel(type: DebugLogType): { icon: string; label: string; color: string } {
  switch (type) {
    case 'recv_prompt':
      return { icon: '\u25bc', label: 'RECV', color: '#7ee787' };
    case 'recv_response':
      return { icon: '\u25bc', label: 'RECV', color: '#d2a8ff' };
    case 'recv_tool':
      return { icon: '\u25bc', label: 'RECV', color: '#ffa657' };
    case 'inject_context':
      return { icon: '\u25b2', label: 'INJECT', color: '#58a6ff' };
    case 'inject_memory':
      return { icon: '\u25b2', label: 'INJECT', color: '#79c0ff' };
    case 'store_memory':
      return { icon: '\u2605', label: 'STORE', color: '#3fb950' };
    case 'store_pending':
      return { icon: '\u2605', label: 'STORE', color: '#d29922' };
    case 'info':
      return { icon: '\u2022', label: 'INFO', color: '#6e7681' };
    default:
      return { icon: ' ', label: '???', color: '#c9d1d9' };
  }
}

/**
 * Update debug panel content
 */
export function updateDebugPanel(): void {
  if (!debugText || !debugPanel) return;

  const terminalWidth = process.stdout.columns || 80;
  const contentWidth = terminalWidth - 4;

  if (debugLogs.length === 0) {
    debugText.content = t`${fg('#6e7681')('Waiting for agent activity...')}

${fg('#6e7681')('\u25bc RECV   = Data received from coding agent')}
${fg('#6e7681')('\u25b2 INJECT = Context sent back to agent')}
${fg('#6e7681')('\u2605 STORE  = Memory saved to database')}`;
    return;
  }

  const lines: string[] = [];
  const visibleLogs = debugLogs.slice(-15);

  for (const log of visibleLogs) {
    const time = log.timestamp.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const { icon, label } = getDebugTypeLabel(log.type);

    const prefix = `[${time}] ${icon} ${label.padEnd(6)} `;
    const messageMaxLen = contentWidth - prefix.length;
    const message =
      log.message.length > messageMaxLen
        ? log.message.slice(0, messageMaxLen - 3) + '...'
        : log.message;

    lines.push(`${prefix}${message}`);

    if (log.details) {
      const detailIndent = '                  ';
      const detailMaxLen = contentWidth - detailIndent.length - 2;
      const detailPreview = log.details.slice(0, detailMaxLen).replace(/\n/g, ' ');
      lines.push(
        `${detailIndent}"${detailPreview}${log.details.length > detailMaxLen ? '...' : ''}"`,
      );
    }
  }

  debugText.content = lines.join('\n');
}

/**
 * Check for new events and memories
 */
export function checkForNewEvents(): void {
  const inputMode = getInputMode ? getInputMode() : 'normal';
  if (!currentProject || inputMode !== 'normal') return;

  try {
    const { Database } = require('bun:sqlite');
    const db = new Database(currentProject);

    // Check for new events
    const eventStore = new EventStore(db);
    const recentEvents = eventStore.getRecent(10);

    if (recentEvents.length > 0) {
      const latestEvent = recentEvents[0];

      if (lastSeenEventId !== latestEvent.id) {
        const newEvents = [];
        for (const event of recentEvents) {
          if (event.id === lastSeenEventId) break;
          newEvents.push(event);
        }

        for (const event of newEvents.reverse()) {
          const eventType = event.eventType;
          const content = eventStore.getContent(event) || '(no content)';
          const preview = content.slice(0, 100).replace(/\n/g, ' ');

          if (eventType === 'user_prompt' || content.startsWith('[user]:')) {
            addDebugLog('recv_prompt', 'user prompt', preview);
          } else if (eventType === 'assistant_response' || content.startsWith('[assistant]:')) {
            addDebugLog('recv_response', 'assistant response', preview);
          } else if (eventType === 'tool_call') {
            addDebugLog('recv_tool', `tool call \u2192 ${event.toolName || 'unknown'}`, preview);
          } else if (eventType === 'tool_output') {
            const exitInfo =
              event.exitCode !== undefined && event.exitCode !== 0
                ? ` [exit:${event.exitCode}]`
                : '';
            addDebugLog(
              'recv_tool',
              `tool result \u2190 ${event.toolName || 'unknown'}${exitInfo}`,
              preview,
            );
          } else if (eventType === 'context_injection' || eventType === 'context_pack') {
            addDebugLog('inject_context', 'context pack sent to agent', preview);
          } else if (eventType === 'memory_injection') {
            addDebugLog('inject_memory', 'memories sent to agent', preview);
          } else {
            addDebugLog('recv_tool', `${eventType}`, preview);
          }
        }
        lastSeenEventId = latestEvent.id;
      }
    }

    // Check for new memories
    const memoryStore = new MemoryObjectStore(db);
    const allMemories = memoryStore.list({ limit: 1000 });
    const currentMemoryCount = allMemories.length;

    if (currentMemoryCount > lastSeenMemoryCount) {
      const newCount = currentMemoryCount - lastSeenMemoryCount;
      const recentMemories = allMemories.slice(0, newCount);

      for (const memory of recentMemories.reverse()) {
        const typeAbbrev = TYPE_ABBREV[memory.objectType] || '???';
        const typeName = memory.objectType.replace('_', ' ');

        if (memory.reviewStatus === 'approved') {
          addDebugLog(
            'store_memory',
            `[${typeAbbrev}] ${typeName} (approved)`,
            memory.content.slice(0, 100),
          );
        } else {
          addDebugLog(
            'store_pending',
            `[${typeAbbrev}] ${typeName} (pending review)`,
            memory.content.slice(0, 100),
          );
        }
      }

      lastSeenMemoryCount = currentMemoryCount;
    }

    db.close();
  } catch {
    // Silently ignore errors
  }
}

/**
 * Start debug refresh interval
 */
export function startDebugRefresh(): void {
  if (debugRefreshInterval) return;
  debugRefreshInterval = setInterval(checkForNewEvents, DEBUG_REFRESH_INTERVAL_MS);
}

/**
 * Stop debug refresh interval
 */
export function stopDebugRefresh(): void {
  if (debugRefreshInterval) {
    clearInterval(debugRefreshInterval);
    debugRefreshInterval = null;
  }
}

/**
 * Toggle debug console visibility
 */
export function toggleDebugConsole(): void {
  debugConsoleVisible = !debugConsoleVisible;
  if (debugPanel) {
    debugPanel.visible = debugConsoleVisible;
  }

  if (onUpdatePanelLayout) onUpdatePanelLayout();
  if (onUpdateHelpText) onUpdateHelpText();
  if (onShowFeedback) {
    onShowFeedback(
      debugConsoleVisible
        ? 'Debug console shown [drag top border to resize]'
        : 'Debug console hidden',
    );
  }
}

/**
 * Get debug panel top row position
 */
export function getDebugPanelTopRow(): number {
  const terminalHeight = process.stdout.rows || 24;
  const debugHeightRows = Math.floor((terminalHeight * debugPanelHeightPercent) / 100);
  return terminalHeight - 3 - debugHeightRows;
}

/**
 * Resize debug panel by delta percentage
 */
export function resizeDebugPanel(delta: number): void {
  const newHeight = debugPanelHeightPercent + delta;
  if (newHeight >= DEBUG_PANEL_MIN_HEIGHT && newHeight <= DEBUG_PANEL_MAX_HEIGHT) {
    debugPanelHeightPercent = newHeight;
    if (onUpdatePanelLayout) onUpdatePanelLayout();
  }
}

/**
 * Start debug panel resize drag
 */
export function startDebugPanelResize(y: number): void {
  isResizingDebugPanel = true;
  lastMouseY = y;

  if (debugPanel) {
    debugPanel.borderColor = '#58a6ff';
    debugPanel.title = 'Live Debug Console [resizing... release to finish]';
  }
}

/**
 * End debug panel resize drag
 */
export function endDebugPanelResize(): void {
  if (!isResizingDebugPanel) return;
  isResizingDebugPanel = false;

  if (debugPanel) {
    debugPanel.borderColor = '#30363d';
    debugPanel.title = 'Live Debug Console [+/- to resize, Shift+D to hide]';
  }
}

/**
 * Check if currently resizing debug panel
 */
export function isResizingDebug(): boolean {
  return isResizingDebugPanel;
}

/**
 * Handle debug panel drag
 */
export function handleDebugPanelDrag(y: number): void {
  if (!isResizingDebugPanel) return;

  const terminalHeight = process.stdout.rows || 24;
  const deltaY = lastMouseY - y;

  if (deltaY !== 0) {
    const deltaPercent = (deltaY / terminalHeight) * 100;
    const newHeight = debugPanelHeightPercent + deltaPercent;

    if (newHeight >= DEBUG_PANEL_MIN_HEIGHT && newHeight <= DEBUG_PANEL_MAX_HEIGHT) {
      debugPanelHeightPercent = Math.round(newHeight);
      if (onUpdatePanelLayout) onUpdatePanelLayout();
    }
    lastMouseY = y;
  }
}

/**
 * Initialize debug tracking for a project
 */
export function initializeDebugTracking(dbPath: string): void {
  try {
    const { Database } = require('bun:sqlite');
    const db = new Database(dbPath);

    const eventStore = new EventStore(db);
    const recentEvents = eventStore.getRecent(1);
    if (recentEvents.length > 0) {
      lastSeenEventId = recentEvents[0].id;
    } else {
      lastSeenEventId = null;
    }

    const memoryStore = new MemoryObjectStore(db);
    lastSeenMemoryCount = memoryStore.list({ limit: 1000 }).length;

    db.close();

    addDebugLog('info', `Connected to project: ${dbPath.split('/').pop()}`);
  } catch (error) {
    addDebugLog('info', `Failed to initialize tracking: ${error}`);
  }
}
