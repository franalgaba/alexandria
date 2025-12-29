/**
 * Add command - add a memory object
 */

import type { ArgumentsCamelCase, Argv } from 'yargs';
import { existsSync } from 'node:fs';
import { ReviewPipeline } from '../../reviewer/index.ts';
import { closeConnection, getConnection } from '../../stores/connection.ts';
import { hashFileContent, hashLineRange } from '../../code/hashing.ts';
import { getCurrentCommit, getGitRoot, getRelativePath } from '../../code/git.ts';
import { fileRef, lineRangeRef, symbolRef, type CodeReference } from '../../types/code-refs.ts';
import type { ScopeType } from '../../types/common.ts';
import type { Confidence, ObjectType } from '../../types/memory-objects.ts';
import { error, getTypeEmoji, success } from '../utils.ts';

interface AddArgs {
  content: string;
  type: ObjectType;
  confidence: Confidence;
  scope: ScopeType;
  scopePath?: string;
  approve: boolean;
  json: boolean;
  file?: string;
  symbol?: string;
  lines?: string;
}

export const command = 'add <content>';
export const describe = 'Add a memory object';

export function builder(yargs: Argv): Argv<AddArgs> {
  return yargs
    .positional('content', {
      type: 'string',
      demandOption: true,
      describe: 'Memory content',
    })
    .option('type', {
      alias: 't',
      type: 'string',
      demandOption: true,
      choices: [
        'decision',
        'preference',
        'convention',
        'known_fix',
        'constraint',
        'failed_attempt',
        'environment',
      ] as ObjectType[],
      describe: 'Memory type',
    })
    .option('confidence', {
      alias: 'c',
      type: 'string',
      default: 'medium' as Confidence,
      choices: ['certain', 'high', 'medium', 'low'] as Confidence[],
      describe: 'Confidence level',
    })
    .option('scope', {
      type: 'string',
      default: 'project' as ScopeType,
      choices: ['global', 'project', 'module', 'file'] as ScopeType[],
      describe: 'Scope type',
    })
    .option('scope-path', {
      type: 'string',
      describe: 'Scope path (for module/file scope)',
    })
    .option('approve', {
      alias: 'a',
      type: 'boolean',
      default: false,
      describe: 'Auto-approve the memory',
    })
    .option('json', {
      type: 'boolean',
      default: false,
      describe: 'Output as JSON',
    })
    .option('file', {
      alias: 'f',
      type: 'string',
      describe: 'Link to a file',
    })
    .option('symbol', {
      alias: 's',
      type: 'string',
      describe: 'Link to a symbol (requires --file)',
    })
    .option('lines', {
      alias: 'l',
      type: 'string',
      describe: 'Link to line range (e.g., "10-25", requires --file)',
    }) as Argv<AddArgs>;
}

export async function handler(argv: ArgumentsCamelCase<AddArgs>): Promise<void> {
  const db = getConnection();
  const pipeline = new ReviewPipeline(db);

  // Build code refs if --file is provided
  let codeRefs: CodeReference[] = [];
  
  if (argv.file) {
    const gitRoot = getGitRoot() ?? process.cwd();
    const fullPath = argv.file.startsWith('/') ? argv.file : `${gitRoot}/${argv.file}`;
    
    if (!existsSync(fullPath)) {
      error(`File not found: ${argv.file}`);
      process.exit(1);
    }
    
    const relativePath = getRelativePath(fullPath) ?? argv.file;
    const commitHash = getCurrentCommit() ?? undefined;
    
    if (argv.lines) {
      const [start, end] = argv.lines.split('-').map(Number);
      if (isNaN(start) || isNaN(end)) {
        error('Invalid line range format. Use "start-end" (e.g., "10-25")');
        process.exit(1);
      }
      // Use commit-based tracking (preferred) with content hash as fallback
      const contentHash = hashLineRange(relativePath, start, end) ?? undefined;
      codeRefs.push(lineRangeRef(relativePath, start, end, commitHash, contentHash));
    } else if (argv.symbol) {
      codeRefs.push(symbolRef(relativePath, argv.symbol, commitHash));
    } else {
      // Use commit-based tracking (preferred) with content hash as fallback
      const contentHash = hashFileContent(relativePath) ?? undefined;
      codeRefs.push(fileRef(relativePath, commitHash, contentHash));
    }
  }

  try {
    const obj = await pipeline.addMemory({
      content: argv.content,
      type: argv.type,
      confidence: argv.confidence,
      scope: {
        type: argv.scope,
        path: argv.scopePath,
      },
      autoApprove: argv.approve,
      codeRefs,
    });

    if (argv.json) {
      console.log(JSON.stringify(obj, null, 2));
    } else {
      const emoji = getTypeEmoji(obj.objectType);
      success(`Added memory: ${obj.id}`);
      console.log(`${emoji} [${obj.objectType}] ${obj.content}`);
      console.log(`   Status: ${argv.approve ? 'approved' : 'pending review'}`);
    }
  } catch (err) {
    error(`Failed to add memory: ${err}`);
    process.exit(1);
  } finally {
    closeConnection();
  }
}
