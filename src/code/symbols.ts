/**
 * Symbol extraction from source code
 *
 * Uses regex-based extraction for common patterns.
 * Can be enhanced with tree-sitter for more accurate parsing.
 */

import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';

export type SymbolKind =
  | 'function'
  | 'class'
  | 'variable'
  | 'interface'
  | 'type'
  | 'const'
  | 'method'
  | 'property';

export interface Symbol {
  /** Symbol name */
  name: string;
  /** Kind of symbol */
  kind: SymbolKind;
  /** File path */
  path: string;
  /** Line number (1-indexed) */
  line: number;
  /** End line number (1-indexed) */
  endLine?: number;
  /** Export status */
  exported: boolean;
}

export interface SymbolExtractorOptions {
  /** Include private/unexported symbols */
  includePrivate?: boolean;
}

// Regex patterns for TypeScript/JavaScript
const TS_PATTERNS = {
  // export function name() or function name()
  function: /^(\s*)(export\s+)?(async\s+)?function\s+(\w+)/gm,
  // export const name = () => or const name = function
  arrowFunction: /^(\s*)(export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(/gm,
  // export class Name
  class: /^(\s*)(export\s+)?class\s+(\w+)/gm,
  // export interface Name
  interface: /^(\s*)(export\s+)?interface\s+(\w+)/gm,
  // export type Name
  type: /^(\s*)(export\s+)?type\s+(\w+)/gm,
  // export const/let/var name
  variable: /^(\s*)(export\s+)?(const|let|var)\s+(\w+)\s*[=:]/gm,
  // method inside class: name() { or async name()
  method: /^\s+(async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/gm,
};

// Regex patterns for Python
const PY_PATTERNS = {
  // def function_name(
  function: /^(def\s+)(\w+)\s*\(/gm,
  // class ClassName:
  class: /^(class\s+)(\w+)\s*[:(]/gm,
  // CONSTANT = or variable =
  variable: /^([A-Z_][A-Z0-9_]*)\s*=/gm,
};

export class SymbolExtractor {
  private options: Required<SymbolExtractorOptions>;

  constructor(options: SymbolExtractorOptions = {}) {
    this.options = {
      includePrivate: options.includePrivate ?? false,
    };
  }

  /**
   * Extract symbols from a file
   */
  extract(filePath: string): Symbol[] {
    if (!existsSync(filePath)) {
      return [];
    }

    const content = readFileSync(filePath, 'utf-8');
    const ext = extname(filePath).toLowerCase();

    switch (ext) {
      case '.ts':
      case '.tsx':
      case '.js':
      case '.jsx':
      case '.mjs':
      case '.cjs':
        return this.extractTypeScript(filePath, content);
      case '.py':
        return this.extractPython(filePath, content);
      default:
        return [];
    }
  }

  /**
   * Find a specific symbol in a file
   */
  findSymbol(filePath: string, symbolName: string): Symbol | null {
    const symbols = this.extract(filePath);
    return symbols.find((s) => s.name === symbolName) ?? null;
  }

  /**
   * Check if a symbol exists in a file
   */
  hasSymbol(filePath: string, symbolName: string): boolean {
    return this.findSymbol(filePath, symbolName) !== null;
  }

  /**
   * Extract TypeScript/JavaScript symbols
   */
  private extractTypeScript(filePath: string, content: string): Symbol[] {
    const symbols: Symbol[] = [];
    const lines = content.split('\n');

    // Track line numbers for each match
    const getLineNumber = (index: number): number => {
      return content.substring(0, index).split('\n').length;
    };

    // Functions
    let match: RegExpExecArray | null;
    const funcRegex = new RegExp(TS_PATTERNS.function.source, 'gm');
    while ((match = funcRegex.exec(content)) !== null) {
      const exported = !!match[2];
      const name = match[4];
      if (!this.options.includePrivate && name.startsWith('_')) continue;

      symbols.push({
        name,
        kind: 'function',
        path: filePath,
        line: getLineNumber(match.index),
        exported,
      });
    }

    // Arrow functions
    const arrowRegex = new RegExp(TS_PATTERNS.arrowFunction.source, 'gm');
    while ((match = arrowRegex.exec(content)) !== null) {
      const exported = !!match[2];
      const name = match[3];
      if (!this.options.includePrivate && name.startsWith('_')) continue;

      symbols.push({
        name,
        kind: 'function',
        path: filePath,
        line: getLineNumber(match.index),
        exported,
      });
    }

    // Classes
    const classRegex = new RegExp(TS_PATTERNS.class.source, 'gm');
    while ((match = classRegex.exec(content)) !== null) {
      const exported = !!match[2];
      const name = match[3];

      symbols.push({
        name,
        kind: 'class',
        path: filePath,
        line: getLineNumber(match.index),
        exported,
      });
    }

    // Interfaces
    const ifaceRegex = new RegExp(TS_PATTERNS.interface.source, 'gm');
    while ((match = ifaceRegex.exec(content)) !== null) {
      const exported = !!match[2];
      const name = match[3];

      symbols.push({
        name,
        kind: 'interface',
        path: filePath,
        line: getLineNumber(match.index),
        exported,
      });
    }

    // Types
    const typeRegex = new RegExp(TS_PATTERNS.type.source, 'gm');
    while ((match = typeRegex.exec(content)) !== null) {
      const exported = !!match[2];
      const name = match[3];

      symbols.push({
        name,
        kind: 'type',
        path: filePath,
        line: getLineNumber(match.index),
        exported,
      });
    }

    // Variables (const/let/var)
    const varRegex = new RegExp(TS_PATTERNS.variable.source, 'gm');
    while ((match = varRegex.exec(content)) !== null) {
      const exported = !!match[2];
      const kind = match[3]; // const, let, var
      const name = match[4];

      // Skip if it's an arrow function (already captured)
      const lineContent = lines[getLineNumber(match.index) - 1];
      if (lineContent.includes('=>') || lineContent.includes('function')) continue;

      if (!this.options.includePrivate && name.startsWith('_')) continue;

      symbols.push({
        name,
        kind: kind === 'const' ? 'const' : 'variable',
        path: filePath,
        line: getLineNumber(match.index),
        exported,
      });
    }

    return symbols;
  }

  /**
   * Extract Python symbols
   */
  private extractPython(filePath: string, content: string): Symbol[] {
    const symbols: Symbol[] = [];

    const getLineNumber = (index: number): number => {
      return content.substring(0, index).split('\n').length;
    };

    let match: RegExpExecArray | null;

    // Functions
    const funcRegex = new RegExp(PY_PATTERNS.function.source, 'gm');
    while ((match = funcRegex.exec(content)) !== null) {
      const name = match[2];
      if (!this.options.includePrivate && name.startsWith('_')) continue;

      symbols.push({
        name,
        kind: 'function',
        path: filePath,
        line: getLineNumber(match.index),
        exported: !name.startsWith('_'),
      });
    }

    // Classes
    const classRegex = new RegExp(PY_PATTERNS.class.source, 'gm');
    while ((match = classRegex.exec(content)) !== null) {
      const name = match[2];

      symbols.push({
        name,
        kind: 'class',
        path: filePath,
        line: getLineNumber(match.index),
        exported: !name.startsWith('_'),
      });
    }

    // Constants (ALL_CAPS)
    const constRegex = new RegExp(PY_PATTERNS.variable.source, 'gm');
    while ((match = constRegex.exec(content)) !== null) {
      const name = match[1];

      symbols.push({
        name,
        kind: 'const',
        path: filePath,
        line: getLineNumber(match.index),
        exported: true,
      });
    }

    return symbols;
  }
}

/**
 * Format symbol for display
 */
export function formatSymbol(symbol: Symbol): string {
  const exportBadge = symbol.exported ? '📤' : '🔒';
  const kindEmoji = {
    function: '⚡',
    class: '🏛️',
    variable: '📦',
    interface: '📋',
    type: '🏷️',
    const: '🔒',
    method: '🔧',
    property: '📌',
  }[symbol.kind];

  return `${kindEmoji} ${exportBadge} ${symbol.name} (${symbol.kind}) at line ${symbol.line}`;
}

/**
 * List all symbols in a file
 */
export function listSymbols(filePath: string): Symbol[] {
  const extractor = new SymbolExtractor({ includePrivate: true });
  return extractor.extract(filePath);
}
