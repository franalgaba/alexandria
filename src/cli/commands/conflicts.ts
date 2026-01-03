/**
 * CLI command for reviewing and resolving memory conflicts
 *
 * Human-in-the-loop resolution for Tier 2 escalation
 */

import * as readline from 'node:readline';
import type { ArgumentsCamelCase } from 'yargs';
import {
  type Conflict,
  ConflictDetector,
  type ResolutionOption,
} from '../../ingestor/conflict-detector.ts';
import { getConnection } from '../../stores/connection.ts';

interface ConflictsArgs {
  list?: boolean;
  resolve?: string;
  autoResolve?: boolean;
  interactive?: boolean;
}

export const command = 'conflicts';
export const describe = 'Review and resolve memory conflicts';

export const builder = {
  list: {
    alias: 'l',
    type: 'boolean' as const,
    describe: 'List all pending conflicts',
  },
  resolve: {
    alias: 'r',
    type: 'string' as const,
    describe: 'Resolve a specific conflict by ID',
  },
  'auto-resolve': {
    alias: 'a',
    type: 'boolean' as const,
    describe: 'Auto-resolve low-severity conflicts',
  },
  interactive: {
    alias: 'i',
    type: 'boolean' as const,
    describe: 'Interactive conflict resolution',
    default: false,
  },
};

export async function handler(argv: ArgumentsCamelCase<ConflictsArgs>): Promise<void> {
  const db = getConnection();
  const detector = new ConflictDetector(db);
  const conflicts = detector.getPendingConflicts();

  // Auto-resolve
  if (argv.autoResolve) {
    const resolved = detector.autoResolve();
    console.log(`✅ Auto-resolved ${resolved} conflict(s)`);
    return;
  }

  // List conflicts
  if (argv.list || (!argv.resolve && !argv.interactive)) {
    if (conflicts.length === 0) {
      console.log('✅ No pending conflicts');
      return;
    }

    console.log(`\n📋 ${conflicts.length} pending conflict(s):\n`);

    for (const conflict of conflicts) {
      printConflict(conflict);
      console.log('');
    }

    console.log(`\nResolve with: alex conflicts --resolve <id>`);
    console.log(`Or interactive: alex conflicts --interactive`);
    return;
  }

  // Resolve specific conflict
  if (argv.resolve) {
    const conflict = conflicts.find((c) => c.id === argv.resolve || c.id.startsWith(argv.resolve!));
    if (!conflict) {
      console.error(`Conflict not found: ${argv.resolve}`);
      process.exit(1);
    }

    await resolveInteractive(detector, conflict);
    return;
  }

  // Interactive mode
  if (argv.interactive) {
    if (conflicts.length === 0) {
      console.log('✅ No pending conflicts');
      return;
    }

    for (const conflict of conflicts) {
      const shouldContinue = await resolveInteractive(detector, conflict);
      if (!shouldContinue) break;
    }
  }
}

function printConflict(conflict: Conflict): void {
  const severityEmoji = {
    high: '🔴',
    medium: '🟡',
    low: '🟢',
  }[conflict.severity];

  const typeEmoji = {
    contradiction: '⚔️',
    duplicate: '📋',
    supersession: '🔄',
    ambiguity: '❓',
  }[conflict.type];

  console.log(`${severityEmoji} ${typeEmoji} [${conflict.id.slice(0, 16)}...]`);
  console.log(`   Type: ${conflict.type} (${conflict.severity})`);
  console.log(`   ${conflict.description}`);
  console.log(`   `);
  console.log(`   New candidate:`);
  console.log(`   └─ ${conflict.newCandidate.content.slice(0, 100)}...`);
  console.log(`   `);
  console.log(`   Existing memory(s):`);
  for (const existing of conflict.existingMemories) {
    console.log(`   └─ [${existing.id.slice(0, 8)}] ${existing.content.slice(0, 80)}...`);
  }
  console.log(`   `);
  console.log(`   Suggested: ${conflict.suggestedResolution}`);
}

async function resolveInteractive(
  detector: ConflictDetector,
  conflict: Conflict,
): Promise<boolean> {
  console.log('\n' + '='.repeat(60));
  printConflict(conflict);
  console.log('='.repeat(60));

  const options: { key: string; option: ResolutionOption; desc: string }[] = [
    { key: '1', option: 'keep_existing', desc: 'Keep existing, discard new' },
    { key: '2', option: 'replace', desc: 'Replace existing with new' },
    { key: '3', option: 'merge', desc: 'Merge into single memory' },
    { key: '4', option: 'keep_both', desc: 'Keep both (different contexts)' },
    { key: '5', option: 'reject_both', desc: 'Reject both (both wrong)' },
    { key: 's', option: 'keep_existing', desc: 'Skip (decide later)' },
    { key: 'q', option: 'keep_existing', desc: 'Quit' },
  ];

  console.log('\nOptions:');
  for (const opt of options) {
    const marker = opt.option === conflict.suggestedResolution ? ' ← suggested' : '';
    console.log(`  [${opt.key}] ${opt.desc}${marker}`);
  }

  const answer = await prompt('\nChoice: ');

  if (answer === 'q') {
    console.log('Exiting...');
    return false;
  }

  if (answer === 's') {
    console.log('Skipped');
    return true;
  }

  const selected = options.find((o) => o.key === answer);
  if (!selected) {
    console.log('Invalid choice, skipping...');
    return true;
  }

  const reason = await prompt('Reason (optional): ');

  const result = detector.resolveConflict(conflict.id, {
    option: selected.option,
    resolvedBy: 'human',
    reason: reason || undefined,
  });

  if (result) {
    console.log(`✅ Resolved: ${selected.option}`);
    if (selected.option !== 'keep_existing' && selected.option !== 'reject_both') {
      console.log(`   Created/updated memory: ${result.id.slice(0, 16)}...`);
    }
  } else {
    console.log(`✅ Resolved: ${selected.option}`);
  }

  return true;
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
