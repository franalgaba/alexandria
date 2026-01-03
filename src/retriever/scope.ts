/**
 * Scope extraction from queries
 *
 * Extracts file/module scope hints from natural language queries.
 */

import type { Scope, ScopeType } from '../types/common.ts';

export interface ExtractedScope {
  scope: Scope;
  confidence: 'high' | 'medium' | 'low';
  matchedText: string;
}

// Pattern for file paths
const FILE_PATH_PATTERN =
  /(?:in\s+|file\s+|from\s+)?([a-zA-Z0-9_\-./]+\.(ts|js|tsx|jsx|py|rs|go|java|rb|cpp|c|h|md|json|yaml|yml|toml|sql))/gi;

// Pattern for module/directory references
const MODULE_PATTERN =
  /(?:in\s+(?:the\s+)?|the\s+)([a-zA-Z0-9_-]+)\s+(?:module|directory|folder|package|component|service)/gi;

// Pattern for code area references
const AREA_PATTERN = /(?:in\s+|the\s+)?([a-zA-Z0-9_-]+)\s+(?:code|logic|layer|part)/gi;

// Common module/area names
const KNOWN_AREAS = [
  'auth',
  'authentication',
  'authorization',
  'api',
  'rest',
  'graphql',
  'database',
  'db',
  'storage',
  'store',
  'stores',
  'ui',
  'frontend',
  'client',
  'components',
  'backend',
  'server',
  'service',
  'services',
  'test',
  'tests',
  'testing',
  'utils',
  'helpers',
  'lib',
  'common',
  'shared',
  'config',
  'configuration',
  'settings',
  'models',
  'types',
  'interfaces',
  'schemas',
  'routes',
  'routing',
  'router',
  'middleware',
  'handlers',
  'controllers',
];

/**
 * Extract scope hints from a query
 */
export function extractScope(query: string): ExtractedScope | null {
  // Try to find file path first (highest confidence)
  const fileMatches = [...query.matchAll(FILE_PATH_PATTERN)];
  if (fileMatches.length > 0) {
    const match = fileMatches[0];
    return {
      scope: {
        type: 'file',
        path: match[1],
      },
      confidence: 'high',
      matchedText: match[0],
    };
  }

  // Try module pattern
  const moduleMatches = [...query.matchAll(MODULE_PATTERN)];
  if (moduleMatches.length > 0) {
    const match = moduleMatches[0];
    const moduleName = match[1].toLowerCase();
    return {
      scope: {
        type: 'module',
        path: moduleName,
      },
      confidence: 'medium',
      matchedText: match[0],
    };
  }

  // Try area pattern
  const areaMatches = [...query.matchAll(AREA_PATTERN)];
  if (areaMatches.length > 0) {
    const match = areaMatches[0];
    const areaName = match[1].toLowerCase();
    if (KNOWN_AREAS.includes(areaName)) {
      return {
        scope: {
          type: 'module',
          path: areaName,
        },
        confidence: 'medium',
        matchedText: match[0],
      };
    }
  }

  // Check for known area keywords anywhere in query
  const lowerQuery = query.toLowerCase();
  for (const area of KNOWN_AREAS) {
    if (lowerQuery.includes(area)) {
      return {
        scope: {
          type: 'module',
          path: area,
        },
        confidence: 'low',
        matchedText: area,
      };
    }
  }

  return null;
}

/**
 * Score how well a memory's scope matches an extracted scope
 */
export function scoreScopeMatch(memoryScope: Scope, queryScope: Scope): number {
  // Exact match
  if (memoryScope.type === queryScope.type && memoryScope.path === queryScope.path) {
    return 1.0;
  }

  // File matches within module
  if (queryScope.type === 'module' && memoryScope.type === 'file' && memoryScope.path) {
    if (memoryScope.path.includes(queryScope.path || '')) {
      return 0.8;
    }
  }

  // Module contains file path
  if (queryScope.type === 'file' && memoryScope.type === 'module' && queryScope.path) {
    if (queryScope.path.includes(memoryScope.path || '')) {
      return 0.6;
    }
  }

  // Partial path match
  if (memoryScope.path && queryScope.path) {
    const memoryParts = memoryScope.path.toLowerCase().split('/');
    const queryParts = queryScope.path.toLowerCase().split('/');

    const commonParts = memoryParts.filter((p) => queryParts.includes(p));
    if (commonParts.length > 0) {
      return 0.4 * (commonParts.length / Math.max(memoryParts.length, queryParts.length));
    }
  }

  // Global scope matches everything weakly
  if (memoryScope.type === 'global') {
    return 0.1;
  }

  return 0;
}

/**
 * Check if a memory's code refs match an extracted scope
 */
export function codeRefsMatchScope(codeRefPaths: string[], queryScope: Scope): number {
  if (codeRefPaths.length === 0 || !queryScope.path) {
    return 0;
  }

  let maxScore = 0;

  for (const refPath of codeRefPaths) {
    // Exact file match
    if (queryScope.type === 'file' && refPath === queryScope.path) {
      return 1.0;
    }

    // File in module
    if (queryScope.type === 'module') {
      if (refPath.toLowerCase().includes(queryScope.path.toLowerCase())) {
        maxScore = Math.max(maxScore, 0.8);
      }
    }

    // Partial path match
    const refParts = refPath.toLowerCase().split('/');
    const queryParts = queryScope.path.toLowerCase().split('/');
    const commonParts = refParts.filter((p) => queryParts.includes(p));
    if (commonParts.length > 0) {
      const score = 0.5 * (commonParts.length / Math.max(refParts.length, queryParts.length));
      maxScore = Math.max(maxScore, score);
    }
  }

  return maxScore;
}
