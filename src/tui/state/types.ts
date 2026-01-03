/**
 * TUI State Types
 */

import type { CliRenderer, SelectOption, TabSelectOption } from '@opentui/core';
import type { Conflict } from '../../ingestor/conflict-detector.ts';
import type { ContextLevel } from '../../retriever/progressive.ts';
import type { ScopeType } from '../../types/common.ts';
import type {
  Confidence,
  ConfidenceTier,
  MemoryObject,
  ObjectType,
} from '../../types/memory-objects.ts';
import type { ReviewQueueItem } from '../../types/retriever.ts';
import type { UsageSummary } from '../../utils/cost-tracker.ts';

// Input modes
export type InputMode =
  | 'normal'
  | 'add'
  | 'search'
  | 'pack'
  | 'filter'
  | 'conflicts'
  | 'stats'
  | 'context'
  | 'costs' // NEW
  | 'review'; // NEW

export type ViewMode = 'list' | 'detail' | 'trail';

// Add mode types
export type AddStep = 'content' | 'type' | 'confidence' | 'scope' | 'approve' | 'confirm';

export interface AddModeState {
  step: AddStep;
  data: {
    content: string;
    type: ObjectType;
    confidence: Confidence;
    scope: ScopeType;
    autoApprove: boolean;
  };
  selectedIndex: number;
}

// Search mode state
export interface SearchModeState {
  results: MemoryObject[];
  isSearching: boolean;
}

// Pack mode state
export interface PackModeState {
  selectedLevel: number;
  output: string;
}

// Filter state
export interface FilterState {
  hideRetired: boolean;
  typeFilter: ObjectType | null;
  reviewFilter: 'pending' | 'approved' | 'rejected' | null;
}

// Conflicts mode state
export interface ConflictsModeState {
  conflicts: Conflict[];
  selectedIndex: number;
}

// Stats mode state
export interface StatsModeState {
  output: string;
}

// Context viewer state
export interface ContextModeState {
  output: string;
  history: ContextInjection[];
}

export interface ContextInjection {
  timestamp: Date;
  level: ContextLevel | 'custom';
  tokensUsed: number;
  tokenBudget: number;
  memoriesIncluded: number;
  tierBreakdown: { grounded: number; observed: number; inferred: number };
  sessionId?: string;
  trigger: 'auto' | 'manual' | 'checkpoint';
}

// Quality metrics
export interface QualityMetrics {
  healthScore: number;
  codeRefRate: number;
  approvedRate: number;
  staleness: { verified: number; needsReview: number; stale: number };
}

// Context health metrics
export interface ContextHealthMetrics {
  avgTokensPerInjection: number;
  avgMemoriesPerInjection: number;
  injectionCount: number;
  groundedRatio: number;
  lastInjectionTime: Date | null;
}

// Debug console types
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

export interface DebugState {
  visible: boolean;
  logs: DebugLogEntry[];
  lastSeenEventId: string | null;
  lastSeenMemoryCount: number;
  panelHeightPercent: number;
  isResizing: boolean;
  lastMouseY: number;
}

// NEW: Costs mode state
export interface CostsModeState {
  sessionSummary: UsageSummary | null;
  dailySummary: UsageSummary | null;
  budgetStatus: BudgetStatus | null;
  selectedView: 'overview' | 'breakdown' | 'history';
}

export interface BudgetStatus {
  session: { used: number; limit: number; percent: number };
  daily: { used: number; limit: number; percent: number };
  tokens: { used: number; limit: number; percent: number };
}

// NEW: Review mode state
export interface ReviewModeState {
  items: ReviewQueueItem[];
  selectedIndex: number;
  isLoading: boolean;
}

// NEW: Checkpoint status
export interface CheckpointStatus {
  eventsSinceCheckpoint: number;
  checkpointThreshold: number;
  timeSinceLastCheckpoint: number;
  isExtracting: boolean;
  lastCheckpointAt: Date | null;
}

// UI Component references
export interface UIComponents {
  projectTabs: any;
  memoryList: any;
  detailPanel: any;
  detailText: any;
  trailPanel: any;
  trailText: any;
  statusBar: any;
  helpText: any;
  inputPanel: any;
  inputText: any;
  contextPanel: any;
  contextHeaderText: any;
  contextLevelsText: any;
  contextTiersText: any;
  contextHealthText: any;
  contextHistoryText: any;
  debugPanel: any;
  debugText: any;
}
