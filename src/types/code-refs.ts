/**
 * Code reference types for linking memories to actual code
 */

export type CodeRefType = 'file' | 'symbol' | 'line_range';

export interface CodeReference {
  /** Type of reference */
  type: CodeRefType;
  
  /** File path relative to project root */
  path: string;
  
  /** Symbol name (function, class, variable) - for symbol type */
  symbol?: string;
  
  /** Line range [start, end] - for line_range type */
  lineRange?: [number, number];
  
  /** Git commit hash when this reference was last verified */
  verifiedAtCommit?: string;
  
  /** 
   * Hash of the file/snippet content (fallback for non-git repos)
   * @deprecated Prefer verifiedAtCommit for git repos
   */
  contentHash?: string;
}

export interface CodeRefInput {
  path: string;
  symbol?: string;
  lineRange?: [number, number];
}

/**
 * Create a file reference
 */
export function fileRef(path: string, verifiedAtCommit?: string, contentHash?: string): CodeReference {
  return {
    type: 'file',
    path,
    verifiedAtCommit,
    contentHash,
  };
}

/**
 * Create a symbol reference
 */
export function symbolRef(path: string, symbol: string, verifiedAtCommit?: string): CodeReference {
  return {
    type: 'symbol',
    path,
    symbol,
    verifiedAtCommit,
  };
}

/**
 * Create a line range reference
 */
export function lineRangeRef(
  path: string,
  startLine: number,
  endLine: number,
  verifiedAtCommit?: string,
  contentHash?: string
): CodeReference {
  return {
    type: 'line_range',
    path,
    lineRange: [startLine, endLine],
    verifiedAtCommit,
    contentHash,
  };
}
