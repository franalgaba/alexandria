/**
 * Git integration for code truth tracking
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Find the git root directory
 */
export function getGitRoot(startPath: string = process.cwd()): string | null {
  try {
    const result = execSync('git rev-parse --show-toplevel', {
      cwd: startPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim();
  } catch {
    return null;
  }
}

/**
 * Check if a path is inside a git repository
 */
export function isGitRepo(path: string = process.cwd()): boolean {
  return getGitRoot(path) !== null;
}

/**
 * Get the current HEAD commit hash
 */
export function getCurrentCommit(projectPath: string = process.cwd()): string | null {
  try {
    const result = execSync('git rev-parse HEAD', {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim();
  } catch {
    return null;
  }
}

/**
 * Get short commit hash (7 chars)
 */
export function getShortCommit(projectPath: string = process.cwd()): string | null {
  const full = getCurrentCommit(projectPath);
  return full ? full.substring(0, 7) : null;
}

/**
 * Get list of files changed since a specific commit
 */
export function getChangedFilesSince(
  commit: string,
  projectPath: string = process.cwd(),
): string[] {
  try {
    const result = execSync(`git diff --name-only ${commit} HEAD`, {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result
      .trim()
      .split('\n')
      .filter((f) => f.length > 0);
  } catch {
    return [];
  }
}

/**
 * Check if a specific file has changed since a commit
 */
export function hasFileChangedSince(
  filePath: string,
  commit: string,
  projectPath: string = process.cwd(),
): boolean {
  const changedFiles = getChangedFilesSince(commit, projectPath);
  const normalizedPath = filePath.startsWith('/') ? filePath : resolve(projectPath, filePath);
  const gitRoot = getGitRoot(projectPath);

  if (!gitRoot) return false;

  // Convert to relative path from git root
  const relativePath = normalizedPath.replace(gitRoot + '/', '');

  return changedFiles.includes(relativePath) || changedFiles.includes(filePath);
}

/**
 * Get the content of a file at a specific commit
 */
export function getFileAtCommit(
  filePath: string,
  commit: string,
  projectPath: string = process.cwd(),
): string | null {
  try {
    const result = execSync(`git show ${commit}:${filePath}`, {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result;
  } catch {
    return null;
  }
}

/**
 * Check if a file exists in the current working tree
 */
export function fileExistsInRepo(filePath: string, projectPath: string = process.cwd()): boolean {
  const gitRoot = getGitRoot(projectPath);
  if (!gitRoot) return false;

  const fullPath = filePath.startsWith('/') ? filePath : join(gitRoot, filePath);

  return existsSync(fullPath);
}

/**
 * Get the commit where a file was last modified
 */
export function getLastModifiedCommit(
  filePath: string,
  projectPath: string = process.cwd(),
): string | null {
  try {
    const result = execSync(`git log -1 --format=%H -- ${filePath}`, {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Get relative path from git root
 */
export function getRelativePath(
  absolutePath: string,
  projectPath: string = process.cwd(),
): string | null {
  const gitRoot = getGitRoot(projectPath);
  if (!gitRoot) return null;

  if (absolutePath.startsWith(gitRoot)) {
    return absolutePath.substring(gitRoot.length + 1);
  }

  return absolutePath;
}

/**
 * Resolve a path relative to git root
 */
export function resolveFromGitRoot(
  relativePath: string,
  projectPath: string = process.cwd(),
): string | null {
  const gitRoot = getGitRoot(projectPath);
  if (!gitRoot) return null;

  return join(gitRoot, relativePath);
}
