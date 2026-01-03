/**
 * Costs View
 *
 * Display cost dashboard with token usage, budgets, and breakdowns.
 * Activated with '$' key.
 */

import type { KeyEvent, ScrollBoxRenderable, TextRenderable } from '@opentui/core';
import { bold, fg, t } from '@opentui/core';
import { getConnection } from '../../stores/connection.ts';
import type { UsageSummary } from '../../utils/cost-tracker.ts';
import { coloredProgressBar } from '../components/progress-bar.ts';
import { costService } from '../services/index.ts';
import type { BudgetStatus } from '../state/types.ts';
import { COLORS } from '../utils/constants.ts';
import { formatCost, formatTokens } from '../utils/formatters.ts';

// Module state (bridged from main TUI)
let currentProject: string | null = null;
let inputPanel: ScrollBoxRenderable | null = null;
let inputText: TextRenderable | null = null;
let helpText: TextRenderable | null = null;

// Costs mode state
let sessionSummary: UsageSummary | null = null;
let dailySummary: UsageSummary | null = null;
let budgetStatus: BudgetStatus | null = null;
let selectedView: 'overview' | 'breakdown' | 'history' = 'overview';

// Callbacks
let onExitMode: (() => void) | null = null;
let onShowFeedback: ((msg: string) => void) | null = null;

/**
 * Initialize view with TUI elements (called before entering mode)
 */
export function initCostsView(options: {
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
 * Enter costs mode
 */
export function enterCostsMode(): void {
  selectedView = 'overview';
  loadCostsData();
  showCostsPanel();
  updateCostsPanel();
  updateCostsHelpText();
}

/**
 * Load cost data from service
 */
export function loadCostsData(): void {
  if (!currentProject) return;

  try {
    const db = getConnection(currentProject);
    costService.initialize(db);

    sessionSummary = costService.getSessionSummary();
    dailySummary = costService.getDailySummary();
    budgetStatus = costService.getBudgetStatus();
  } catch (error) {
    // Silently fail - no cost data available
  }
}

/**
 * Show costs panel
 */
function showCostsPanel(): void {
  if (inputPanel) {
    inputPanel.visible = true;
  }
}

/**
 * Update costs panel content
 */
export function updateCostsPanel(): void {
  let content = '';

  // Header
  content += `${bold('╔══════════════════════════════════════════════════════════════╗')}\n`;
  content += `${bold('║')}                    ${bold('COST DASHBOARD')}                           ${bold('║')}\n`;
  content += `${bold('╠══════════════════════════════════════════════════════════════╣')}\n`;

  if (!sessionSummary && !dailySummary) {
    content += `${bold('║')}                                                              ${bold('║')}\n`;
    content += `${bold('║')}  No cost data available yet.                                ${bold('║')}\n`;
    content += `${bold('║')}  Haiku extraction will track costs automatically.           ${bold('║')}\n`;
    content += `${bold('║')}                                                              ${bold('║')}\n`;
    content += `${bold('╚══════════════════════════════════════════════════════════════╝')}\n`;
  } else {
    // Session summary
    content += `${bold('║')}  ${bold('SESSION USAGE')}                                              ${bold('║')}\n`;
    content += `${bold('║')}  ┌────────────────────┬────────────┬─────────────┐          ${bold('║')}\n`;
    content += `${bold('║')}  │ Metric             │ Value      │ Cost        │          ${bold('║')}\n`;
    content += `${bold('║')}  ├────────────────────┼────────────┼─────────────┤          ${bold('║')}\n`;

    if (sessionSummary) {
      const inputTok = formatTokens(sessionSummary.totalInputTokens).padStart(10);
      const outputTok = formatTokens(sessionSummary.totalOutputTokens).padStart(10);
      const totalCost = formatCost(sessionSummary.totalCost).padStart(11);

      content += `${bold('║')}  │ Input Tokens       │ ${inputTok} │             │          ${bold('║')}\n`;
      content += `${bold('║')}  │ Output Tokens      │ ${outputTok} │             │          ${bold('║')}\n`;
      content += `${bold('║')}  │ Total              │            │ ${totalCost} │          ${bold('║')}\n`;
    }

    content += `${bold('║')}  └────────────────────┴────────────┴─────────────┘          ${bold('║')}\n`;
    content += `${bold('╠══════════════════════════════════════════════════════════════╣')}\n`;

    // Budget status
    if (budgetStatus) {
      content += `${bold('║')}  ${bold('BUDGET STATUS')}                                              ${bold('║')}\n`;
      content += `${bold('║')}                                                              ${bold('║')}\n`;

      const sessionBar = coloredProgressBar(budgetStatus.session.used, budgetStatus.session.limit, {
        width: 25,
      });
      const dailyBar = coloredProgressBar(budgetStatus.daily.used, budgetStatus.daily.limit, {
        width: 25,
      });
      const tokenBar = coloredProgressBar(budgetStatus.tokens.used, budgetStatus.tokens.limit, {
        width: 25,
      });

      const sessionUsed = formatCost(budgetStatus.session.used);
      const sessionLimit = formatCost(budgetStatus.session.limit);
      const dailyUsed = formatCost(budgetStatus.daily.used);
      const dailyLimit = formatCost(budgetStatus.daily.limit);

      content += `${bold('║')}  Session:  ${sessionBar}                     ${bold('║')}\n`;
      content += `${bold('║')}            ${sessionUsed} / ${sessionLimit}                                    ${bold('║')}\n`;
      content += `${bold('║')}                                                              ${bold('║')}\n`;
      content += `${bold('║')}  Daily:    ${dailyBar}                     ${bold('║')}\n`;
      content += `${bold('║')}            ${dailyUsed} / ${dailyLimit}                                    ${bold('║')}\n`;
      content += `${bold('║')}                                                              ${bold('║')}\n`;
      content += `${bold('║')}  Tokens:   ${tokenBar}                     ${bold('║')}\n`;
      content += `${bold('║')}            ${formatTokens(budgetStatus.tokens.used)} / ${formatTokens(budgetStatus.tokens.limit)}                                           ${bold('║')}\n`;

      content += `${bold('╠══════════════════════════════════════════════════════════════╣')}\n`;
    }

    // Model breakdown
    if (sessionSummary && Object.keys(sessionSummary.byModel).length > 0) {
      content += `${bold('║')}  ${bold('BY MODEL')}                                                   ${bold('║')}\n`;
      content += `${bold('║')}                                                              ${bold('║')}\n`;

      for (const [model, data] of Object.entries(sessionSummary.byModel)) {
        const modelName = model.replace('claude-', '').slice(0, 20).padEnd(20);
        const tokens = formatTokens(data.tokens).padStart(8);
        const cost = formatCost(data.cost).padStart(10);
        content += `${bold('║')}  ${modelName} ${tokens} tok  ${cost}            ${bold('║')}\n`;
      }

      content += `${bold('╠══════════════════════════════════════════════════════════════╣')}\n`;
    }

    // Operation breakdown
    if (sessionSummary && Object.keys(sessionSummary.byOperation).length > 0) {
      content += `${bold('║')}  ${bold('BY OPERATION')}                                               ${bold('║')}\n`;
      content += `${bold('║')}                                                              ${bold('║')}\n`;

      for (const [op, data] of Object.entries(sessionSummary.byOperation)) {
        const opName = op.slice(0, 20).padEnd(20);
        const tokens = formatTokens(data.tokens).padStart(8);
        const cost = formatCost(data.cost).padStart(10);
        content += `${bold('║')}  ${opName} ${tokens} tok  ${cost}            ${bold('║')}\n`;
      }

      content += `${bold('║')}                                                              ${bold('║')}\n`;
    }

    content += `${bold('╚══════════════════════════════════════════════════════════════╝')}\n`;
  }

  // Footer with help
  content += `\n${fg(COLORS.muted)('[R] Refresh  [Esc] Close')}`;

  if (inputText) {
    inputText.content = t`${content}`;
  }
}

/**
 * Update help text for costs mode
 */
function updateCostsHelpText(): void {
  if (helpText) {
    helpText.content = t`${fg(COLORS.muted)('[R] Refresh  [Tab] Switch view  [Esc] Close')}`;
  }
}

/**
 * Handle costs mode input
 */
export function handleCostsInput(key: KeyEvent): void {
  if (key.name === 'escape') {
    exitCostsMode();
    return;
  }

  if (key.name === 'r') {
    loadCostsData();
    updateCostsPanel();
    if (onShowFeedback) onShowFeedback('Cost data refreshed');
    return;
  }

  if (key.name === 'tab') {
    // Cycle through views
    const views: Array<'overview' | 'breakdown' | 'history'> = ['overview', 'breakdown', 'history'];
    const currentIdx = views.indexOf(selectedView);
    selectedView = views[(currentIdx + 1) % views.length];
    updateCostsPanel();
    return;
  }
}

/**
 * Exit costs mode
 */
function exitCostsMode(): void {
  if (inputPanel) {
    inputPanel.visible = false;
  }
  if (onExitMode) onExitMode();
}
