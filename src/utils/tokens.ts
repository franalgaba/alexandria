/**
 * Token extraction and counting utilities
 */

import { createHash } from 'node:crypto';

/**
 * Estimate token count (rough approximation: ~4 chars per token)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Hash content for deduplication
 */
export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').substring(0, 16);
}

/**
 * Token patterns for extraction
 */
const TOKEN_PATTERNS = {
  // camelCase or PascalCase identifiers
  identifier: /\b[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*\b|\b[A-Z][a-z]+[A-Z][a-zA-Z0-9]*\b/g,
  // snake_case identifiers
  snakeCase: /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g,
  // File paths
  path: /(?:\/[\w.-]+)+(?:\.\w+)?|\b[\w.-]+\/[\w./-]+/g,
  // CLI commands with flags
  command: /\b(?:npm|yarn|bun|pnpm|cargo|uv|pip|git|docker|kubectl)\s+[a-z-]+/gi,
  // CLI flags
  flag: /--?[a-z][a-z0-9-]*/gi,
  // Semver patterns
  version: /\b\d+\.\d+(?:\.\d+)?(?:-[a-z0-9.]+)?\b/gi,
  // Error codes
  errorCode: /\b(?:E|ERR_?|ERROR_?)[A-Z0-9_]+\b|\bEXIT_?\d+\b/g,
  // Environment variables
  envVar: /\b[A-Z][A-Z0-9_]+(?=\s*=|\b)/g,
};

export type TokenType = 'identifier' | 'path' | 'command' | 'version' | 'error_code' | 'flag';

export interface ExtractedToken {
  token: string;
  type: TokenType;
}

/**
 * Extract significant tokens from text
 */
export function extractTokens(text: string): ExtractedToken[] {
  const tokens: ExtractedToken[] = [];
  const seen = new Set<string>();

  const addToken = (token: string, type: TokenType) => {
    const normalized = token.toLowerCase();
    if (!seen.has(normalized) && token.length >= 2) {
      seen.add(normalized);
      tokens.push({ token, type });
    }
  };

  // Extract identifiers (camelCase, snake_case)
  const identifiers = text.match(TOKEN_PATTERNS.identifier) || [];
  const snakeCases = text.match(TOKEN_PATTERNS.snakeCase) || [];
  for (const id of [...identifiers, ...snakeCases]) {
    addToken(id, 'identifier');
  }

  // Extract paths
  const paths = text.match(TOKEN_PATTERNS.path) || [];
  for (const path of paths) {
    addToken(path, 'path');
  }

  // Extract commands
  const commands = text.match(TOKEN_PATTERNS.command) || [];
  for (const cmd of commands) {
    addToken(cmd, 'command');
  }

  // Extract flags
  const flags = text.match(TOKEN_PATTERNS.flag) || [];
  for (const flag of flags) {
    addToken(flag, 'flag');
  }

  // Extract versions
  const versions = text.match(TOKEN_PATTERNS.version) || [];
  for (const ver of versions) {
    addToken(ver, 'version');
  }

  // Extract error codes
  const errorCodes = text.match(TOKEN_PATTERNS.errorCode) || [];
  for (const code of errorCodes) {
    addToken(code, 'error_code');
  }

  return tokens;
}
