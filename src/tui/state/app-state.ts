/**
 * Centralized TUI Application State
 *
 * Singleton pattern for managing all TUI state in one place.
 * Replaces the module-level variables from the original monolithic file.
 */

import type { CliRenderer } from '@opentui/core';
import type { Conflict } from '../../ingestor/conflict-detector.ts';
import type { ScopeType } from '../../types/common.ts';
import type { Confidence, MemoryObject, ObjectType } from '../../types/memory-objects.ts';
import { DEBUG_PANEL_DEFAULT_HEIGHT, MAX_DEBUG_LOGS } from '../utils/constants.ts';
import type {
  AddModeState,
  CheckpointStatus,
  ConflictsModeState,
  ContextHealthMetrics,
  ContextModeState,
  CostsModeState,
  DebugState,
  FilterState,
  InputMode,
  PackModeState,
  QualityMetrics,
  ReviewModeState,
  SearchModeState,
  StatsModeState,
  UIComponents,
  ViewMode,
} from './types.ts';

class AppState {
  private static instance: AppState;

  // Renderer
  renderer: CliRenderer | null = null;

  // Core state
  currentProject: string | null = null;
  currentMemories: MemoryObject[] = [];
  originalMemories: MemoryObject[] = []; // For restoring after search
  selectedMemoryIndex = 0;
  viewMode: ViewMode = 'list';

  // Input state
  inputMode: InputMode = 'normal';
  inputBuffer = '';
  inputCursorVisible = true;
  filterSelectedIndex = 0;

  // Mode-specific state
  add: AddModeState = {
    step: 'content',
    data: {
      content: '',
      type: 'decision',
      confidence: 'medium',
      scope: 'project',
      autoApprove: false,
    },
    selectedIndex: 0,
  };

  search: SearchModeState = {
    results: [],
    isSearching: false,
  };

  pack: PackModeState = {
    selectedLevel: 0,
    output: '',
  };

  filter: FilterState = {
    hideRetired: true,
    typeFilter: null,
    reviewFilter: null,
  };

  conflicts: ConflictsModeState = {
    conflicts: [],
    selectedIndex: 0,
  };

  stats: StatsModeState = {
    output: '',
  };

  context: ContextModeState = {
    output: '',
    history: [],
  };

  // NEW: Costs mode state
  costs: CostsModeState = {
    sessionSummary: null,
    dailySummary: null,
    budgetStatus: null,
    selectedView: 'overview',
  };

  // NEW: Review mode state
  review: ReviewModeState = {
    items: [],
    selectedIndex: 0,
    isLoading: false,
  };

  // NEW: Checkpoint status
  checkpoint: CheckpointStatus = {
    eventsSinceCheckpoint: 0,
    checkpointThreshold: 10,
    timeSinceLastCheckpoint: 0,
    isExtracting: false,
    lastCheckpointAt: null,
  };

  // Cached metrics
  qualityMetrics: QualityMetrics | null = null;
  contextHealthMetrics: ContextHealthMetrics | null = null;

  // Debug console state
  debug: DebugState = {
    visible: true,
    logs: [],
    lastSeenEventId: null,
    lastSeenMemoryCount: 0,
    panelHeightPercent: DEBUG_PANEL_DEFAULT_HEIGHT,
    isResizing: false,
    lastMouseY: 0,
  };

  // UI component references (set during initialization)
  components: UIComponents = {} as UIComponents;

  // Intervals
  refreshInterval: ReturnType<typeof setInterval> | null = null;
  debugRefreshInterval: ReturnType<typeof setInterval> | null = null;

  // Exit flag
  isExiting = false;

  // Feedback message
  feedbackMessage = '';
  feedbackTimeout: ReturnType<typeof setTimeout> | null = null;

  private constructor() {}

  static getInstance(): AppState {
    if (!AppState.instance) {
      AppState.instance = new AppState();
    }
    return AppState.instance;
  }

  /**
   * Reset to initial state (useful for testing)
   */
  reset(): void {
    this.currentProject = null;
    this.currentMemories = [];
    this.originalMemories = [];
    this.selectedMemoryIndex = 0;
    this.viewMode = 'list';
    this.inputMode = 'normal';
    this.inputBuffer = '';
    this.resetAddState();
    this.resetSearchState();
    this.resetPackState();
    this.resetCostsState();
    this.resetReviewState();
  }

  /**
   * Enter a specific mode with proper state initialization
   */
  enterMode(mode: InputMode): void {
    this.inputMode = mode;
    this.inputBuffer = '';

    switch (mode) {
      case 'add':
        this.resetAddState();
        break;
      case 'search':
        this.resetSearchState();
        break;
      case 'pack':
        this.resetPackState();
        break;
      case 'costs':
        this.resetCostsState();
        break;
      case 'review':
        this.resetReviewState();
        break;
    }
  }

  /**
   * Exit current mode and return to normal
   */
  exitMode(): void {
    // Restore original memories if we were in search mode
    if (this.inputMode === 'search' && this.originalMemories.length > 0) {
      this.currentMemories = this.originalMemories;
      this.originalMemories = [];
    }

    this.inputMode = 'normal';
    this.inputBuffer = '';
  }

  // State reset helpers
  resetAddState(): void {
    this.add = {
      step: 'content',
      data: {
        content: '',
        type: 'decision',
        confidence: 'medium',
        scope: 'project',
        autoApprove: false,
      },
      selectedIndex: 0,
    };
  }

  resetSearchState(): void {
    this.search = {
      results: [],
      isSearching: false,
    };
  }

  resetPackState(): void {
    this.pack = {
      selectedLevel: 0,
      output: '',
    };
  }

  resetCostsState(): void {
    this.costs = {
      sessionSummary: null,
      dailySummary: null,
      budgetStatus: null,
      selectedView: 'overview',
    };
  }

  resetReviewState(): void {
    this.review = {
      items: [],
      selectedIndex: 0,
      isLoading: false,
    };
  }

  /**
   * Add a debug log entry
   */
  addDebugLog(type: DebugState['logs'][0]['type'], message: string, details?: string): void {
    this.debug.logs.push({
      timestamp: new Date(),
      type,
      message: message.slice(0, 200),
      details: details?.slice(0, 500),
    });

    // Keep bounded
    if (this.debug.logs.length > MAX_DEBUG_LOGS) {
      this.debug.logs = this.debug.logs.slice(-MAX_DEBUG_LOGS);
    }
  }

  /**
   * Show feedback message
   */
  showFeedback(message: string, durationMs: number = 2000): void {
    this.feedbackMessage = message;

    if (this.feedbackTimeout) {
      clearTimeout(this.feedbackTimeout);
    }

    this.feedbackTimeout = setTimeout(() => {
      this.feedbackMessage = '';
      this.feedbackTimeout = null;
    }, durationMs);
  }

  /**
   * Cleanup intervals on exit
   */
  cleanup(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    if (this.debugRefreshInterval) {
      clearInterval(this.debugRefreshInterval);
      this.debugRefreshInterval = null;
    }
    if (this.feedbackTimeout) {
      clearTimeout(this.feedbackTimeout);
      this.feedbackTimeout = null;
    }
  }
}

// Export singleton instance
export const state = AppState.getInstance();

// Export class for testing
export { AppState };
