/**
 * Search View
 *
 * Search memories with hybrid lexical + semantic search.
 * Activated with 's' key.
 */

import type { KeyEvent, ScrollBoxRenderable, TextRenderable } from '@opentui/core';
import { Retriever } from '../../retriever/index.ts';
import { getConnection } from '../../stores/connection.ts';
import type { MemoryObject } from '../../types/memory-objects.ts';
import { TYPE_ABBREV } from '../utils/constants.ts';

// Module state
let currentProject: string | null = null;
let inputPanel: ScrollBoxRenderable | null = null;
let inputText: TextRenderable | null = null;

// Search mode state
let searchResults: MemoryObject[] = [];
let isSearching = false;
let inputBuffer = '';
const inputCursorVisible = true;

// Callbacks
let onExitMode: (() => void) | null = null;
let onShowFeedback: ((msg: string) => void) | null = null;
let onUpdateMemories: ((memories: MemoryObject[]) => void) | null = null;
let onUpdateDetailPanel: (() => void) | null = null;
let onUpdateStatusBar: (() => void) | null = null;
let onNavigateResult: ((index: number) => void) | null = null;

/**
 * Initialize view with TUI elements
 */
export function initSearchView(options: {
  project: string | null;
  inputPanelRef: ScrollBoxRenderable;
  inputTextRef: TextRenderable;
  exitModeCallback: () => void;
  showFeedbackCallback: (msg: string) => void;
  updateMemoriesCallback: (memories: MemoryObject[]) => void;
  updateDetailPanelCallback: () => void;
  updateStatusBarCallback: () => void;
  navigateResultCallback: (index: number) => void;
}): void {
  currentProject = options.project;
  inputPanel = options.inputPanelRef;
  inputText = options.inputTextRef;
  onExitMode = options.exitModeCallback;
  onShowFeedback = options.showFeedbackCallback;
  onUpdateMemories = options.updateMemoriesCallback;
  onUpdateDetailPanel = options.updateDetailPanelCallback;
  onUpdateStatusBar = options.updateStatusBarCallback;
  onNavigateResult = options.navigateResultCallback;
}

/**
 * Update project reference
 */
export function setSearchViewProject(project: string | null): void {
  currentProject = project;
}

/**
 * Enter search mode
 */
export function enterSearchMode(): void {
  inputBuffer = '';
  searchResults = [];
  showSearchPanel();
  updateSearchPanel();
}

/**
 * Show search panel
 */
function showSearchPanel(): void {
  if (inputPanel) {
    inputPanel.visible = true;
  }
}

/**
 * Update search panel content
 */
export function updateSearchPanel(): void {
  if (!inputText) return;

  const cursor = inputCursorVisible ? '|' : ' ';
  let content = 'SEARCH MEMORIES\n';
  content += '─'.repeat(35) + '\n\n';
  content += 'Enter your search query:\n\n';
  content += `> ${inputBuffer}${cursor}\n\n`;

  if (isSearching) {
    content += 'Searching...';
  } else if (inputBuffer.length === 0) {
    content += 'Tips:\n';
    content += '- Search by content, type, or keywords\n';
    content += '- Example: "database connection"\n';
    content += '- Example: "constraint ssl"\n';
  } else if (searchResults.length > 0) {
    content += `Found ${searchResults.length} result(s)\n\n`;
    // Show first few results inline
    const previewCount = Math.min(3, searchResults.length);
    for (let i = 0; i < previewCount; i++) {
      const m = searchResults[i];
      const abbrev = TYPE_ABBREV[m.objectType] || '???';
      content += `[${abbrev}] ${m.content.slice(0, 35)}...\n`;
    }
    if (searchResults.length > 3) {
      content += `   ...and ${searchResults.length - 3} more\n`;
    }
    content += '\nResults in left panel. [up/down] navigate, [Esc] close';
  } else if (inputBuffer.length > 0) {
    content += '[Enter] to search';
  }

  inputText.content = content;
}

/**
 * Handle search mode input
 */
export async function handleSearchInput(key: KeyEvent): Promise<void> {
  if (key.name === 'escape') {
    exitSearchMode();
    return;
  }

  if (key.name === 'return' && inputBuffer.length > 0) {
    await performSearch();
  } else if (key.name === 'backspace') {
    inputBuffer = inputBuffer.slice(0, -1);
    updateSearchPanel();
  } else if (key.name === 'up' && searchResults.length > 0) {
    // Navigate results while in search mode
    if (onNavigateResult) onNavigateResult(-1);
    if (onUpdateDetailPanel) onUpdateDetailPanel();
  } else if (key.name === 'down' && searchResults.length > 0) {
    if (onNavigateResult) onNavigateResult(1);
    if (onUpdateDetailPanel) onUpdateDetailPanel();
  } else if (key.sequence && key.sequence.length === 1 && !key.ctrl) {
    inputBuffer += key.sequence;
    updateSearchPanel();
  }
}

/**
 * Perform search
 */
async function performSearch(): Promise<void> {
  if (!currentProject || inputBuffer.length === 0) return;

  isSearching = true;
  updateSearchPanel();

  try {
    const db = getConnection(currentProject);
    const retriever = new Retriever(db);

    const results = await retriever.search(inputBuffer, { limit: 20 });
    searchResults = results.map((r) => r.object);

    if (searchResults.length === 0) {
      // No results - show message but don't change memory list
      isSearching = false;
      if (inputText) {
        let content = 'SEARCH MEMORIES\n';
        content += '─'.repeat(35) + '\n\n';
        content += `Query: ${inputBuffer}\n\n`;
        content += 'No results found.\n\n';
        content += 'Try different keywords or check spelling.';
        inputText.content = content;
      }
      return;
    }

    // Update memory list with search results
    if (onUpdateMemories) {
      onUpdateMemories(searchResults);
    }

    isSearching = false;
    updateSearchPanel();
    if (onUpdateStatusBar) onUpdateStatusBar();
  } catch (error) {
    isSearching = false;
    if (inputText) {
      inputText.content = `Search error: ${error}`;
    }
  }
}

/**
 * Exit search mode
 */
function exitSearchMode(): void {
  if (inputPanel) {
    inputPanel.visible = false;
  }
  if (onExitMode) onExitMode();
}

/**
 * Get search results
 */
export function getSearchResults(): MemoryObject[] {
  return searchResults;
}

/**
 * Clear search results
 */
export function clearSearchResults(): void {
  searchResults = [];
  inputBuffer = '';
}
