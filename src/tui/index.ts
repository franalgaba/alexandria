#!/usr/bin/env bun
/**
 * Alexandria TUI - Terminal UI for memory management
 *
 * Run side-by-side with Claude Code or pi-coding-agent to review memories
 */

import {
  BoxRenderable,
  bold,
  type CliRenderer,
  createCliRenderer,
  fg,
  type KeyEvent,
  type MouseEvent,
  ScrollBoxRenderable,
  type SelectOption,
  SelectRenderable,
  SelectRenderableEvents,
  type TabSelectOption,
  TabSelectRenderable,
  TabSelectRenderableEvents,
  TextRenderable,
  t,
  underline,
} from '@opentui/core';
import type { ContextLevel } from '../retriever/progressive.ts';
import { StalenessChecker } from '../reviewer/staleness.ts';
import { closeConnection, getConnection, listProjectDatabases } from '../stores/connection.ts';
import { EventStore } from '../stores/events.ts';
import { MemoryObjectStore } from '../stores/memory-objects.ts';
import { SessionStore } from '../stores/sessions.ts';
import type { Event, EventType } from '../types/events.ts';
import type {
  Confidence,
  ConfidenceTier,
  MemoryObject,
  ObjectType,
} from '../types/memory-objects.ts';
import { getConfidenceTierEmoji } from '../utils/confidence.ts';
import { CostTracker } from '../utils/cost-tracker.ts';
import {
  renderCheckpointIndicator,
  updateCheckpointState,
} from './components/checkpoint-indicator.ts';
import { costService } from './services/cost-service.ts';
import { reviewService } from './services/review-service.ts';
import {
  enterAddMode as enterAddModeView,
  getAddStep,
  handleAddInput as handleAddInputView,
  initAddView,
  setAddViewProject,
  updateAddPanel as updateAddPanelView,
} from './views/add-view.ts';
import {
  enterConflictsMode as enterConflictsModeView,
  getPendingConflictsCount,
  handleConflictsInput as handleConflictsInputView,
  initConflictsView,
  loadConflicts as loadConflictsView,
  setConflictsViewProject,
  updateConflictsPanel as updateConflictsPanelView,
} from './views/conflicts-view.ts';
import {
  enterContextMode as enterContextModeView,
  getContextHealthMetrics,
  getContextHistory,
  handleContextInput as handleContextInputView,
  initContextView,
  loadContextViewer as loadContextViewerView,
  setContextViewProject,
  trackContextInjection as trackContextInjectionView,
  updateContextPanel as updateContextPanelView,
} from './views/context-view.ts';
import {
  enterHeatmapMode as enterHeatmapModeView,
  handleHeatmapInput as handleHeatmapInputView,
  initHeatmapView,
  setHeatmapViewProject,
  updateHeatmapPanel as updateHeatmapPanelView,
} from './views/heatmap-view.ts';
// Modular views
import {
  enterCostsMode,
  handleCostsInput,
  initCostsView,
  updateCostsPanel,
} from './views/costs-view.ts';
import {
  addDebugLog,
  type DebugLogType,
  endDebugPanelResize,
  getDebugPanelHeightPercent,
  getDebugPanelTopRow,
  handleDebugPanelDrag,
  initDebugView,
  initializeDebugTracking,
  isDebugConsoleVisible,
  isResizingDebug,
  resizeDebugPanel,
  setDebugViewProject,
  startDebugPanelResize,
  startDebugRefresh,
  stopDebugRefresh,
  toggleDebugConsole,
  updateDebugPanel,
} from './views/debug-view.ts';
import {
  applyFilters as applyFiltersView,
  enterFilterMode as enterFilterModeView,
  getFilterSummary as getFilterSummaryView,
  getFilters,
  handleFilterInput as handleFilterInputView,
  initFilterView,
  updateFilterPanel as updateFilterPanelView,
} from './views/filter-view.ts';
import {
  enterPackMode as enterPackModeView,
  handlePackInput as handlePackInputView,
  initPackView,
  setPackViewProject,
  updatePackPanel as updatePackPanelView,
} from './views/pack-view.ts';
import {
  enterReviewMode,
  handleReviewInput,
  initReviewView,
  updateReviewPanel,
} from './views/review-view.ts';
import {
  clearSearchResults,
  enterSearchMode as enterSearchModeView,
  getSearchResults,
  handleSearchInput as handleSearchInputView,
  initSearchView,
  setSearchViewProject,
  updateSearchPanel as updateSearchPanelView,
} from './views/search-view.ts';
import {
  enterStatsMode as enterStatsModeView,
  getQualityMetrics,
  handleStatsInput as handleStatsInputView,
  initStatsView,
  loadStats as loadStatsView,
  setStatsViewProject,
  updateStatsPanel as updateStatsPanelView,
} from './views/stats-view.ts';

// State
let renderer: CliRenderer;
let currentProject: string | null = null;
let currentMemories: MemoryObject[] = [];
let selectedMemoryIndex = 0;
let viewMode: 'list' | 'detail' | 'trail' = 'list';

// Input modes
type InputMode =
  | 'normal'
  | 'add'
  | 'search'
  | 'pack'
  | 'filter'
  | 'conflicts'
  | 'stats'
  | 'context'
  | 'costs'
  | 'review'
  | 'heatmap';
let inputMode: InputMode = 'normal';

// Quality metrics cache (used by status bar and context view)
let qualityMetrics: {
  healthScore: number;
  codeRefRate: number;
  approvedRate: number;
  staleness: { verified: number; needsReview: number; stale: number };
} | null = null;

// Exit state
let isExiting = false;

// Auto-refresh state
let refreshInterval: ReturnType<typeof setInterval> | null = null;
const REFRESH_INTERVAL_MS = 3000; // Refresh every 3 seconds

// UI Elements
let projectTabs: TabSelectRenderable;
let memoryList: SelectRenderable;
let detailPanel: ScrollBoxRenderable;
let detailText: TextRenderable;
let trailPanel: ScrollBoxRenderable;
let trailText: TextRenderable;
let statusBar: TextRenderable;
let helpText: TextRenderable;

// Input mode UI elements
let inputPanel: ScrollBoxRenderable;
let inputText: TextRenderable;

// Context viewer UI elements (native OpenTUI components)
let contextPanel: ScrollBoxRenderable;
let contextHeaderText: TextRenderable;
let contextLevelsText: TextRenderable;
let contextTiersText: TextRenderable;
let contextHealthText: TextRenderable;
let contextHistoryText: TextRenderable;

// Heatmap viewer UI elements
let heatmapPanel: ScrollBoxRenderable;
let heatmapHeaderText: TextRenderable;
let heatmapListText: TextRenderable;
let heatmapStatsText: TextRenderable;

// Debug console UI elements
let debugPanel: ScrollBoxRenderable;
let debugText: TextRenderable;

// Type abbreviations (clean, no emojis)
const TYPE_ABBREV: Record<string, string> = {
  decision: 'DEC',
  constraint: 'CON',
  convention: 'CNV',
  known_fix: 'FIX',
  failed_attempt: 'FAL',
  preference: 'PRF',
  environment: 'ENV',
};

// Review status indicators
const REVIEW_INDICATOR: Record<string, string> = {
  pending: '?',
  approved: '+',
  rejected: '-',
};

// Memory status indicators
const STATUS_INDICATOR: Record<string, string> = {
  active: ' ',
  stale: '~',
  superseded: '^',
  retired: 'x',
};

// Filter state
type FilterState = {
  hideRetired: boolean;
  typeFilter: ObjectType | null;
  reviewFilter: 'pending' | 'approved' | 'rejected' | null;
};
const filters: FilterState = {
  hideRetired: true, // Hide retired by default
  typeFilter: null,
  reviewFilter: null,
};

// Feedback message state
let feedbackMessage = '';
let feedbackTimeout: ReturnType<typeof setTimeout> | null = null;

// Panel layout update function (needs to be defined before debug view uses it)
function updatePanelLayout() {
  const reservedBottom = 5;
  const debugVisible = isDebugConsoleVisible();
  const debugHeight = getDebugPanelHeightPercent();
  const mainHeight = debugVisible ? `${100 - debugHeight - reservedBottom}%` : '70%';

  memoryList.height = mainHeight as `${number}%`;
  detailPanel.height = mainHeight as `${number}%`;
  trailPanel.height = mainHeight as `${number}%`;
  inputPanel.height = mainHeight as `${number}%`;

  if (debugPanel) {
    debugPanel.height = `${debugHeight}%`;
  }
}

function applyFilters(memories: MemoryObject[]): MemoryObject[] {
  return memories.filter((m) => {
    if (filters.hideRetired && m.status === 'retired') return false;
    if (filters.typeFilter && m.objectType !== filters.typeFilter) return false;
    if (filters.reviewFilter && m.reviewStatus !== filters.reviewFilter) return false;
    return true;
  });
}

function getFilterSummary(): string {
  const parts: string[] = [];
  if (filters.hideRetired) parts.push('hiding retired');
  if (filters.typeFilter) parts.push(`type:${filters.typeFilter}`);
  if (filters.reviewFilter) parts.push(`review:${filters.reviewFilter}`);
  return parts.length > 0 ? parts.join(', ') : 'no filters';
}

function getProjects(): TabSelectOption[] {
  const projects = listProjectDatabases();
  if (projects.length === 0) {
    return [{ name: 'No projects', description: 'No Alexandria projects found', value: '' }];
  }
  return projects.map((p) => ({
    name: p.name.length > 15 ? p.name.slice(0, 12) + '...' : p.name,
    description: p.projectPath,
    value: p.dbPath, // Use dbPath, not path
  }));
}

function loadMemories(dbPath: string): MemoryObject[] {
  try {
    // Open database directly without caching
    const { Database } = require('bun:sqlite');
    const db = new Database(dbPath);
    const store = new MemoryObjectStore(db);
    const memories = store.list({ limit: 100 });
    db.close();
    // Newest first (default from database ORDER BY created_at DESC)
    return memories;
  } catch (error) {
    console.error('Failed to load memories:', error);
    return [];
  }
}

function showFeedback(message: string, durationMs = 2000) {
  feedbackMessage = message;
  updateStatusBar();
  if (feedbackTimeout) clearTimeout(feedbackTimeout);
  feedbackTimeout = setTimeout(() => {
    feedbackMessage = '';
    updateStatusBar();
  }, durationMs);
}

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

  // For older dates, show short date
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getMemoryOptions(): SelectOption[] {
  const filtered = applyFilters(currentMemories);
  if (filtered.length === 0) {
    const msg = currentMemories.length === 0 ? 'No memories' : 'No matches (adjust filters)';
    return [{ name: msg, description: '[f] to change filters', value: '' }];
  }

  return filtered.map((m) => {
    const type = TYPE_ABBREV[m.objectType] || '???';
    const review = REVIEW_INDICATOR[m.reviewStatus] || ' ';
    const status = STATUS_INDICATOR[m.status] || ' ';
    const tierEmoji = getTierEmoji(m.confidenceTier);
    const content = m.content.length > 42 ? m.content.slice(0, 39) + '...' : m.content;
    const timeAgo = formatRelativeTime(m.createdAt);
    return {
      name: `${tierEmoji}[${review}] ${content}`,
      description: `${type} | ${m.confidenceTier || 'unknown'} | ${timeAgo}`,
      value: m.id,
    };
  });
}

function getTierEmoji(tier: ConfidenceTier | undefined): string {
  switch (tier) {
    case 'grounded':
      return '✅';
    case 'observed':
      return '👁';
    case 'inferred':
      return '🤖';
    case 'hypothesis':
      return '❓';
    default:
      return '•';
  }
}

function getMemoryDetail(memory: MemoryObject): string {
  const type = TYPE_ABBREV[memory.objectType] || '???';
  const review = REVIEW_INDICATOR[memory.reviewStatus] || ' ';

  return `[${type}] ${memory.objectType.toUpperCase()} [${review}] ${memory.reviewStatus}

${memory.content}

────────────────────────────────────────

ID: ${memory.id}
Status: ${memory.status}
Confidence: ${memory.confidence} (${memory.confidenceTier || 'unknown'})
Scope: ${memory.scope.type}${memory.scope.path ? ` - ${memory.scope.path}` : ''}
Created: ${new Date(memory.createdAt).toLocaleString()}
Updated: ${new Date(memory.updatedAt).toLocaleString()}
Access Count: ${memory.accessCount}

${
  memory.codeRefs && memory.codeRefs.length > 0
    ? `Code References:
${memory.codeRefs.map((r) => `  - ${r.path}${r.symbol ? `:${r.symbol}` : ''}`).join('\n')}`
    : ''
}`;
}

function getMemoryTrail(memory: MemoryObject): string {
  if (!memory.evidenceEventIds || memory.evidenceEventIds.length === 0) {
    return 'No event trail available for this memory.';
  }

  try {
    const db = getConnection(currentProject!);
    const eventStore = new EventStore(db);

    let trail = `Event Trail for Memory: ${memory.id}\n`;
    trail += '━'.repeat(50) + '\n\n';

    for (const eventId of memory.evidenceEventIds) {
      const event = eventStore.get(eventId);
      if (event) {
        const content = eventStore.getContent(event);
        trail += `* ${event.eventType.toUpperCase()} - ${new Date(event.timestamp).toLocaleString()}\n`;
        if (event.toolName) trail += `   Tool: ${event.toolName}\n`;
        trail += `   ${content?.slice(0, 200) || '(no content)'}...\n\n`;
      }
    }

    return trail;
  } catch (error) {
    return `Failed to load trail: ${error}`;
  }
}

function updateStatusBar() {
  const filtered = applyFilters(currentMemories);
  const totalCount = currentMemories.length;
  const shownCount = filtered.length;
  const projectName = currentProject ? currentProject.split('/').pop()?.slice(0, 15) : 'No project';

  if (feedbackMessage) {
    statusBar.content = t`${fg('#58a6ff')(feedbackMessage)}`;
  } else {
    const filterInfo = shownCount < totalCount ? `${shownCount}/${totalCount}` : `${totalCount}`;

    // Add health indicator
    let healthInfo = '';
    if (qualityMetrics) {
      const healthEmoji =
        qualityMetrics.healthScore >= 80 ? 'G' : qualityMetrics.healthScore >= 60 ? 'Y' : 'R';
      healthInfo = ` | [${healthEmoji}]${qualityMetrics.healthScore}`;
    }

    // Add conflict indicator
    const conflictCount = getPendingConflictsCount();
    const conflictInfo = conflictCount > 0 ? ` | !${conflictCount}` : '';

    // Add checkpoint progress indicator
    const checkpointInfo = renderCheckpointIndicator();
    const checkpointSection = checkpointInfo ? ` | ${checkpointInfo}` : '';

    // Add pending review count
    let pendingInfo = '';
    if (currentProject) {
      try {
        const db = getConnection(currentProject);
        const store = new MemoryObjectStore(db);
        const pendingCount = store.list({ reviewStatus: 'pending' }).length;
        if (pendingCount > 0) {
          pendingInfo = ` | ${pendingCount}P`;
        }
      } catch {
        /* ignore */
      }
    }

    statusBar.content = t`${fg('#888888')(`${projectName} | ${filterInfo}${healthInfo}${conflictInfo}${checkpointSection}${pendingInfo} | ${getFilterSummary()}`)}`;
  }
}

function updateHelpText() {
  if (inputMode === 'add') {
    const currentStep = getAddStep();
    if (currentStep === 'content') {
      helpText.content = t`${fg('#666666')(`[Enter] Next | [Esc] Cancel`)}`;
    } else if (currentStep === 'confirm') {
      helpText.content = t`${fg('#666666')(`[Enter] Save | [Esc] Cancel`)}`;
    } else {
      helpText.content = t`${fg('#666666')(`[↑↓] Select | [Enter] Next | [Esc] Cancel`)}`;
    }
  } else if (inputMode === 'search') {
    helpText.content = t`${fg('#666666')(`[Enter] Search | [↑↓] Navigate results | [Esc] Cancel`)}`;
  } else if (inputMode === 'pack') {
    helpText.content = t`${fg('#666666')(`[↑↓] Select level | [Enter] Generate | [Esc] Cancel`)}`;
  } else if (inputMode === 'filter') {
    helpText.content = t`${fg('#666666')(`[↑↓] Select | [Enter/Space] Toggle | [Esc] Close`)}`;
  } else if (inputMode === 'conflicts') {
    helpText.content = t`${fg('#666666')(`[←→] Navigate | [1-4] Resolve | [Esc] Close`)}`;
  } else if (inputMode === 'stats') {
    helpText.content = t`${fg('#666666')(`[Esc] Close`)}`;
  } else if (inputMode === 'context') {
    helpText.content = t`${fg('#666666')(`[R] Refresh | [G] Generate pack | [Esc] Close`)}`;
  } else if (inputMode === 'costs') {
    helpText.content = t`${fg('#666666')(`[R] Refresh  [Tab] Switch view  [Esc] Close`)}`;
  } else if (inputMode === 'review') {
    helpText.content = t`${fg('#666666')(`[A]pprove [E]dit [M]erge [R]eject [K]ip | [</>] Nav [Esc] Close`)}`;
  } else if (inputMode === 'heatmap') {
    helpText.content = t`${fg('#666666')(`[R] Refresh  [Enter] View detail  [Esc] Close`)}`;
  } else {
    const conflictCount = getPendingConflictsCount();
    const conflictBadge = conflictCount > 0 ? ` [C]:${conflictCount}!` : '';
    const debugInfo = isDebugConsoleVisible() ? `[D]:on` : '[D]:off';
    helpText.content = t`${fg('#666666')(`[a]dd [s]earch [p]ack [f]ilter [S]tats [W]indow [H]eatmap [$]costs [P]ending${conflictBadge} | [v]erify [r]etire | ${debugInfo} [q]uit`)}`;
  }
}

function switchToProject(dbPath: string) {
  if (!dbPath) return;

  currentProject = dbPath;
  currentMemories = loadMemories(dbPath);
  selectedMemoryIndex = 0;

  // Update memory list
  memoryList.options = getMemoryOptions();
  memoryList.setSelectedIndex(0);

  // Update debug view project and initialize tracking
  setDebugViewProject(dbPath);
  initializeDebugTracking(dbPath);

  // Load quality metrics and conflicts
  loadQualityMetrics(dbPath);
  loadConflictsView();

  // Re-initialize modular views with new project
  initCostsView({
    project: currentProject,
    inputPanelRef: inputPanel,
    inputTextRef: inputText,
    helpTextRef: helpText,
    exitModeCallback: () => {
      inputMode = 'normal';
      updateHelpText();
    },
    showFeedbackCallback: showFeedback,
  });

  initReviewView({
    project: currentProject,
    inputPanelRef: inputPanel,
    inputTextRef: inputText,
    helpTextRef: helpText,
    exitModeCallback: () => {
      inputMode = 'normal';
      updateHelpText();
    },
    showFeedbackCallback: showFeedback,
  });

  // Update project references in extracted views
  setAddViewProject(currentProject);
  setSearchViewProject(currentProject);
  setPackViewProject(currentProject);
  setConflictsViewProject(currentProject);
  setStatsViewProject(currentProject);
  setContextViewProject(currentProject);
  setHeatmapViewProject(currentProject);

  updateStatusBar();
  updateDetailPanel();
}

function loadQualityMetrics(dbPath: string) {
  try {
    const db = getConnection(dbPath);
    const memoryStore = new MemoryObjectStore(db);
    const stalenessChecker = new StalenessChecker(db);

    const activeMemories = memoryStore.list({ status: ['active'], limit: 10000 });
    const stalenessSummary = stalenessChecker.getSummary();

    const total = activeMemories.length;
    const withCodeRefs = activeMemories.filter((m) => m.codeRefs && m.codeRefs.length > 0).length;
    const approved = activeMemories.filter((m) => m.reviewStatus === 'approved').length;

    const tierCounts = { grounded: 0, observed: 0, inferred: 0, hypothesis: 0 };
    for (const m of activeMemories) {
      const tier = m.confidenceTier || 'inferred';
      if (tier in tierCounts) tierCounts[tier as keyof typeof tierCounts]++;
    }

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
  } catch (error) {
    qualityMetrics = null;
  }
}

function refreshMemories() {
  // Don't refresh if in input mode or no project selected
  if (inputMode !== 'normal' || !currentProject) return;

  // Remember current selection by ID
  const filtered = applyFilters(currentMemories);
  const currentId =
    filtered.length > 0 && selectedMemoryIndex < filtered.length
      ? filtered[selectedMemoryIndex].id
      : null;

  // Reload memories
  const newMemories = loadMemories(currentProject);

  // Check if anything changed
  if (newMemories.length === currentMemories.length) {
    const unchanged = newMemories.every(
      (m, i) =>
        currentMemories[i]?.id === m.id &&
        currentMemories[i]?.status === m.status &&
        currentMemories[i]?.reviewStatus === m.reviewStatus,
    );
    if (unchanged) return; // No changes, skip update
  }

  currentMemories = newMemories;
  memoryList.options = getMemoryOptions();

  // Try to restore selection by ID
  if (currentId) {
    const newFiltered = applyFilters(currentMemories);
    const newIndex = newFiltered.findIndex((m) => m.id === currentId);
    if (newIndex >= 0) {
      selectedMemoryIndex = newIndex;
    } else {
      // Memory was filtered out, adjust index
      selectedMemoryIndex = Math.min(selectedMemoryIndex, Math.max(0, newFiltered.length - 1));
    }
  } else {
    selectedMemoryIndex = 0;
  }

  memoryList.setSelectedIndex(selectedMemoryIndex);
  updateStatusBar();
  updateDetailPanel();
}

function startAutoRefresh() {
  if (refreshInterval) return;
  refreshInterval = setInterval(refreshMemories, REFRESH_INTERVAL_MS);
}

function stopAutoRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

function updateDetailPanel() {
  const filtered = applyFilters(currentMemories);
  if (filtered.length === 0 || selectedMemoryIndex >= filtered.length) {
    detailText.content = 'No memory selected';
    trailText.content = '';
    return;
  }

  const memory = filtered[selectedMemoryIndex];
  detailText.content = getMemoryDetail(memory);

  if (viewMode === 'trail') {
    trailText.content = getMemoryTrail(memory);
    trailPanel.visible = true;
    detailPanel.visible = false;
  } else {
    trailPanel.visible = false;
    detailPanel.visible = true;
  }
}

// ============ Input Mode Functions ============
// (Mode enter/update/handle functions now in extracted views)

function exitInputMode() {
  inputMode = 'normal';
  hideInputPanel();
  // Hide context panel if it was open
  contextPanel.visible = false;
  // Restore original memories if we were searching
  if (getSearchResults().length > 0) {
    currentMemories = loadMemories(currentProject!);
    memoryList.options = getMemoryOptions();
    clearSearchResults();
  }
  updateHelpText();
  updateStatusBar();
}

function showInputPanel() {
  inputPanel.visible = true;
  detailPanel.visible = false;
  trailPanel.visible = false;
  memoryList.blur();
  projectTabs.blur();
}

function hideInputPanel() {
  inputPanel.visible = false;
  detailPanel.visible = true;
  memoryList.focus();
}

function updateInputPanel() {
  if (inputMode === 'add') {
    updateAddPanelView();
  } else if (inputMode === 'search') {
    updateSearchPanelView();
  } else if (inputMode === 'pack') {
    updatePackPanelView();
  } else if (inputMode === 'filter') {
    updateFilterPanelView();
  } else if (inputMode === 'conflicts') {
    updateConflictsPanelView();
  } else if (inputMode === 'stats') {
    updateStatsPanelView();
  } else if (inputMode === 'context') {
    updateContextPanelView();
  } else if (inputMode === 'costs') {
    updateCostsPanel();
  } else if (inputMode === 'review') {
    updateReviewPanel();
  } else if (inputMode === 'heatmap') {
    updateHeatmapPanelView();
  }
}

// Duplicate mode/update/handler functions removed - now using extracted views

async function verifyMemory(memory: MemoryObject) {
  try {
    const db = getConnection(currentProject!);
    const store = new MemoryObjectStore(db);
    store.update(memory.id, { reviewStatus: 'approved' });

    // Reload
    currentMemories = loadMemories(currentProject!);
    memoryList.options = getMemoryOptions();

    // Adjust selected index if out of bounds after filtering
    const filtered = applyFilters(currentMemories);
    if (selectedMemoryIndex >= filtered.length) {
      selectedMemoryIndex = Math.max(0, filtered.length - 1);
    }
    memoryList.setSelectedIndex(selectedMemoryIndex);

    updateDetailPanel();
    updateStatusBar();
    showFeedback(`+ Approved: ${memory.content.slice(0, 30)}...`);
  } catch (error) {
    showFeedback(`x Failed to verify: ${error}`);
  }
}

async function retireMemory(memory: MemoryObject) {
  try {
    const db = getConnection(currentProject!);
    const store = new MemoryObjectStore(db);
    store.update(memory.id, { status: 'retired' });

    // Reload
    currentMemories = loadMemories(currentProject!);
    memoryList.options = getMemoryOptions();

    // Adjust selected index if out of bounds after filtering
    const filtered = applyFilters(currentMemories);
    if (selectedMemoryIndex >= filtered.length) {
      selectedMemoryIndex = Math.max(0, filtered.length - 1);
    }
    memoryList.setSelectedIndex(selectedMemoryIndex);

    updateDetailPanel();
    updateStatusBar();
    showFeedback(`x Retired: ${memory.content.slice(0, 30)}...`);
  } catch (error) {
    showFeedback(`x Failed to retire: ${error}`);
  }
}

function cleanupAndExit() {
  // Prevent multiple cleanup calls
  if (isExiting) return;
  isExiting = true;

  // Stop auto-refresh and debug refresh
  stopAutoRefresh();
  stopDebugRefresh();

  // Disable mouse first via renderer
  if (renderer) {
    try {
      renderer.useMouse = false;
    } catch {
      // Ignore
    }
  }

  // Write all escape sequences in one call to avoid race conditions
  const resetSequence = [
    '\x1b[?1000l', // Disable mouse click tracking
    '\x1b[?1002l', // Disable mouse button tracking
    '\x1b[?1003l', // Disable all mouse tracking
    '\x1b[?1006l', // Disable SGR mouse mode
    '\x1b[?25h', // Show cursor
    '\x1b[?1049l', // Exit alternate screen buffer
    '\x1b[0m', // Reset all attributes
    '\x1b[2J', // Clear screen
    '\x1b[H', // Move cursor to home
  ].join('');

  process.stdout.write(resetSequence);

  // Destroy renderer (more thorough than stop)
  if (renderer) {
    try {
      renderer.destroy();
    } catch {
      // Ignore errors during cleanup
    }
  }

  // Small delay to ensure output is flushed
  setTimeout(() => {
    process.exit(0);
  }, 50);
}

function handleKeypress(key: KeyEvent) {
  // Handle input mode keys first
  if (inputMode !== 'normal') {
    if (inputMode === 'add') {
      handleAddInputView(key);
    } else if (inputMode === 'search') {
      handleSearchInputView(key);
    } else if (inputMode === 'pack') {
      handlePackInputView(key);
    } else if (inputMode === 'filter') {
      handleFilterInputView(key);
    } else if (inputMode === 'conflicts') {
      handleConflictsInputView(key);
    } else if (inputMode === 'stats') {
      handleStatsInputView(key);
    } else if (inputMode === 'context') {
      handleContextInputView(key);
    } else if (inputMode === 'costs') {
      handleCostsInput(key);
    } else if (inputMode === 'review') {
      handleReviewInput(key);
    } else if (inputMode === 'heatmap') {
      handleHeatmapInputView(key);
    }
    return;
  }

  // Global keys (only in normal mode)
  if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
    cleanupAndExit();
    return;
  }

  // Mode shortcuts
  if (key.name === 'a') {
    inputMode = 'add';
    showInputPanel();
    enterAddModeView();
    updateHelpText();
    return;
  }

  if (key.name === 's') {
    inputMode = 'search';
    showInputPanel();
    enterSearchModeView();
    updateHelpText();
    return;
  }

  if (key.name === 'p') {
    inputMode = 'pack';
    showInputPanel();
    enterPackModeView();
    updateHelpText();
    return;
  }

  if (key.name === 'f') {
    inputMode = 'filter';
    showInputPanel();
    enterFilterModeView();
    updateHelpText();
    return;
  }

  // Stats mode with Shift+S
  if (key.name === 's' && key.shift) {
    inputMode = 'stats';
    showInputPanel();
    enterStatsModeView();
    updateHelpText();
    return;
  }

  // Conflicts mode with Shift+C
  if (key.name === 'c' && key.shift) {
    loadConflictsView();
    if (getPendingConflictsCount() > 0) {
      inputMode = 'conflicts';
      showInputPanel();
      enterConflictsModeView();
      updateHelpText();
    } else {
      showFeedback('No pending conflicts');
    }
    return;
  }

  // Context window viewer with Shift+W
  if (key.name === 'w' && key.shift) {
    inputMode = 'context';
    enterContextModeView();
    updateHelpText();
    return;
  }

  // Heatmap viewer with Shift+H
  if (key.name === 'h' && key.shift) {
    inputMode = 'heatmap';
    enterHeatmapModeView();
    updateHelpText();
    return;
  }

  // Cost dashboard with $ key
  if (key.sequence === '$') {
    enterCostsMode();
    return;
  }

  // Pending review queue with Shift+P
  if (key.name === 'p' && key.shift) {
    enterReviewMode();
    return;
  }

  // Manual refresh with Shift+R
  if (key.name === 'r' && key.shift) {
    refreshMemories();
    showFeedback('Refreshed');
    return;
  }

  // Toggle debug console with Shift+D
  if (key.name === 'd' && key.shift) {
    toggleDebugConsole();
    return;
  }

  // Resize debug console with + and - keys
  if (isDebugConsoleVisible() && (key.sequence === '+' || key.sequence === '=')) {
    resizeDebugPanel(5);
    showFeedback(`Debug console: ${getDebugPanelHeightPercent()}%`);
    return;
  }

  if (isDebugConsoleVisible() && (key.sequence === '-' || key.sequence === '_')) {
    resizeDebugPanel(-5);
    showFeedback(`Debug console: ${getDebugPanelHeightPercent()}%`);
    return;
  }

  if (key.name === 'tab') {
    // Toggle focus between tabs and list
    if (projectTabs.focused) {
      projectTabs.blur();
      memoryList.focus();
    } else {
      memoryList.blur();
      projectTabs.focus();
    }
    return;
  }

  // Memory actions - work whenever we have a selected memory (no focus required)
  const filtered = applyFilters(currentMemories);
  if (filtered.length > 0 && selectedMemoryIndex < filtered.length) {
    const memory = filtered[selectedMemoryIndex];

    if (key.name === 'v') {
      verifyMemory(memory);
      return;
    }

    if (key.name === 'r') {
      retireMemory(memory);
      return;
    }

    if (key.name === 't') {
      viewMode = viewMode === 'trail' ? 'list' : 'trail';
      updateDetailPanel();
      updateStatusBar();
      return;
    }

    if (key.name === 'd') {
      viewMode = 'detail';
      updateDetailPanel();
      updateStatusBar();
      return;
    }

    // Arrow keys for navigation
    if (key.name === 'up') {
      selectedMemoryIndex = Math.max(0, selectedMemoryIndex - 1);
      memoryList.setSelectedIndex(selectedMemoryIndex);
      updateDetailPanel();
      return;
    }

    if (key.name === 'down') {
      selectedMemoryIndex = Math.min(filtered.length - 1, selectedMemoryIndex + 1);
      memoryList.setSelectedIndex(selectedMemoryIndex);
      updateDetailPanel();
      return;
    }
  }
}

export async function runTUI() {
  renderer = await createCliRenderer({
    consoleOptions: {
      startInDebugMode: false,
    },
    useMouse: true,
    enableMouseMovement: true,
  });

  renderer.setBackgroundColor('#0d1117');

  // Header
  const header = new TextRenderable(renderer, {
    id: 'header',
    content: t`${bold(fg('#58a6ff')('Alexandria Memory System'))}`,
    position: 'absolute',
    left: 2,
    top: 0,
  });
  renderer.root.add(header);

  // Project tabs
  const projects = getProjects();
  projectTabs = new TabSelectRenderable(renderer, {
    id: 'project-tabs',
    position: 'absolute',
    left: 0,
    top: 2,
    width: '100%',
    options: projects,
    tabWidth: 20,
    backgroundColor: '#161b22',
    focusedBackgroundColor: '#21262d',
    textColor: '#8b949e',
    focusedTextColor: '#c9d1d9',
    selectedBackgroundColor: '#238636',
    selectedTextColor: '#ffffff',
    showDescription: false,
    showScrollArrows: true,
  });
  renderer.root.add(projectTabs);

  // Memory list (left panel)
  memoryList = new SelectRenderable(renderer, {
    id: 'memory-list',
    position: 'absolute',
    left: 0,
    top: 5,
    width: '50%',
    height: '55%',
    options: [],
    backgroundColor: '#0d1117',
    focusedBackgroundColor: '#161b22',
    textColor: '#c9d1d9',
    focusedTextColor: '#ffffff',
    selectedBackgroundColor: '#21262d',
    showDescription: true,
  });
  renderer.root.add(memoryList);

  // Detail panel (right panel) - scrollable
  detailPanel = new ScrollBoxRenderable(renderer, {
    id: 'detail-panel',
    position: 'absolute',
    left: '50%',
    top: 5,
    width: '50%',
    height: '55%',
    backgroundColor: '#161b22',
    borderStyle: 'single',
    borderColor: '#30363d',
    title: 'Memory Details',
    titleAlignment: 'left',
    padding: 1,
    scrollY: true,
    scrollX: false,
  });
  renderer.root.add(detailPanel);

  detailText = new TextRenderable(renderer, {
    id: 'detail-text',
    content: 'Select a memory to view details',
    fg: '#c9d1d9',
    width: '100%',
  });
  detailPanel.content.add(detailText);

  // Trail panel (hidden by default) - scrollable
  trailPanel = new ScrollBoxRenderable(renderer, {
    id: 'trail-panel',
    position: 'absolute',
    left: '50%',
    top: 5,
    width: '50%',
    height: '55%',
    backgroundColor: '#161b22',
    borderStyle: 'single',
    borderColor: '#30363d',
    title: 'Event Trail',
    titleAlignment: 'left',
    padding: 1,
    scrollY: true,
    scrollX: false,
    visible: false,
  });
  renderer.root.add(trailPanel);

  trailText = new TextRenderable(renderer, {
    id: 'trail-text',
    content: '',
    fg: '#c9d1d9',
    width: '100%',
  });
  trailPanel.content.add(trailText);

  // Input panel (hidden by default, used for add/search/pack modes) - scrollable
  inputPanel = new ScrollBoxRenderable(renderer, {
    id: 'input-panel',
    position: 'absolute',
    left: '50%',
    top: 5,
    width: '50%',
    height: '55%',
    backgroundColor: '#161b22',
    borderStyle: 'single',
    borderColor: '#58a6ff',
    title: 'Input',
    titleAlignment: 'left',
    padding: 1,
    scrollY: true,
    scrollX: false,
    visible: false,
  });
  renderer.root.add(inputPanel);

  inputText = new TextRenderable(renderer, {
    id: 'input-text',
    content: '',
    fg: '#c9d1d9',
    width: '100%',
  });
  inputPanel.content.add(inputText);

  // Context viewer panel (native OpenTUI components)
  contextPanel = new ScrollBoxRenderable(renderer, {
    id: 'context-panel',
    position: 'absolute',
    left: '15%',
    top: 4,
    width: '70%',
    height: '80%',
    backgroundColor: '#161b22',
    borderStyle: 'single',
    borderColor: '#58a6ff',
    title: 'Context Window Viewer',
    titleAlignment: 'center',
    padding: 1,
    scrollY: true,
    scrollX: false,
    visible: false,
  });
  renderer.root.add(contextPanel);

  contextHeaderText = new TextRenderable(renderer, {
    id: 'context-header',
    content: '',
    fg: '#58a6ff',
    width: '100%',
  });
  contextPanel.content.add(contextHeaderText);

  contextLevelsText = new TextRenderable(renderer, {
    id: 'context-levels',
    content: '',
    fg: '#c9d1d9',
    width: '100%',
  });
  contextPanel.content.add(contextLevelsText);

  contextTiersText = new TextRenderable(renderer, {
    id: 'context-tiers',
    content: '',
    fg: '#c9d1d9',
    width: '100%',
  });
  contextPanel.content.add(contextTiersText);

  contextHealthText = new TextRenderable(renderer, {
    id: 'context-health',
    content: '',
    fg: '#c9d1d9',
    width: '100%',
  });
  contextPanel.content.add(contextHealthText);

  contextHistoryText = new TextRenderable(renderer, {
    id: 'context-history',
    content: '',
    fg: '#6e7681',
    width: '100%',
  });
  contextPanel.content.add(contextHistoryText);

  // Heatmap viewer panel
  heatmapPanel = new ScrollBoxRenderable(renderer, {
    id: 'heatmap-panel',
    position: 'absolute',
    left: '15%',
    top: 4,
    width: '70%',
    height: '80%',
    backgroundColor: '#161b22',
    borderStyle: 'single',
    borderColor: '#ff6b6b',
    title: '\u{1F525} Access Heatmap',
    titleAlignment: 'center',
    padding: 1,
    scrollY: true,
    scrollX: false,
    visible: false,
  });
  renderer.root.add(heatmapPanel);

  heatmapHeaderText = new TextRenderable(renderer, {
    id: 'heatmap-header',
    content: '',
    fg: '#ff6b6b',
    width: '100%',
  });
  heatmapPanel.content.add(heatmapHeaderText);

  heatmapListText = new TextRenderable(renderer, {
    id: 'heatmap-list',
    content: '',
    fg: '#c9d1d9',
    width: '100%',
  });
  heatmapPanel.content.add(heatmapListText);

  heatmapStatsText = new TextRenderable(renderer, {
    id: 'heatmap-stats',
    content: '',
    fg: '#8b949e',
    width: '100%',
  });
  heatmapPanel.content.add(heatmapStatsText);

  // Debug console panel (at the bottom)
  debugPanel = new ScrollBoxRenderable(renderer, {
    id: 'debug-panel',
    position: 'absolute',
    left: 0,
    bottom: 3,
    width: '100%',
    height: `${getDebugPanelHeightPercent()}%`,
    backgroundColor: '#0d1117',
    borderStyle: 'single',
    borderColor: '#30363d',
    title: 'Live Debug Console [+/- to resize]',
    titleAlignment: 'left',
    padding: 1,
    scrollY: true,
    scrollX: false,
    visible: isDebugConsoleVisible(),
  });
  renderer.root.add(debugPanel);

  debugText = new TextRenderable(renderer, {
    id: 'debug-text',
    content: t`${fg('#6e7681')('Waiting for events...')}`,
    fg: '#c9d1d9',
    width: '100%',
  });
  debugPanel.content.add(debugText);

  // Initialize debug view
  initDebugView({
    project: currentProject,
    debugPanelRef: debugPanel,
    debugTextRef: debugText,
    showFeedbackCallback: showFeedback,
    updatePanelLayoutCallback: updatePanelLayout,
    updateHelpTextCallback: updateHelpText,
    getInputModeCallback: () => inputMode,
  });

  // Debug panel resize handlers - click on border starts resize
  debugPanel.onMouseDown = (event: MouseEvent) => {
    if (!isDebugConsoleVisible()) return;

    // Check if clicking near the top border (within first 2 rows of the panel)
    const panelTop = getDebugPanelTopRow();
    // The event.y is relative to terminal, panelTop is where the panel starts
    if (event.y >= panelTop && event.y <= panelTop + 1) {
      startDebugPanelResize(event.y);
    }
  };

  // Status bar
  statusBar = new TextRenderable(renderer, {
    id: 'status-bar',
    content: '',
    position: 'absolute',
    left: 0,
    bottom: 1,
    width: '100%',
    fg: '#8b949e',
  });
  renderer.root.add(statusBar);

  // Help text
  helpText = new TextRenderable(renderer, {
    id: 'help-text',
    content: '',
    position: 'absolute',
    left: 0,
    bottom: 0,
    width: '100%',
    fg: '#6e7681',
  });
  renderer.root.add(helpText);

  // Event handlers
  projectTabs.on(
    TabSelectRenderableEvents.ITEM_SELECTED,
    (index: number, option: TabSelectOption) => {
      if (option.value) {
        switchToProject(option.value as string);
      }
    },
  );

  memoryList.on(SelectRenderableEvents.SELECTION_CHANGED, (index: number) => {
    selectedMemoryIndex = index;
    updateDetailPanel();
  });

  memoryList.on(SelectRenderableEvents.ITEM_SELECTED, (index: number) => {
    selectedMemoryIndex = index;
    viewMode = 'detail';
    updateDetailPanel();
    updateStatusBar();
  });

  // Mouse click handlers for memory list - calculate which item was clicked
  memoryList.onMouseDown = (event: MouseEvent) => {
    if (inputMode !== 'normal') return;

    projectTabs.blur();
    memoryList.focus();

    const filtered = applyFilters(currentMemories);
    // Calculate which item was clicked based on y position
    // Each item takes ~2 lines (name + description) when showDescription is true
    const localY = event.y - 5; // Subtract top offset (top: 5)
    if (localY >= 0 && filtered.length > 0) {
      const itemHeight = 2; // Each item is roughly 2 lines with description
      const clickedIndex = Math.floor(localY / itemHeight);
      if (clickedIndex >= 0 && clickedIndex < filtered.length) {
        selectedMemoryIndex = clickedIndex;
        memoryList.setSelectedIndex(clickedIndex);
        updateDetailPanel();
        updateStatusBar();
      }
    }
  };

  // Mouse scroll handler for memory list
  memoryList.onMouseScroll = (event: MouseEvent) => {
    const filtered = applyFilters(currentMemories);
    if (inputMode !== 'normal' || filtered.length === 0) return;

    const direction = event.scroll?.direction;
    if (direction === 'up') {
      selectedMemoryIndex = Math.max(0, selectedMemoryIndex - 1);
      memoryList.setSelectedIndex(selectedMemoryIndex);
      updateDetailPanel();
    } else if (direction === 'down') {
      selectedMemoryIndex = Math.min(filtered.length - 1, selectedMemoryIndex + 1);
      memoryList.setSelectedIndex(selectedMemoryIndex);
      updateDetailPanel();
    }
  };

  // Mouse click handlers for project tabs
  projectTabs.onMouseDown = (event: MouseEvent) => {
    if (inputMode !== 'normal') return;

    memoryList.blur();
    projectTabs.focus();

    // Calculate which tab was clicked based on x position
    const tabWidth = 20; // tabWidth: 20 in options
    const clickedTabIndex = Math.floor(event.x / tabWidth);
    const projects = getProjects();
    if (clickedTabIndex >= 0 && clickedTabIndex < projects.length) {
      const project = projects[clickedTabIndex];
      if (project.value) {
        projectTabs.setSelectedIndex(clickedTabIndex);
        switchToProject(project.value as string);
      }
    }
  };

  renderer.keyInput.on('keypress', handleKeypress);

  // Global mouse handlers for debug panel resizing
  renderer.root.onMouseDown = (event: MouseEvent) => {
    if (!isDebugConsoleVisible() || isResizingDebug()) return;

    // Check if clicking on or near the debug panel top border
    const panelTop = getDebugPanelTopRow();
    if (Math.abs(event.y - panelTop) <= 1) {
      startDebugPanelResize(event.y);
    }
  };

  renderer.root.onMouseUp = () => {
    if (isResizingDebug()) {
      endDebugPanelResize();
    }
  };

  renderer.root.onMouseMove = (event: MouseEvent) => {
    if (isResizingDebug()) {
      handleDebugPanelDrag(event.y);
    }
  };

  // Signal handlers for clean exit
  process.on('SIGINT', cleanupAndExit);
  process.on('SIGTERM', cleanupAndExit);
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    cleanupAndExit();
  });

  // Initialize modular views
  initCostsView({
    project: currentProject,
    inputPanelRef: inputPanel,
    inputTextRef: inputText,
    helpTextRef: helpText,
    exitModeCallback: () => {
      inputMode = 'normal';
      updateHelpText();
    },
    showFeedbackCallback: showFeedback,
  });

  initReviewView({
    project: currentProject,
    inputPanelRef: inputPanel,
    inputTextRef: inputText,
    helpTextRef: helpText,
    exitModeCallback: () => {
      inputMode = 'normal';
      updateHelpText();
    },
    showFeedbackCallback: showFeedback,
  });

  initAddView({
    project: currentProject,
    inputPanelRef: inputPanel,
    inputTextRef: inputText,
    exitModeCallback: () => {
      inputMode = 'normal';
      hideInputPanel();
      updateHelpText();
    },
    showFeedbackCallback: showFeedback,
    reloadMemoriesCallback: () => loadMemories(currentProject!),
    updateMemoryListCallback: (memories) => {
      currentMemories = memories;
      memoryList.options = getMemoryOptions();
    },
  });

  initSearchView({
    project: currentProject,
    inputPanelRef: inputPanel,
    inputTextRef: inputText,
    exitModeCallback: () => {
      inputMode = 'normal';
      hideInputPanel();
      // Restore original memories if we were searching
      if (getSearchResults().length > 0) {
        currentMemories = loadMemories(currentProject!);
        memoryList.options = getMemoryOptions();
        clearSearchResults();
      }
      updateHelpText();
      updateStatusBar();
    },
    showFeedbackCallback: showFeedback,
    updateMemoriesCallback: (memories) => {
      currentMemories = memories;
      memoryList.options = getMemoryOptions();
    },
    updateDetailPanelCallback: updateDetailPanel,
    updateStatusBarCallback: updateStatusBar,
    navigateResultCallback: (delta) => {
      const filtered = applyFiltersView(currentMemories);
      const newIndex = selectedMemoryIndex + delta;
      if (newIndex >= 0 && newIndex < filtered.length) {
        selectedMemoryIndex = newIndex;
        memoryList.selectedIndex = selectedMemoryIndex;
      }
    },
  });

  initPackView({
    project: currentProject,
    inputPanelRef: inputPanel,
    inputTextRef: inputText,
    exitModeCallback: () => {
      inputMode = 'normal';
      hideInputPanel();
      updateHelpText();
    },
    showFeedbackCallback: showFeedback,
  });

  initFilterView({
    inputPanelRef: inputPanel,
    inputTextRef: inputText,
    exitModeCallback: () => {
      inputMode = 'normal';
      hideInputPanel();
      updateHelpText();
    },
    showFeedbackCallback: showFeedback,
    filtersChangedCallback: () => {
      memoryList.options = getMemoryOptions();
    },
    updateStatusBarCallback: updateStatusBar,
    getCurrentMemoriesCallback: () => currentMemories,
  });

  initConflictsView({
    project: currentProject,
    inputPanelRef: inputPanel,
    inputTextRef: inputText,
    exitModeCallback: () => {
      inputMode = 'normal';
      hideInputPanel();
      updateHelpText();
    },
    showFeedbackCallback: showFeedback,
    refreshMemoriesCallback: refreshMemories,
    addDebugLogCallback: (type, msg) => addDebugLog(type as DebugLogType, msg),
  });

  initStatsView({
    project: currentProject,
    inputPanelRef: inputPanel,
    inputTextRef: inputText,
    exitModeCallback: () => {
      inputMode = 'normal';
      hideInputPanel();
      updateHelpText();
    },
  });

  initContextView({
    project: currentProject,
    contextPanelRef: contextPanel,
    contextHeaderTextRef: contextHeaderText,
    contextLevelsTextRef: contextLevelsText,
    contextTiersTextRef: contextTiersText,
    contextHealthTextRef: contextHealthText,
    contextHistoryTextRef: contextHistoryText,
    exitModeCallback: () => {
      inputMode = 'normal';
      contextPanel.visible = false;
      detailPanel.visible = true;
      memoryList.focus();
      updateHelpText();
    },
    showFeedbackCallback: showFeedback,
    hideOtherPanelsCallback: () => {
      inputPanel.visible = false;
      detailPanel.visible = false;
      trailPanel.visible = false;
      memoryList.blur();
      projectTabs.blur();
    },
    getQualityMetricsCallback: () => qualityMetrics,
  });

  initHeatmapView({
    project: currentProject,
    heatmapPanelRef: heatmapPanel,
    heatmapHeaderTextRef: heatmapHeaderText,
    heatmapListTextRef: heatmapListText,
    heatmapStatsTextRef: heatmapStatsText,
    exitModeCallback: () => {
      inputMode = 'normal';
      heatmapPanel.visible = false;
      detailPanel.visible = true;
      memoryList.focus();
      updateHelpText();
    },
    showFeedbackCallback: showFeedback,
    hideOtherPanelsCallback: () => {
      inputPanel.visible = false;
      detailPanel.visible = false;
      trailPanel.visible = false;
      contextPanel.visible = false;
      memoryList.blur();
      projectTabs.blur();
    },
  });

  // Initialize
  if (projects.length > 0 && projects[0].value) {
    switchToProject(projects[0].value as string);
  }

  updateHelpText();
  memoryList.focus();

  // Start auto-refresh to pick up new memories from other sessions
  startAutoRefresh();

  // Start debug console refresh to watch for events/memories in real-time
  startDebugRefresh();

  // Start renderer
  renderer.start();
}

// Run if executed directly
if (import.meta.main) {
  runTUI().catch(console.error);
}
