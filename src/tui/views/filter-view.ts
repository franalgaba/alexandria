/**
 * Filter View
 *
 * Filter memories by type, status, and retired state.
 * Activated with 'f' key.
 */

import type { KeyEvent, ScrollBoxRenderable, TextRenderable } from '@opentui/core';
import type { MemoryObject, ObjectType } from '../../types/memory-objects.ts';

// Constants
const MEMORY_TYPES: ObjectType[] = [
  'decision',
  'preference',
  'convention',
  'known_fix',
  'constraint',
  'failed_attempt',
  'environment',
];

// Filter state type
export type FilterState = {
  hideRetired: boolean;
  typeFilter: ObjectType | null;
  reviewFilter: 'pending' | 'approved' | 'rejected' | null;
};

// Module state
let inputPanel: ScrollBoxRenderable | null = null;
let inputText: TextRenderable | null = null;

// Filter mode state
let filterSelectedIndex = 0;
let filters: FilterState = {
  hideRetired: true,
  typeFilter: null,
  reviewFilter: null,
};

// Callbacks
let onExitMode: (() => void) | null = null;
let onShowFeedback: ((msg: string) => void) | null = null;
let onFiltersChanged: (() => void) | null = null;
let onUpdateStatusBar: (() => void) | null = null;
let getCurrentMemories: (() => MemoryObject[]) | null = null;

/**
 * Initialize view with TUI elements
 */
export function initFilterView(options: {
  inputPanelRef: ScrollBoxRenderable;
  inputTextRef: TextRenderable;
  exitModeCallback: () => void;
  showFeedbackCallback: (msg: string) => void;
  filtersChangedCallback: () => void;
  updateStatusBarCallback: () => void;
  getCurrentMemoriesCallback: () => MemoryObject[];
}): void {
  inputPanel = options.inputPanelRef;
  inputText = options.inputTextRef;
  onExitMode = options.exitModeCallback;
  onShowFeedback = options.showFeedbackCallback;
  onFiltersChanged = options.filtersChangedCallback;
  onUpdateStatusBar = options.updateStatusBarCallback;
  getCurrentMemories = options.getCurrentMemoriesCallback;
}

/**
 * Enter filter mode
 */
export function enterFilterMode(): void {
  filterSelectedIndex = 0;
  showFilterPanel();
  updateFilterPanel();
}

/**
 * Show filter panel
 */
function showFilterPanel(): void {
  if (inputPanel) {
    inputPanel.visible = true;
  }
}

/**
 * Apply filters to memory list
 */
export function applyFilters(memories: MemoryObject[]): MemoryObject[] {
  return memories.filter((m) => {
    if (filters.hideRetired && m.status === 'retired') return false;
    if (filters.typeFilter && m.objectType !== filters.typeFilter) return false;
    if (filters.reviewFilter && m.reviewStatus !== filters.reviewFilter) return false;
    return true;
  });
}

/**
 * Get filter summary for status bar
 */
export function getFilterSummary(): string {
  const parts: string[] = [];
  if (filters.hideRetired) parts.push('hiding retired');
  if (filters.typeFilter) parts.push(`type:${filters.typeFilter}`);
  if (filters.reviewFilter) parts.push(`review:${filters.reviewFilter}`);
  return parts.length > 0 ? parts.join(', ') : 'no filters';
}

/**
 * Get current filters
 */
export function getFilters(): FilterState {
  return { ...filters };
}

/**
 * Set filters (for external state management)
 */
export function setFilters(newFilters: FilterState): void {
  filters = { ...newFilters };
}

/**
 * Update filter panel content
 */
export function updateFilterPanel(): void {
  if (!inputText) return;

  let content = 'FILTER MEMORIES\n';
  content += '─'.repeat(35) + '\n\n';

  const options = [
    {
      label: `Hide retired: ${filters.hideRetired ? 'ON' : 'OFF'}`,
      desc: 'Toggle hiding retired memories',
    },
    {
      label: `Type: ${filters.typeFilter || 'all'}`,
      desc: 'Filter by memory type',
    },
    {
      label: `Review: ${filters.reviewFilter || 'all'}`,
      desc: 'Filter by review status',
    },
    {
      label: 'Clear all filters',
      desc: 'Reset to defaults',
    },
  ];

  options.forEach((opt, i) => {
    const selected = i === filterSelectedIndex;
    const prefix = selected ? '> ' : '  ';
    content += `${prefix}${opt.label}\n`;
    content += `       ${opt.desc}\n\n`;
  });

  const currentMemories = getCurrentMemories ? getCurrentMemories() : [];
  const filtered = applyFilters(currentMemories);
  content += '─'.repeat(35) + '\n';
  content += `Showing ${filtered.length} of ${currentMemories.length} memories`;

  inputText.content = content;
}

/**
 * Handle filter mode input
 */
export async function handleFilterInput(key: KeyEvent): Promise<void> {
  if (key.name === 'escape') {
    exitFilterMode();
    return;
  }

  if (key.name === 'up') {
    filterSelectedIndex = Math.max(0, filterSelectedIndex - 1);
    updateFilterPanel();
  } else if (key.name === 'down') {
    filterSelectedIndex = Math.min(3, filterSelectedIndex + 1);
    updateFilterPanel();
  } else if (key.name === 'return' || key.name === 'space') {
    handleFilterSelection();
  }
}

/**
 * Handle filter selection
 */
function handleFilterSelection(): void {
  if (filterSelectedIndex === 0) {
    // Toggle hide retired
    filters.hideRetired = !filters.hideRetired;
    if (onFiltersChanged) onFiltersChanged();
    updateFilterPanel();
    if (onUpdateStatusBar) onUpdateStatusBar();
  } else if (filterSelectedIndex === 1) {
    // Cycle through type filters
    const types: (ObjectType | null)[] = [null, ...MEMORY_TYPES];
    const currentIdx = types.indexOf(filters.typeFilter);
    filters.typeFilter = types[(currentIdx + 1) % types.length];
    if (onFiltersChanged) onFiltersChanged();
    updateFilterPanel();
    if (onUpdateStatusBar) onUpdateStatusBar();
  } else if (filterSelectedIndex === 2) {
    // Cycle through review filters
    const reviews: ('pending' | 'approved' | 'rejected' | null)[] = [
      null,
      'pending',
      'approved',
      'rejected',
    ];
    const currentIdx = reviews.indexOf(filters.reviewFilter);
    filters.reviewFilter = reviews[(currentIdx + 1) % reviews.length];
    if (onFiltersChanged) onFiltersChanged();
    updateFilterPanel();
    if (onUpdateStatusBar) onUpdateStatusBar();
  } else if (filterSelectedIndex === 3) {
    // Clear all filters
    filters = { hideRetired: true, typeFilter: null, reviewFilter: null };
    if (onFiltersChanged) onFiltersChanged();
    updateFilterPanel();
    if (onUpdateStatusBar) onUpdateStatusBar();
    if (onShowFeedback) onShowFeedback('Filters cleared');
  }
}

/**
 * Exit filter mode
 */
function exitFilterMode(): void {
  if (inputPanel) {
    inputPanel.visible = false;
  }
  if (onExitMode) onExitMode();
}
