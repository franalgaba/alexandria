/**
 * Types for the retrieval system
 */

import type { RevalidationPrompt } from '../utils/revalidation.ts';
import type { MemoryObject } from './memory-objects.ts';
import type { PreviousSessionContext } from './sessions.ts';

/** Legacy context pack format */
export interface LegacyContextPack {
  tokenCount: number;
  tokenBudget: number;
  previousSession?: PreviousSessionContext;
  constraints: MemoryObject[];
  relevantObjects: MemoryObject[];
  overflowCount: number;
  /** Memories that need revalidation */
  revalidationPrompts?: RevalidationPrompt[];
}

/** Progressive context pack format */
export interface ProgressiveContextPack {
  objects: MemoryObject[];
  totalCount: number;
  truncated: boolean;
  metadata?: {
    level: 'minimal' | 'task' | 'deep';
    tokensUsed: number;
    tokenBudget: number;
    breakdown?: {
      grounded: number;
      observed: number;
      inferred: number;
      hypothesis: number;
    };
  };
}

/** Context pack - can be either legacy or progressive format */
export type ContextPack = LegacyContextPack | ProgressiveContextPack;

/** Type guard for legacy format */
export function isLegacyPack(pack: ContextPack): pack is LegacyContextPack {
  return 'constraints' in pack;
}

/** Type guard for progressive format */
export function isProgressivePack(pack: ContextPack): pack is ProgressiveContextPack {
  return 'objects' in pack && !('constraints' in pack);
}

export interface SearchResult {
  object: MemoryObject;
  score: number;
  matchType: 'lexical' | 'vector' | 'hybrid';
  highlights?: string[];
}

export interface FTSResult {
  id: string;
  score: number;
  highlight?: string;
}

export interface VectorResult {
  id: string;
  distance: number;
}

export interface ReviewQueueItem {
  object: MemoryObject;
  suggestedAction: 'approve' | 'edit' | 'merge' | 'supersede' | 'reject';
  reason: string;
  similarObjects?: MemoryObject[];
}
