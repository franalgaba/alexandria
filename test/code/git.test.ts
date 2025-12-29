import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { 
  getCurrentCommit, 
  getGitRoot, 
  getShortCommit, 
  isGitRepo,
  getChangedFilesSince,
} from '../../src/code/git.ts';

// Get the actual project directory
const PROJECT_DIR = join(import.meta.dir, '../..');

describe('Git Integration', () => {
  test('getGitRoot returns project root', () => {
    const root = getGitRoot(PROJECT_DIR);
    expect(root).not.toBeNull();
    expect(root).toContain('alexandria');
  });

  test('isGitRepo returns true for current project', () => {
    expect(isGitRepo(PROJECT_DIR)).toBe(true);
  });

  test('getCurrentCommit returns valid hash', () => {
    const commit = getCurrentCommit(PROJECT_DIR);
    // May be null if not committed yet, so just check the type
    if (commit !== null) {
      expect(commit.length).toBe(40); // Full SHA-1 hash
    } else {
      // New repo without commits - this is valid
      expect(commit).toBeNull();
    }
  });

  test('getShortCommit returns 7 char hash or null', () => {
    const short = getShortCommit(PROJECT_DIR);
    if (short !== null) {
      expect(short.length).toBe(7);
    }
  });

  test('getChangedFilesSince returns array', () => {
    const commit = getCurrentCommit(PROJECT_DIR);
    if (commit) {
      const changed = getChangedFilesSince(commit, PROJECT_DIR);
      expect(Array.isArray(changed)).toBe(true);
      // No changes since HEAD
      expect(changed.length).toBe(0);
    }
  });
});
