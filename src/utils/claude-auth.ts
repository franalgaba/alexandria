/**
 * Claude Code OAuth Token Extraction
 *
 * Extracts the OAuth token from Claude Code's keychain storage
 * to enable background Haiku calls without requiring a separate API key.
 */

import { $ } from 'bun';

interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
  };
}

/**
 * Get the Claude OAuth token from macOS keychain
 * Returns null if not available (not on macOS or not logged in)
 */
export async function getClaudeOAuthToken(): Promise<string | null> {
  // Only works on macOS
  if (process.platform !== 'darwin') {
    return null;
  }

  try {
    // Extract from macOS keychain
    const result = await $`security find-generic-password -s "Claude Code-credentials" -w`.quiet();
    const credentialsJson = result.text().trim();

    if (!credentialsJson) {
      return null;
    }

    const credentials: ClaudeCredentials = JSON.parse(credentialsJson);

    if (credentials.claudeAiOauth?.accessToken) {
      return credentials.claudeAiOauth.accessToken;
    }

    return null;
  } catch (error) {
    // Keychain access failed (not found, locked, etc.)
    return null;
  }
}

/**
 * Check if Claude OAuth token is available
 */
export async function hasClaudeOAuth(): Promise<boolean> {
  const token = await getClaudeOAuthToken();
  return token !== null;
}

/**
 * Get API key for Anthropic calls
 * Priority: 1. ANTHROPIC_API_KEY env var, 2. Claude OAuth token
 */
export async function getAnthropicApiKey(): Promise<string | null> {
  // First check environment variable
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) {
    return envKey;
  }

  // Fall back to Claude OAuth token
  return getClaudeOAuthToken();
}

/**
 * Check if the token is an OAuth token (vs regular API key)
 */
export function isOAuthToken(token: string): boolean {
  return token.startsWith('sk-ant-oat');
}
