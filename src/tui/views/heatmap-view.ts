/**
 * Heatmap View
 *
 * View access heatmap showing most frequently accessed memories.
 * Activated with 'H' key (Shift+H).
 */

import type { KeyEvent, ScrollBoxRenderable, TextRenderable } from '@opentui/core';
import { bold, fg, t } from '@opentui/core';
import { AccessHeatmap, type HeatmapEntry } from '../../retriever/heatmap.ts';
import { getConnection } from '../../stores/connection.ts';

// Module state
let currentProject: string | null = null;
let heatmapPanel: ScrollBoxRenderable | null = null;
let heatmapHeaderText: TextRenderable | null = null;
let heatmapListText: TextRenderable | null = null;
let heatmapStatsText: TextRenderable | null = null;

// Heatmap data
let heatmapEntries: HeatmapEntry[] = [];
let selectedIndex = 0;

// Callbacks
let onExitMode: (() => void) | null = null;
let onShowFeedback: ((msg: string) => void) | null = null;
let onHideOtherPanels: (() => void) | null = null;

/**
 * Initialize view with TUI elements
 */
export function initHeatmapView(options: {
  project: string | null;
  heatmapPanelRef: ScrollBoxRenderable;
  heatmapHeaderTextRef: TextRenderable;
  heatmapListTextRef: TextRenderable;
  heatmapStatsTextRef: TextRenderable;
  exitModeCallback: () => void;
  showFeedbackCallback: (msg: string) => void;
  hideOtherPanelsCallback: () => void;
}): void {
  currentProject = options.project;
  heatmapPanel = options.heatmapPanelRef;
  heatmapHeaderText = options.heatmapHeaderTextRef;
  heatmapListText = options.heatmapListTextRef;
  heatmapStatsText = options.heatmapStatsTextRef;
  onExitMode = options.exitModeCallback;
  onShowFeedback = options.showFeedbackCallback;
  onHideOtherPanels = options.hideOtherPanelsCallback;
}

/**
 * Update project reference
 */
export function setHeatmapViewProject(project: string | null): void {
  currentProject = project;
}

/**
 * Enter heatmap mode
 */
export function enterHeatmapMode(): void {
  loadHeatmap();
  showHeatmapPanel();
}

/**
 * Show heatmap panel (hide others)
 */
function showHeatmapPanel(): void {
  if (onHideOtherPanels) onHideOtherPanels();
  if (heatmapPanel) {
    heatmapPanel.visible = true;
  }
}

/**
 * Get flame emoji based on heat score
 */
function getFlameEmoji(score: number, maxScore: number): string {
  const ratio = maxScore > 0 ? score / maxScore : 0;
  if (ratio >= 0.8) return '\u{1F525}\u{1F525}\u{1F525}';
  if (ratio >= 0.5) return '\u{1F525}\u{1F525} ';
  if (ratio >= 0.3) return '\u{1F525}  ';
  return '   ';
}

/**
 * Get recency label
 */
function getRecencyLabel(lastAccessedAt?: Date): string {
  if (!lastAccessedAt) return 'never';

  const now = new Date();
  const diffMs = now.getTime() - lastAccessedAt.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 1) return 'today';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

/**
 * Load heatmap data
 */
export function loadHeatmap(): void {
  if (!heatmapHeaderText || !heatmapListText || !heatmapStatsText) {
    return;
  }

  if (!currentProject) {
    heatmapHeaderText.content = t`${fg('#ff6b6b')('No project selected')}`;
    heatmapListText.content = '';
    heatmapStatsText.content = '';
    return;
  }

  try {
    const db = getConnection(currentProject);
    const heatmap = new AccessHeatmap(db);

    // Get top 20 hot memories
    heatmapEntries = heatmap.getHotMemories({ limit: 20 });

    const maxScore = heatmapEntries.length > 0 ? heatmapEntries[0].heatScore : 0;

    // Header
    heatmapHeaderText.content = t`${bold(fg('#ff6b6b')('\u{1F525} ACCESS HEATMAP'))}

${fg('#8b949e')('Most frequently accessed memories prioritized at session start.')}
${fg('#8b949e')('Heat Score = Access Count × Recency Weight')}

`;

    // Heatmap list
    if (heatmapEntries.length === 0) {
      heatmapListText.content = t`${fg('#6e7681')('No memories have been accessed yet.')}

${fg('#6e7681')('Access counts increase when memories are:')}
${fg('#6e7681')('  - Retrieved via search')}
${fg('#6e7681')('  - Included in context packs')}
${fg('#6e7681')('  - Viewed in detail')}
`;
    } else {
      let listContent = `${'#'.padEnd(3)} ${'Heat'.padEnd(12)} ${'Count'.padEnd(6)} ${'Last'.padEnd(8)} ${'Type'.padEnd(10)} Content\n`;
      listContent += '─'.repeat(80) + '\n';

      heatmapEntries.forEach((entry, i) => {
        const flames = getFlameEmoji(entry.heatScore, maxScore);
        const recency = getRecencyLabel(entry.lastAccessedAt);
        const content =
          entry.content.length > 35 ? entry.content.slice(0, 32) + '...' : entry.content;
        const codeRef = entry.codeRefs.length > 0 ? ` [${entry.codeRefs[0]}]` : '';
        const isSelected = i === selectedIndex;
        const prefix = isSelected ? '>' : ' ';
        const line = `${prefix}${String(i + 1).padStart(2)} ${flames} ${String(entry.accessCount).padStart(4)}   ${recency.padEnd(8)} ${entry.objectType.padEnd(10)} ${content}${codeRef}`;

        if (isSelected) {
          listContent += fg('#58a6ff')(line) + '\n';
        } else {
          listContent += line + '\n';
        }
      });

      heatmapListText.content = t`${listContent}`;
    }

    // Stats
    const totalAccesses = heatmapEntries.reduce((sum, e) => sum + e.accessCount, 0);
    const avgScore =
      heatmapEntries.length > 0
        ? heatmapEntries.reduce((sum, e) => sum + e.heatScore, 0) / heatmapEntries.length
        : 0;

    // Type breakdown
    const typeBreakdown: Record<string, number> = {};
    for (const entry of heatmapEntries) {
      typeBreakdown[entry.objectType] = (typeBreakdown[entry.objectType] || 0) + 1;
    }
    const typeInfo = Object.entries(typeBreakdown)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `${type}: ${count}`)
      .join(', ');

    const statsContent = `
${bold(fg('#58a6ff')('STATISTICS'))}

├─ Memories shown:  ${String(heatmapEntries.length).padStart(5)}
├─ Total accesses:  ${String(totalAccesses).padStart(5)}
├─ Avg heat score:  ${avgScore.toFixed(1).padStart(5)}
└─ Types: ${typeInfo || 'none'}

${fg('#6e7681')('Recency Weights: today=1.0, week=0.7, month=0.4, older=0.2')}

${fg('#666666')('[R] Refresh  [Enter] View detail  [Esc] Close')}`;

    heatmapStatsText.content = t`${statsContent}`;
  } catch (error) {
    if (heatmapHeaderText) {
      heatmapHeaderText.content = t`${fg('#ff6b6b')(`Error loading heatmap: ${error}`)}`;
    }
    if (heatmapListText) heatmapListText.content = '';
    if (heatmapStatsText) heatmapStatsText.content = '';
  }
}

/**
 * Update heatmap panel
 */
export function updateHeatmapPanel(): void {
  // Re-render with current selection
  loadHeatmap();
}

/**
 * Handle heatmap mode input
 */
export function handleHeatmapInput(key: KeyEvent): void {
  if (key.name === 'escape') {
    exitHeatmapMode();
    return;
  }

  if (key.name === 'r') {
    loadHeatmap();
    if (onShowFeedback) onShowFeedback('Heatmap refreshed');
    return;
  }

  if (key.name === 'up') {
    if (selectedIndex > 0) {
      selectedIndex--;
      updateHeatmapPanel();
    }
    return;
  }

  if (key.name === 'down') {
    if (selectedIndex < heatmapEntries.length - 1) {
      selectedIndex++;
      updateHeatmapPanel();
    }
    return;
  }

  if (key.name === 'return' && heatmapEntries.length > 0) {
    const entry = heatmapEntries[selectedIndex];
    if (onShowFeedback) {
      onShowFeedback(`Memory: ${entry.memoryId} (${entry.accessCount} accesses)`);
    }
    return;
  }
}

/**
 * Exit heatmap mode
 */
function exitHeatmapMode(): void {
  if (heatmapPanel) {
    heatmapPanel.visible = false;
  }
  selectedIndex = 0;
  if (onExitMode) onExitMode();
}

/**
 * Get current heatmap entries
 */
export function getHeatmapEntries(): HeatmapEntry[] {
  return heatmapEntries;
}
