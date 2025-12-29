/**
 * Verify command - mark a memory as still valid
 */

import type { ArgumentsCamelCase, Argv } from 'yargs';
import { getConnection } from '../../stores/connection.ts';
import { StalenessChecker } from '../../reviewer/staleness.ts';
import { MemoryObjectStore } from '../../stores/memory-objects.ts';
import { colorize } from '../utils.ts';

interface VerifyArgs {
  id: string;
}

export const command = 'verify <id>';
export const describe = 'Mark a memory as verified (still accurate)';

export function builder(yargs: Argv): Argv<VerifyArgs> {
  return yargs
    .positional('id', {
      type: 'string',
      describe: 'Memory ID (or prefix)',
      demandOption: true,
    }) as Argv<VerifyArgs>;
}

export async function handler(argv: ArgumentsCamelCase<VerifyArgs>): Promise<void> {
  const db = getConnection();
  const store = new MemoryObjectStore(db);
  const checker = new StalenessChecker(db);
  
  // Find memory by ID or prefix
  const allMemories = store.list({ status: ['active', 'stale'] });
  const memory = allMemories.find(m => 
    m.id === argv.id || m.id.startsWith(argv.id)
  );
  
  if (!memory) {
    console.error(colorize(`Memory not found: ${argv.id}`, 'red'));
    process.exit(1);
  }
  
  // Mark as verified (this updates verifiedAtCommit to current HEAD)
  const updated = checker.markVerified(memory.id);
  
  if (!updated) {
    console.error(colorize('Failed to verify memory', 'red'));
    process.exit(1);
  }
  
  console.log(colorize(`✓ Verified: ${memory.id}`, 'green'));
  console.log(`  ${memory.content.slice(0, 80)}`);
  
  if (memory.codeRefs.length > 0) {
    console.log('  Code refs updated with current hashes');
  }
}
