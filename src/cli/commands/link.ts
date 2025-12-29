/**
 * Link command - add code references to a memory
 */

import type { ArgumentsCamelCase, Argv } from 'yargs';
import { existsSync } from 'node:fs';
import { getConnection } from '../../stores/connection.ts';
import { MemoryObjectStore } from '../../stores/memory-objects.ts';
import { hashFileContent, hashLineRange } from '../../code/hashing.ts';
import { getCurrentCommit, getGitRoot, getRelativePath } from '../../code/git.ts';
import { SymbolExtractor } from '../../code/symbols.ts';
import { fileRef, lineRangeRef, symbolRef, type CodeReference } from '../../types/code-refs.ts';
import { colorize, warn } from '../utils.ts';

interface LinkArgs {
  id: string;
  file: string;
  symbol?: string;
  lines?: string;
}

export const command = 'link <id>';
export const describe = 'Add code reference to a memory';

export function builder(yargs: Argv): Argv<LinkArgs> {
  return yargs
    .positional('id', {
      type: 'string',
      describe: 'Memory ID (or prefix)',
      demandOption: true,
    })
    .option('file', {
      alias: 'f',
      type: 'string',
      describe: 'File path to link',
      demandOption: true,
    })
    .option('symbol', {
      alias: 's',
      type: 'string',
      describe: 'Symbol name (function, class, etc.)',
    })
    .option('lines', {
      alias: 'l',
      type: 'string',
      describe: 'Line range (e.g., "10-25")',
    }) as Argv<LinkArgs>;
}

export async function handler(argv: ArgumentsCamelCase<LinkArgs>): Promise<void> {
  const db = getConnection();
  const store = new MemoryObjectStore(db);
  
  // Find memory by ID or prefix
  const allMemories = store.list({});
  const memory = allMemories.find(m => 
    m.id === argv.id || m.id.startsWith(argv.id)
  );
  
  if (!memory) {
    console.error(colorize(`Memory not found: ${argv.id}`, 'red'));
    process.exit(1);
  }
  
  // Resolve file path
  const gitRoot = getGitRoot() ?? process.cwd();
  let filePath = argv.file;
  
  // Check if file exists
  const fullPath = filePath.startsWith('/') ? filePath : `${gitRoot}/${filePath}`;
  if (!existsSync(fullPath)) {
    console.error(colorize(`File not found: ${filePath}`, 'red'));
    process.exit(1);
  }
  
  // Get relative path
  const relativePath = getRelativePath(fullPath) ?? filePath;
  
  // Get current commit and content hash
  const commitHash = getCurrentCommit() ?? undefined;
  let contentHash: string | undefined;
  let ref: CodeReference;
  
  if (argv.lines) {
    // Line range reference
    const [start, end] = argv.lines.split('-').map(Number);
    if (isNaN(start) || isNaN(end)) {
      console.error(colorize('Invalid line range format. Use "start-end" (e.g., "10-25")', 'red'));
      process.exit(1);
    }
    // Commit-based tracking with content hash fallback
    contentHash = hashLineRange(relativePath, start, end) ?? undefined;
    ref = lineRangeRef(relativePath, start, end, commitHash, contentHash);
  } else if (argv.symbol) {
    // Symbol reference - verify it exists
    const extractor = new SymbolExtractor();
    const symbol = extractor.findSymbol(fullPath, argv.symbol);
    
    if (!symbol) {
      warn(`Symbol "${argv.symbol}" not found in ${relativePath}`);
      warn('Linking anyway - symbol may be dynamically defined');
    } else {
      console.log(colorize(`Found symbol at line ${symbol.line}`, 'dim'));
    }
    
    ref = symbolRef(relativePath, argv.symbol, commitHash);
  } else {
    // File reference (commit-based with content hash fallback)
    contentHash = hashFileContent(relativePath) ?? undefined;
    ref = fileRef(relativePath, commitHash, contentHash);
  }
  
  // Add the reference
  const updated = store.addCodeRefs(memory.id, [ref]);
  
  if (!updated) {
    console.error(colorize('Failed to add code reference', 'red'));
    process.exit(1);
  }
  
  console.log(colorize(`✓ Linked code reference to: ${memory.id}`, 'green'));
  console.log(`  Memory: ${memory.content.slice(0, 60)}...`);
  console.log(`  File: ${relativePath}`);
  
  if (argv.symbol) {
    console.log(`  Symbol: ${argv.symbol}`);
  }
  if (argv.lines) {
    console.log(`  Lines: ${argv.lines}`);
  }
  if (contentHash) {
    console.log(`  Hash: ${contentHash}`);
  }
  if (commitHash) {
    console.log(`  Commit: ${commitHash.substring(0, 7)}`);
  }
}
