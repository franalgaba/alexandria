/**
 * Staleness checker - detects when memories are out of sync with code
 * 
 * Uses COMMIT-BASED checking to avoid noise during active development.
 * Memories are only marked stale when referenced files change in a COMMIT,
 * not on every file save.
 */

import type { Database } from 'bun:sqlite';
import type { CodeReference } from '../types/code-refs.ts';
import type { MemoryObject } from '../types/memory-objects.ts';
import { 
  fileExistsInRepo, 
  getCurrentCommit,
  hasFileChangedSince,
  isGitRepo,
} from '../code/git.ts';
import { contentMatches } from '../code/hashing.ts';
import { MemoryObjectStore } from '../stores/memory-objects.ts';

export type StalenessLevel = 'verified' | 'needs_review' | 'stale';

export interface StalenessResult {
  memoryId: string;
  memory: MemoryObject;
  level: StalenessLevel;
  isStale: boolean;  // Convenience: level !== 'verified'
  reasons: string[];
  changedRefs: CodeReference[];
  missingRefs: CodeReference[];
}

export interface StalenessCheckOptions {
  /** Project path to check against */
  projectPath?: string;
  /** Only check these memory IDs */
  memoryIds?: string[];
  /** Skip memories verified within this many hours */
  skipRecentlyVerified?: number;
  /** Include uncommitted changes in check (default: false) */
  includeUncommitted?: boolean;
}

export class StalenessChecker {
  private store: MemoryObjectStore;

  constructor(private db: Database) {
    this.store = new MemoryObjectStore(db);
  }

  /**
   * Check all memories with code refs for staleness
   */
  checkAll(options: StalenessCheckOptions = {}): StalenessResult[] {
    const projectPath = options.projectPath ?? process.cwd();
    const memories = this.store.getWithCodeRefs();
    const results: StalenessResult[] = [];

    for (const memory of memories) {
      // Skip if recently verified
      if (options.skipRecentlyVerified && memory.lastVerifiedAt) {
        const hoursSinceVerified = 
          (Date.now() - memory.lastVerifiedAt.getTime()) / (1000 * 60 * 60);
        if (hoursSinceVerified < options.skipRecentlyVerified) {
          continue;
        }
      }

      // Skip if specific IDs requested and this isn't one
      if (options.memoryIds && !options.memoryIds.includes(memory.id)) {
        continue;
      }

      const result = this.check(memory, projectPath, options.includeUncommitted);
      if (result.level !== 'verified') {
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Check a single memory for staleness
   */
  check(
    memory: MemoryObject, 
    projectPath: string = process.cwd(),
    includeUncommitted: boolean = false
  ): StalenessResult {
    const result: StalenessResult = {
      memoryId: memory.id,
      memory,
      level: 'verified',
      isStale: false,
      reasons: [],
      changedRefs: [],
      missingRefs: [],
    };

    if (memory.codeRefs.length === 0) {
      return result;
    }

    const inGitRepo = isGitRepo(projectPath);

    for (const ref of memory.codeRefs) {
      const checkResult = this.checkRef(ref, projectPath, inGitRepo, includeUncommitted);
      
      if (checkResult.level === 'stale') {
        result.missingRefs.push(ref);
        result.reasons.push(checkResult.reason);
        result.level = 'stale';
        result.isStale = true;
      } else if (checkResult.level === 'needs_review') {
        result.changedRefs.push(ref);
        result.reasons.push(checkResult.reason);
        // Only upgrade to needs_review if not already stale
        if (result.level !== 'stale') {
          result.level = 'needs_review';
          result.isStale = true;
        }
      }
    }

    return result;
  }

  /**
   * Check a single code reference
   */
  private checkRef(
    ref: CodeReference, 
    projectPath: string,
    inGitRepo: boolean,
    includeUncommitted: boolean
  ): { level: StalenessLevel; reason: string } {
    // Check if file exists
    if (!fileExistsInRepo(ref.path, projectPath)) {
      return {
        level: 'stale',
        reason: `File deleted: ${ref.path}`,
      };
    }

    // COMMIT-BASED CHECK (preferred)
    if (inGitRepo && ref.verifiedAtCommit) {
      if (hasFileChangedSince(ref.path, ref.verifiedAtCommit, projectPath)) {
        return {
          level: 'needs_review',
          reason: `${ref.path} changed since commit ${ref.verifiedAtCommit.substring(0, 7)}`,
        };
      }
      // File hasn't changed in any commit since verification
      return { level: 'verified', reason: '' };
    }

    // CONTENT HASH FALLBACK (for non-git repos or legacy refs)
    if (ref.contentHash && includeUncommitted) {
      if (!contentMatches(ref.path, ref.contentHash, projectPath)) {
        return {
          level: 'needs_review',
          reason: `${ref.path} content changed (uncommitted)`,
        };
      }
    }

    // No commit or hash to compare - can't detect staleness
    // This is a "weak" reference, treat as verified
    return { level: 'verified', reason: '' };
  }

  /**
   * Mark a memory as stale with reason
   */
  markStale(memoryId: string, reason: string): boolean {
    const memory = this.store.get(memoryId);
    if (!memory) return false;

    return this.store.markStale(memoryId);
  }

  /**
   * Mark a memory as verified (still accurate)
   * Updates verifiedAtCommit to current HEAD
   */
  markVerified(memoryId: string, projectPath: string = process.cwd()): MemoryObject | null {
    const memory = this.store.get(memoryId);
    if (!memory) return null;

    // Update code refs with current commit
    const currentCommit = getCurrentCommit(projectPath);
    if (currentCommit && memory.codeRefs.length > 0) {
      const updatedRefs = memory.codeRefs.map(ref => ({
        ...ref,
        verifiedAtCommit: currentCommit,
      }));
      this.store.update(memoryId, { codeRefs: updatedRefs });
    }

    return this.store.verify(memoryId);
  }

  /**
   * Auto-verify memories whose files haven't changed
   * Useful after a commit - verify all memories that weren't affected
   */
  autoVerifyUnchanged(projectPath: string = process.cwd()): number {
    const memories = this.store.getWithCodeRefs();
    const currentCommit = getCurrentCommit(projectPath);
    if (!currentCommit) return 0;

    let verified = 0;

    for (const memory of memories) {
      const result = this.check(memory, projectPath);
      
      // If verified (no changes), update to current commit
      if (result.level === 'verified') {
        const updatedRefs = memory.codeRefs.map(ref => ({
          ...ref,
          verifiedAtCommit: currentCommit,
        }));
        this.store.update(memory.id, { 
          codeRefs: updatedRefs,
          lastVerifiedAt: new Date(),
        });
        verified++;
      }
    }

    return verified;
  }

  /**
   * Get summary of stale memories
   */
  getSummary(projectPath: string = process.cwd()): {
    total: number;
    verified: number;
    needsReview: number;
    stale: number;
    results: StalenessResult[];
  } {
    const memories = this.store.getWithCodeRefs();
    const allResults: StalenessResult[] = [];
    
    let verified = 0;
    let needsReview = 0;
    let stale = 0;

    for (const memory of memories) {
      const result = this.check(memory, projectPath);
      allResults.push(result);
      
      switch (result.level) {
        case 'verified':
          verified++;
          break;
        case 'needs_review':
          needsReview++;
          break;
        case 'stale':
          stale++;
          break;
      }
    }

    return {
      total: memories.length,
      verified,
      needsReview,
      stale,
      results: allResults.filter(r => r.level !== 'verified'),
    };
  }
}
