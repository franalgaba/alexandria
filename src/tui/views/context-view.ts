/**
 * Context View
 *
 * View context injection levels, tier distribution, and health metrics.
 * Activated with 'x' key.
 */

import type { KeyEvent, ScrollBoxRenderable, TextRenderable } from '@opentui/core';
import { bold, fg, t } from '@opentui/core';
import { EscalationDetector } from '../../retriever/escalation.ts';
import { AccessHeatmap } from '../../retriever/heatmap.ts';
import { type ContextLevel, ProgressiveRetriever } from '../../retriever/progressive.ts';
import { getConnection } from '../../stores/connection.ts';
import { MemoryObjectStore } from '../../stores/memory-objects.ts';
import { SessionStore } from '../../stores/sessions.ts';
import type { QualityMetrics } from './stats-view.ts';

// Context injection tracking
export interface ContextInjection {
  timestamp: Date;
  level: ContextLevel | 'custom';
  tokensUsed: number;
  tokenBudget: number;
  memoriesIncluded: number;
  tierBreakdown: { grounded: number; observed: number; inferred: number };
  trigger: 'auto' | 'manual' | 'checkpoint';
}

// Context health metrics
export interface ContextHealthMetrics {
  avgTokensPerInjection: number;
  avgMemoriesPerInjection: number;
  injectionCount: number;
  groundedRatio: number;
  lastInjectionTime: Date | null;
}

// Module state
let currentProject: string | null = null;
let contextPanel: ScrollBoxRenderable | null = null;
let contextHeaderText: TextRenderable | null = null;
let contextLevelsText: TextRenderable | null = null;
let contextTiersText: TextRenderable | null = null;
let contextHealthText: TextRenderable | null = null;
let contextHistoryText: TextRenderable | null = null;

// Context tracking state
let contextHistory: ContextInjection[] = [];
let contextHealthMetrics: ContextHealthMetrics | null = null;

// External state getters
let getQualityMetrics: (() => QualityMetrics | null) | null = null;

// Callbacks
let onExitMode: (() => void) | null = null;
let onShowFeedback: ((msg: string) => void) | null = null;
let onHideOtherPanels: (() => void) | null = null;

/**
 * Initialize view with TUI elements
 */
export function initContextView(options: {
  project: string | null;
  contextPanelRef: ScrollBoxRenderable;
  contextHeaderTextRef: TextRenderable;
  contextLevelsTextRef: TextRenderable;
  contextTiersTextRef: TextRenderable;
  contextHealthTextRef: TextRenderable;
  contextHistoryTextRef: TextRenderable;
  exitModeCallback: () => void;
  showFeedbackCallback: (msg: string) => void;
  hideOtherPanelsCallback: () => void;
  getQualityMetricsCallback: () => QualityMetrics | null;
}): void {
  currentProject = options.project;
  contextPanel = options.contextPanelRef;
  contextHeaderText = options.contextHeaderTextRef;
  contextLevelsText = options.contextLevelsTextRef;
  contextTiersText = options.contextTiersTextRef;
  contextHealthText = options.contextHealthTextRef;
  contextHistoryText = options.contextHistoryTextRef;
  onExitMode = options.exitModeCallback;
  onShowFeedback = options.showFeedbackCallback;
  onHideOtherPanels = options.hideOtherPanelsCallback;
  getQualityMetrics = options.getQualityMetricsCallback;
}

/**
 * Update project reference
 */
export function setContextViewProject(project: string | null): void {
  currentProject = project;
}

/**
 * Enter context mode
 */
export function enterContextMode(): void {
  loadContextViewer();
  showContextPanel();
}

/**
 * Show context panel (hide others)
 */
function showContextPanel(): void {
  if (onHideOtherPanels) onHideOtherPanels();
  if (contextPanel) {
    contextPanel.visible = true;
  }
}

/**
 * Format relative time
 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Load context viewer data
 */
export async function loadContextViewer(): Promise<void> {
  if (
    !contextHeaderText ||
    !contextLevelsText ||
    !contextTiersText ||
    !contextHealthText ||
    !contextHistoryText
  ) {
    return;
  }

  if (!currentProject) {
    contextHeaderText.content = t`${fg('#ff6b6b')('No project selected')}`;
    contextLevelsText.content = '';
    contextTiersText.content = '';
    contextHealthText.content = '';
    contextHistoryText.content = '';
    return;
  }

  try {
    const db = getConnection(currentProject);
    const sessionStore = new SessionStore(db);
    const memoryStore = new MemoryObjectStore(db);
    const progressive = new ProgressiveRetriever(db);

    // Get recent sessions
    const sessions = sessionStore.list(5);
    const activeMemories = memoryStore.list({ status: ['active'], limit: 1000 });

    // Calculate what would be injected at each level
    const levels: { level: ContextLevel; tokens: number; memories: number }[] = [];
    for (const level of ['minimal', 'task', 'deep'] as ContextLevel[]) {
      try {
        const pack = await progressive.getContext(level, { tokenBudget: 1500 });
        levels.push({
          level,
          tokens: pack.metadata?.tokensUsed || 0,
          memories: pack.totalCount || 0,
        });
      } catch {
        levels.push({ level, tokens: 0, memories: 0 });
      }
    }

    // Get tier distribution of active memories
    const tierCounts = { grounded: 0, observed: 0, inferred: 0, hypothesis: 0 };
    for (const m of activeMemories) {
      const tier = m.confidenceTier || 'inferred';
      if (tier in tierCounts) tierCounts[tier as keyof typeof tierCounts]++;
    }

    // Calculate context health metrics
    const totalTokens = contextHistory.reduce((sum, c) => sum + c.tokensUsed, 0);
    const totalMemories = contextHistory.reduce((sum, c) => sum + c.memoriesIncluded, 0);
    const totalGrounded = contextHistory.reduce((sum, c) => sum + c.tierBreakdown.grounded, 0);
    const totalInjected = contextHistory.reduce(
      (sum, c) =>
        sum + c.tierBreakdown.grounded + c.tierBreakdown.observed + c.tierBreakdown.inferred,
      0,
    );

    contextHealthMetrics = {
      avgTokensPerInjection: contextHistory.length > 0 ? totalTokens / contextHistory.length : 0,
      avgMemoriesPerInjection:
        contextHistory.length > 0 ? totalMemories / contextHistory.length : 0,
      injectionCount: contextHistory.length,
      groundedRatio: totalInjected > 0 ? totalGrounded / totalInjected : 0,
      lastInjectionTime:
        contextHistory.length > 0 ? contextHistory[contextHistory.length - 1].timestamp : null,
    };

    // Build visualization helper
    const bar = (value: number, max: number, width: number = 20): string => {
      const filled = Math.min(Math.round((value / max) * width), width);
      return '█'.repeat(filled) + '░'.repeat(width - filled);
    };

    const qualityMetrics = getQualityMetrics ? getQualityMetrics() : null;
    const healthEmoji =
      qualityMetrics && qualityMetrics.healthScore >= 80
        ? '🟢'
        : qualityMetrics && qualityMetrics.healthScore >= 60
          ? '🟡'
          : '🔴';

    // Header section
    contextHeaderText.content = t`${bold(fg('#58a6ff')('CONTEXT INJECTION LEVELS'))}

`;

    // Levels table
    const levelsContent = `┌────────────┬─────────┬──────────┬──────────────────────┐
│ Level      │ Tokens  │ Memories │ Usage                │
├────────────┼─────────┼──────────┼──────────────────────┤
│ ${fg('#6bff6b')('minimal')}    │ ${String(levels[0]?.tokens || 0).padStart(5)}   │ ${String(levels[0]?.memories || 0).padStart(6)}   │ ${bar(levels[0]?.tokens || 0, 1500, 16)} │
│ ${fg('#ffd93d')('task')}       │ ${String(levels[1]?.tokens || 0).padStart(5)}   │ ${String(levels[1]?.memories || 0).padStart(6)}   │ ${bar(levels[1]?.tokens || 0, 1500, 16)} │
│ ${fg('#ff6b6b')('deep')}       │ ${String(levels[2]?.tokens || 0).padStart(5)}   │ ${String(levels[2]?.memories || 0).padStart(6)}   │ ${bar(levels[2]?.tokens || 0, 1500, 16)} │
└────────────┴─────────┴──────────┴──────────────────────┘

`;
    contextLevelsText.content = t`${levelsContent}`;

    // Tier distribution
    const total = activeMemories.length || 1;
    const tiersContent = `${bold(fg('#58a6ff')('MEMORY TIER DISTRIBUTION'))} (${activeMemories.length} active)

✅ Grounded:   ${bar(tierCounts.grounded, total, 20)} ${String(tierCounts.grounded).padStart(3)} (${((tierCounts.grounded / total) * 100).toFixed(0)}%)
👁  Observed:   ${bar(tierCounts.observed, total, 20)} ${String(tierCounts.observed).padStart(3)} (${((tierCounts.observed / total) * 100).toFixed(0)}%)
🤖 Inferred:   ${bar(tierCounts.inferred, total, 20)} ${String(tierCounts.inferred).padStart(3)} (${((tierCounts.inferred / total) * 100).toFixed(0)}%)
❓ Hypothesis: ${bar(tierCounts.hypothesis, total, 20)} ${String(tierCounts.hypothesis).padStart(3)} (${((tierCounts.hypothesis / total) * 100).toFixed(0)}%)

`;
    contextTiersText.content = t`${tiersContent}`;

    // Context health
    const healthContent = `${bold(fg('#58a6ff')('CONTEXT HEALTH'))} ${healthEmoji}

├─ Total injections:     ${String(contextHealthMetrics?.injectionCount || 0).padStart(5)}
├─ Avg tokens/injection: ${String(Math.round(contextHealthMetrics?.avgTokensPerInjection || 0)).padStart(5)}
├─ Avg memories/inject:  ${String(Math.round(contextHealthMetrics?.avgMemoriesPerInjection || 0)).padStart(5)}
└─ Grounded ratio:       ${((contextHealthMetrics?.groundedRatio || 0) * 100).toFixed(0).padStart(4)}%

`;
    contextHealthText.content = t`${healthContent}`;

    // Get hot memories from heatmap
    const heatmap = new AccessHeatmap(db);
    const hotMemories = heatmap.getHotMemories({ limit: 5 });

    // Get current session for escalation status
    const currentSession = sessionStore.getCurrent();
    let escalationStatus = '';
    if (currentSession) {
      const detector = new EscalationDetector(db);
      const signal = detector.analyze(currentSession);
      if (signal) {
        escalationStatus = `\u26a0\ufe0f  Escalation: ${signal.trigger} (${signal.reason})`;
      } else {
        escalationStatus = '\u2705 No escalation triggers active';
      }
    }

    // Hot memories section
    let historyContent = `${bold(fg('#ff6b6b')('\u{1F525} HOT MEMORIES'))} (prioritized at session start)

`;
    if (hotMemories.length === 0) {
      historyContent += `  ${fg('#6e7681')('No frequently accessed memories yet')}\n\n`;
    } else {
      hotMemories.forEach((m, i) => {
        const content = m.content.length > 40 ? m.content.slice(0, 37) + '...' : m.content;
        historyContent += `  ${i + 1}. ${fg('#ff6b6b')(`(${m.accessCount})`)} ${content}\n`;
      });
      historyContent += '\n';
    }

    // Escalation status
    historyContent += `${bold(fg('#58a6ff')('PROGRESSIVE DISCLOSURE'))}

  ${escalationStatus}
  Events since checkpoint: ${currentSession?.eventsSinceCheckpoint || 0}
  Error count: ${currentSession?.errorCount || 0}
  Disclosure level: ${currentSession?.disclosureLevel || 'task'}

`;

    // Recent sessions
    historyContent += `${bold(fg('#58a6ff')('RECENT SESSIONS'))}

`;
    if (sessions.length === 0) {
      historyContent += `  ${fg('#6e7681')('No sessions recorded')}\n\n`;
    } else {
      sessions.slice(0, 3).forEach((s, i) => {
        const age = formatRelativeTime(s.startedAt);
        const objects = s.objectsCreated || 0;
        historyContent += `  ${i + 1}. ${fg('#8b949e')((s.id || 'unknown').slice(0, 12).padEnd(12))} │ ${age.padEnd(10)} │ ${String(objects).padStart(2)} memories\n`;
      });
      historyContent += '\n';
    }

    historyContent += `${bold(fg('#58a6ff')('INJECTION HISTORY'))} (last 5)

`;
    if (contextHistory.length === 0) {
      historyContent += `  ${fg('#6e7681')('No injections recorded yet')}\n`;
    } else {
      contextHistory
        .slice(-5)
        .reverse()
        .forEach((c) => {
          const time = c.timestamp.toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
          });
          const tierInfo = `G:${c.tierBreakdown.grounded} O:${c.tierBreakdown.observed} I:${c.tierBreakdown.inferred}`;
          historyContent += `  ${fg('#8b949e')(time)} │ ${c.level.padEnd(7)} │ ${String(c.tokensUsed).padStart(4)}tok │ ${String(c.memoriesIncluded).padStart(2)}mem │ ${tierInfo}\n`;
        });
    }

    historyContent += `\n${fg('#666666')('[R] Refresh  [G] Generate pack  [H] Heatmap  [Esc] Close')}`;
    contextHistoryText.content = t`${historyContent}`;
  } catch (error) {
    if (contextHeaderText)
      contextHeaderText.content = t`${fg('#ff6b6b')(`Error loading context: ${error}`)}`;
    if (contextLevelsText) contextLevelsText.content = '';
    if (contextTiersText) contextTiersText.content = '';
    if (contextHealthText) contextHealthText.content = '';
    if (contextHistoryText) contextHistoryText.content = '';
  }
}

/**
 * Update context panel
 */
export function updateContextPanel(): void {
  // Native panel already updated via loadContextViewer
  // This function kept for compatibility with updateInputPanel pattern
}

/**
 * Track context injection
 */
export function trackContextInjection(
  level: ContextLevel | 'custom',
  tokensUsed: number,
  tokenBudget: number,
  memoriesIncluded: number,
  tierBreakdown: { grounded: number; observed: number; inferred: number },
  trigger: 'auto' | 'manual' | 'checkpoint' = 'manual',
): void {
  const injection: ContextInjection = {
    timestamp: new Date(),
    level,
    tokensUsed,
    tokenBudget,
    memoriesIncluded,
    tierBreakdown,
    trigger,
  };

  contextHistory.push(injection);

  // Keep last 50 injections
  if (contextHistory.length > 50) {
    contextHistory = contextHistory.slice(-50);
  }
}

/**
 * Get context history
 */
export function getContextHistory(): ContextInjection[] {
  return [...contextHistory];
}

/**
 * Get context health metrics
 */
export function getContextHealthMetrics(): ContextHealthMetrics | null {
  return contextHealthMetrics;
}

/**
 * Handle context mode input
 */
export async function handleContextInput(key: KeyEvent): Promise<void> {
  if (key.name === 'escape') {
    exitContextMode();
    return;
  }

  if (key.name === 'r') {
    await loadContextViewer();
    if (onShowFeedback) onShowFeedback('Context view refreshed');
    return;
  }

  if (key.name === 'g') {
    // Generate a pack and track it
    if (!currentProject) return;

    try {
      const db = getConnection(currentProject);
      const progressive = new ProgressiveRetriever(db);
      const pack = await progressive.getContext('task', { tokenBudget: 1500 });

      // Track the injection
      const tierBreakdown = pack.metadata?.breakdown || { grounded: 0, observed: 0, inferred: 0 };
      trackContextInjection(
        'task',
        pack.metadata?.tokensUsed || 0,
        pack.metadata?.tokenBudget || 1500,
        pack.totalCount || 0,
        tierBreakdown,
        'manual',
      );

      await loadContextViewer();
      if (onShowFeedback) {
        onShowFeedback(
          `Generated pack: ${pack.metadata?.tokensUsed || 0} tokens, ${pack.totalCount || 0} memories`,
        );
      }
    } catch (error) {
      if (onShowFeedback) onShowFeedback(`Error: ${error}`);
    }
    return;
  }
}

/**
 * Exit context mode
 */
function exitContextMode(): void {
  if (contextPanel) {
    contextPanel.visible = false;
  }
  if (onExitMode) onExitMode();
}
