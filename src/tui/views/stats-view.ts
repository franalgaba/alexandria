/**
 * Stats View
 *
 * Display quality metrics and health score.
 * Activated with 'q' key.
 */

import type { KeyEvent, ScrollBoxRenderable, TextRenderable } from '@opentui/core';
import { t } from '@opentui/core';
import { StalenessChecker } from '../../reviewer/staleness.ts';
import { getConnection } from '../../stores/connection.ts';
import { MemoryObjectStore } from '../../stores/memory-objects.ts';

// Quality metrics type
export type QualityMetrics = {
  healthScore: number;
  codeRefRate: number;
  approvedRate: number;
  staleness: { verified: number; needsReview: number; stale: number };
};

// Module state
let currentProject: string | null = null;
let inputPanel: ScrollBoxRenderable | null = null;
let inputText: TextRenderable | null = null;

// Stats mode state
let statsOutput = '';
let qualityMetrics: QualityMetrics | null = null;

// Callbacks
let onExitMode: (() => void) | null = null;

/**
 * Initialize view with TUI elements
 */
export function initStatsView(options: {
  project: string | null;
  inputPanelRef: ScrollBoxRenderable;
  inputTextRef: TextRenderable;
  exitModeCallback: () => void;
}): void {
  currentProject = options.project;
  inputPanel = options.inputPanelRef;
  inputText = options.inputTextRef;
  onExitMode = options.exitModeCallback;
}

/**
 * Update project reference
 */
export function setStatsViewProject(project: string | null): void {
  currentProject = project;
}

/**
 * Enter stats mode
 */
export function enterStatsMode(): void {
  loadStats();
  showStatsPanel();
  updateStatsPanel();
}

/**
 * Show stats panel
 */
function showStatsPanel(): void {
  if (inputPanel) {
    inputPanel.visible = true;
  }
}

/**
 * Load stats from database
 */
export function loadStats(): void {
  if (!currentProject) {
    statsOutput = 'No project selected';
    qualityMetrics = null;
    return;
  }

  try {
    const db = getConnection(currentProject);
    const memoryStore = new MemoryObjectStore(db);
    const stalenessChecker = new StalenessChecker(db);

    const activeMemories = memoryStore.list({ status: ['active'], limit: 10000 });
    const statusCounts = memoryStore.countByStatus();
    const stalenessSummary = stalenessChecker.getSummary();

    // Calculate metrics
    const total = activeMemories.length;
    const withCodeRefs = activeMemories.filter((m) => m.codeRefs && m.codeRefs.length > 0).length;
    const approved = activeMemories.filter((m) => m.reviewStatus === 'approved').length;
    const pending = activeMemories.filter((m) => m.reviewStatus === 'pending').length;

    // Tier counts
    const tierCounts = { grounded: 0, observed: 0, inferred: 0, hypothesis: 0 };
    for (const m of activeMemories) {
      const tier = m.confidenceTier || 'inferred';
      if (tier in tierCounts) tierCounts[tier as keyof typeof tierCounts]++;
    }

    // Calculate health score
    const codeRefRate = total > 0 ? withCodeRefs / total : 0;
    const approvedRate = total > 0 ? approved / total : 0;
    const goodTiers = tierCounts.grounded + tierCounts.observed;
    const tierRate = total > 0 ? goodTiers / total : 0;
    const healthScore = Math.round(codeRefRate * 30 + approvedRate * 25 + tierRate * 25 + 0.5 * 20);

    qualityMetrics = {
      healthScore,
      codeRefRate: codeRefRate * 100,
      approvedRate: approvedRate * 100,
      staleness: stalenessSummary,
    };

    const healthEmoji = healthScore >= 80 ? '🟢' : healthScore >= 60 ? '🟡' : '🔴';

    statsOutput = `
╔══════════════════════════════════════════════════════╗
║               ALEXANDRIA QUALITY METRICS             ║
╠══════════════════════════════════════════════════════╣
║  Health Score: ${healthEmoji} ${healthScore}/100                            ║
╠══════════════════════════════════════════════════════╣
║  MEMORY STATUS                                       ║
║  ├─ Active:     ${String(statusCounts.active).padStart(4)}                               ║
║  ├─ Stale:      ${String(statusCounts.stale).padStart(4)}                               ║
║  ├─ Superseded: ${String(statusCounts.superseded).padStart(4)}                               ║
║  └─ Retired:    ${String(statusCounts.retired).padStart(4)}                               ║
╠══════════════════════════════════════════════════════╣
║  CONFIDENCE TIERS                                    ║
║  ├─ ✅ Grounded:   ${String(tierCounts.grounded).padStart(4)}  (code-linked + verified)    ║
║  ├─ 👁 Observed:   ${String(tierCounts.observed).padStart(4)}  (approved or evidenced)     ║
║  ├─ 🤖 Inferred:   ${String(tierCounts.inferred).padStart(4)}  (AI-extracted)              ║
║  └─ ❓ Hypothesis: ${String(tierCounts.hypothesis).padStart(4)}  (unverified)               ║
╠══════════════════════════════════════════════════════╣
║  QUALITY INDICATORS                                  ║
║  ├─ Code-linked:  ${(codeRefRate * 100).toFixed(0).padStart(3)}%                             ║
║  ├─ Approved:     ${(approvedRate * 100).toFixed(0).padStart(3)}%                             ║
║  └─ Pending:      ${String(pending).padStart(4)}                               ║
╠══════════════════════════════════════════════════════╣
║  CODE FRESHNESS                                      ║
║  ├─ Verified:     ${String(stalenessSummary.verified).padStart(4)}                               ║
║  ├─ Needs Review: ${String(stalenessSummary.needsReview).padStart(4)}                               ║
║  └─ Stale:        ${String(stalenessSummary.stale).padStart(4)}                               ║
╚══════════════════════════════════════════════════════╝

Press [Esc] to close
`;
  } catch (error) {
    statsOutput = `Error loading stats: ${error}`;
    qualityMetrics = null;
  }
}

/**
 * Get current quality metrics
 */
export function getQualityMetrics(): QualityMetrics | null {
  return qualityMetrics;
}

/**
 * Update stats panel content
 */
export function updateStatsPanel(): void {
  if (!inputText) return;
  inputText.content = t`${statsOutput}`;
}

/**
 * Handle stats mode input
 */
export function handleStatsInput(key: KeyEvent): void {
  if (key.name === 'escape') {
    exitStatsMode();
    return;
  }
}

/**
 * Exit stats mode
 */
function exitStatsMode(): void {
  if (inputPanel) {
    inputPanel.visible = false;
  }
  if (onExitMode) onExitMode();
}
