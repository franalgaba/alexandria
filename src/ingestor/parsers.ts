/**
 * Parsers for extracting structured data from agent output
 */

/**
 * Extract file paths from content
 */
export function extractFilePaths(content: string): string[] {
  const paths = new Set<string>();

  // Unix-style paths
  const unixPaths = content.match(/(?:\/[\w.-]+)+(?:\.\w+)?/g) || [];
  for (const p of unixPaths) {
    if (p.length > 2 && !p.startsWith('//')) {
      paths.add(p);
    }
  }

  // Relative paths with extensions
  const relPaths = content.match(/\b[\w.-]+\/[\w./-]+\.\w+/g) || [];
  for (const p of relPaths) {
    paths.add(p);
  }

  return Array.from(paths);
}

/**
 * Extract error codes from content
 */
export function extractErrorCodes(content: string): string[] {
  const codes = new Set<string>();

  // Standard error patterns
  const patterns = [
    /\b(?:E|ERR_?|ERROR_?)[A-Z0-9_]+\b/g,
    /\bEXIT_?\d+\b/g,
    /\berror\s*code[:\s]+(\w+)/gi,
    /\berrno[:\s]+(\d+)/gi,
  ];

  for (const pattern of patterns) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      codes.add(match[1] || match[0]);
    }
  }

  return Array.from(codes);
}

/**
 * Extract command invocations from content
 */
export function extractCommands(content: string): string[] {
  const commands = new Set<string>();

  // Shell command patterns
  const cmdPatterns = [
    /^\s*\$\s+(.+)$/gm,
    /^\s*>\s+(.+)$/gm,
    /```(?:bash|sh|shell|zsh)\n([\s\S]*?)```/g,
    /`([a-z][\w-]*(?:\s+[\w./-]+)*)`/g,
  ];

  for (const pattern of cmdPatterns) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      const cmd = (match[1] || match[0]).trim();
      if (cmd.length > 2 && cmd.length < 200) {
        commands.add(cmd);
      }
    }
  }

  return Array.from(commands);
}

/**
 * Extract version numbers from content
 */
export function extractVersions(content: string): { package: string; version: string }[] {
  const versions: { package: string; version: string }[] = [];

  // npm/yarn/bun style: package@version
  const npmStyle = content.matchAll(/\b([\w@/-]+)@(\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?)\b/g);
  for (const match of npmStyle) {
    versions.push({ package: match[1], version: match[2] });
  }

  // Python style: package==version
  const pyStyle = content.matchAll(/\b([\w-]+)==(\d+\.\d+(?:\.\d+)?(?:\.\w+)?)\b/g);
  for (const match of pyStyle) {
    versions.push({ package: match[1], version: match[2] });
  }

  return versions;
}

/**
 * Parse test output into structured summary
 */
export function parseTestOutput(content: string): {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
} | null {
  // Try different test output formats

  // Jest/Vitest style: Tests: 10 passed, 2 failed, 12 total
  const jestMatch = content.match(
    /Tests?:\s*(?:(\d+)\s*passed)?[,\s]*(?:(\d+)\s*failed)?[,\s]*(?:(\d+)\s*skipped)?[,\s]*(?:(\d+)\s*total)?/i,
  );
  if (jestMatch) {
    return {
      passed: Number.parseInt(jestMatch[1] || '0', 10),
      failed: Number.parseInt(jestMatch[2] || '0', 10),
      skipped: Number.parseInt(jestMatch[3] || '0', 10),
      total: Number.parseInt(jestMatch[4] || '0', 10),
    };
  }

  // pytest style: 10 passed, 2 failed in 5.32s
  const pytestMatch = content.match(
    /(\d+)\s+passed(?:[,\s]+(\d+)\s+failed)?(?:[,\s]+(\d+)\s+skipped)?/i,
  );
  if (pytestMatch) {
    const passed = Number.parseInt(pytestMatch[1], 10);
    const failed = Number.parseInt(pytestMatch[2] || '0', 10);
    const skipped = Number.parseInt(pytestMatch[3] || '0', 10);
    return {
      passed,
      failed,
      skipped,
      total: passed + failed + skipped,
    };
  }

  return null;
}

/**
 * Sanitize content for storage (remove sensitive data)
 */
export function sanitizeContent(content: string): string {
  // Remove potential API keys
  let sanitized = content.replace(
    /\b(?:sk-|api[_-]?key|token|secret|password|auth)[_-]?[a-zA-Z0-9]{20,}/gi,
    '[REDACTED]',
  );

  // Remove potential bearer tokens
  sanitized = sanitized.replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [REDACTED]');

  // Remove AWS keys
  sanitized = sanitized.replace(/AKIA[A-Z0-9]{16}/g, '[REDACTED_AWS_KEY]');

  return sanitized;
}
