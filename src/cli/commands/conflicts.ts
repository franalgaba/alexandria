/**
 * Conflicts command - detect contradicting memories
 */

import type { ArgumentsCamelCase, Argv } from 'yargs';
import { MemoryObjectStore } from '../../stores/memory-objects.ts';
import { closeConnection, getConnection } from '../../stores/connection.ts';
import { ContradictionDetector, formatConflict } from '../../utils/conflicts.ts';
import { colorize, info, warn } from '../utils.ts';

interface ConflictsArgs {
  json: boolean;
  type?: string;
}

export const command = 'conflicts';
export const describe = 'Detect contradicting memories';

export function builder(yargs: Argv): Argv<ConflictsArgs> {
  return yargs
    .option('json', {
      type: 'boolean',
      default: false,
      describe: 'Output as JSON',
    })
    .option('type', {
      type: 'string',
      describe: 'Filter by conflict type (direct, implicit, temporal)',
    }) as Argv<ConflictsArgs>;
}

export async function handler(argv: ArgumentsCamelCase<ConflictsArgs>): Promise<void> {
  const db = getConnection();
  const store = new MemoryObjectStore(db);
  const detector = new ContradictionDetector();

  try {
    // Get all active memories
    const memories = store.list({ status: ['active'] });
    
    if (memories.length === 0) {
      info('No active memories to check.');
      return;
    }
    
    // Find conflicts
    let conflicts = detector.findConflicts(memories);
    
    // Filter by type if specified
    if (argv.type) {
      conflicts = conflicts.filter(c => c.type === argv.type);
    }
    
    if (argv.json) {
      console.log(JSON.stringify(conflicts, null, 2));
      return;
    }
    
    if (conflicts.length === 0) {
      console.log(colorize('✓ No conflicts detected', 'green'));
      console.log(colorize(`  Checked ${memories.length} active memories`, 'dim'));
      return;
    }
    
    warn(`Found ${conflicts.length} potential conflict(s):\n`);
    
    for (const conflict of conflicts) {
      console.log(formatConflict(conflict));
      console.log();
    }
    
    // Summary
    console.log(colorize('─'.repeat(60), 'dim'));
    const byType = {
      direct: conflicts.filter(c => c.type === 'direct').length,
      implicit: conflicts.filter(c => c.type === 'implicit').length,
      temporal: conflicts.filter(c => c.type === 'temporal').length,
    };
    console.log(colorize(
      `Summary: ${byType.direct} direct, ${byType.implicit} implicit, ${byType.temporal} temporal`,
      'dim'
    ));
    console.log();
    console.log(colorize('To resolve conflicts:', 'dim'));
    console.log(colorize('  - Use `alex retire <id>` to retire outdated memories', 'dim'));
    console.log(colorize('  - Use `alex supersede <old-id> <new-id>` to link replacements', 'dim'));
    
  } finally {
    closeConnection();
  }
}
