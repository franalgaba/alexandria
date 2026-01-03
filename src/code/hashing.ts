/**
 * Content hashing for change detection
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getGitRoot } from './git.ts';

/**
 * Hash a string content using SHA-256, truncated to 16 chars
 */
export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').substring(0, 16);
}

/**
 * Hash file content
 * Returns null if file doesn't exist
 */
export function hashFileContent(
  filePath: string,
  projectPath: string = process.cwd(),
): string | null {
  try {
    const gitRoot = getGitRoot(projectPath) ?? projectPath;
    const fullPath = filePath.startsWith('/') ? filePath : join(gitRoot, filePath);

    if (!existsSync(fullPath)) {
      return null;
    }

    const content = readFileSync(fullPath, 'utf-8');
    return hashContent(content);
  } catch {
    return null;
  }
}

/**
 * Hash a specific line range of a file
 */
export function hashLineRange(
  filePath: string,
  startLine: number,
  endLine: number,
  projectPath: string = process.cwd(),
): string | null {
  try {
    const gitRoot = getGitRoot(projectPath) ?? projectPath;
    const fullPath = filePath.startsWith('/') ? filePath : join(gitRoot, filePath);

    if (!existsSync(fullPath)) {
      return null;
    }

    const content = readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');

    // Lines are 1-indexed
    const selectedLines = lines.slice(startLine - 1, endLine);
    return hashContent(selectedLines.join('\n'));
  } catch {
    return null;
  }
}

/**
 * Check if file content matches a known hash
 */
export function contentMatches(
  filePath: string,
  expectedHash: string,
  projectPath: string = process.cwd(),
): boolean {
  const currentHash = hashFileContent(filePath, projectPath);
  return currentHash === expectedHash;
}

/**
 * Check if a line range matches a known hash
 */
export function lineRangeMatches(
  filePath: string,
  startLine: number,
  endLine: number,
  expectedHash: string,
  projectPath: string = process.cwd(),
): boolean {
  const currentHash = hashLineRange(filePath, startLine, endLine, projectPath);
  return currentHash === expectedHash;
}

/**
 * Get content hash and snippet for a file
 */
export function getFileSnapshot(
  filePath: string,
  projectPath: string = process.cwd(),
): { hash: string; size: number; lines: number } | null {
  try {
    const gitRoot = getGitRoot(projectPath) ?? projectPath;
    const fullPath = filePath.startsWith('/') ? filePath : join(gitRoot, filePath);

    if (!existsSync(fullPath)) {
      return null;
    }

    const content = readFileSync(fullPath, 'utf-8');
    return {
      hash: hashContent(content),
      size: content.length,
      lines: content.split('\n').length,
    };
  } catch {
    return null;
  }
}
