/**
 * Token extraction and counting utilities
 */

import { createHash } from 'node:crypto';

type Tokenizer = (text: string) => Promise<{ input_ids?: { size?: number; data?: unknown[] } }>;

let tokenizer: Tokenizer | null = null;
let tokenizerPromise: Promise<Tokenizer | null> | null = null;
let tokenizerUnavailable = false;

const TOKENIZER_PATH = process.env.ALEXANDRIA_TOKENIZER_PATH;

/**
 * Estimate token count (rough approximation; use estimateTokensAsync when possible)
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const rough = Math.ceil(text.length / 4);
  const chunks = text.trim().split(/\s+/).filter((chunk) => chunk.length > 0);
  if (chunks.length === 0) return 0;

  const chunkAdjusted = chunks.reduce(
    (sum, chunk) => sum + Math.max(1, Math.ceil(chunk.length / 4)),
    0,
  );
  return Math.max(rough, chunkAdjusted);
}

/**
 * Estimate token count using a local tokenizer if available
 */
export async function estimateTokensAsync(text: string): Promise<number> {
  if (!text) return 0;

  const tokenizerInstance = await getTokenizer();
  if (tokenizerInstance) {
    try {
      const encoded = await tokenizerInstance(text);
      const inputIds = encoded?.input_ids;
      const tokenCount =
        (inputIds?.size ??
          inputIds?.data?.length ??
          (Array.isArray(inputIds) ? inputIds.length : 0)) ||
        0;
      if (tokenCount > 0) {
        return tokenCount;
      }
    } catch {
      // Fall back to rough estimate
    }
  }

  return estimateTokens(text);
}

async function getTokenizer(): Promise<Tokenizer | null> {
  if (tokenizer) return tokenizer;
  if (tokenizerUnavailable) return null;
  if (tokenizerPromise) return tokenizerPromise;
  if (!TOKENIZER_PATH) return null;

  tokenizerPromise = (async () => {
    try {
      const { AutoTokenizer } = await import('@xenova/transformers');
      const loaded = await AutoTokenizer.from_pretrained(TOKENIZER_PATH, {
        local_files_only: true,
      });

      tokenizer = async (text: string) => loaded(text);
      return tokenizer;
    } catch {
      tokenizerUnavailable = true;
      return null;
    } finally {
      tokenizerPromise = null;
    }
  })();

  return tokenizerPromise;
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
