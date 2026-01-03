/**
 * Add-decision command - add a decision with structured data
 */

import type { ArgumentsCamelCase, Argv } from 'yargs';
import { closeConnection, getConnection } from '../../stores/connection.ts';
import { MemoryObjectStore } from '../../stores/memory-objects.ts';
import type { DecisionStructured } from '../../types/structured.ts';
import { formatMemoryObject } from '../../utils/format.ts';
import { colorize, success } from '../utils.ts';

interface AddDecisionArgs {
  decision: string;
  alternatives?: string;
  rationale?: string;
  tradeoffs?: string;
  decidedBy?: string;
  approve: boolean;
}

export const command = 'add-decision <decision>';
export const describe = 'Add a decision with structured data';

export function builder(yargs: Argv): Argv<AddDecisionArgs> {
  return yargs
    .positional('decision', {
      type: 'string',
      describe: 'The decision that was made',
      demandOption: true,
    })
    .option('alternatives', {
      alias: 'a',
      type: 'string',
      describe: 'Alternatives considered (comma-separated)',
    })
    .option('rationale', {
      alias: 'r',
      type: 'string',
      describe: 'Why this choice was made',
    })
    .option('tradeoffs', {
      alias: 't',
      type: 'string',
      describe: 'Known tradeoffs (comma-separated)',
    })
    .option('decided-by', {
      alias: 'd',
      type: 'string',
      choices: ['team', 'user', 'inferred'],
      describe: 'Who made the decision',
    })
    .option('approve', {
      type: 'boolean',
      default: false,
      describe: 'Auto-approve this decision',
    }) as Argv<AddDecisionArgs>;
}

export async function handler(argv: ArgumentsCamelCase<AddDecisionArgs>): Promise<void> {
  const db = getConnection();
  const store = new MemoryObjectStore(db);

  try {
    // Build structured data
    const structured: DecisionStructured = {
      decision: argv.decision,
    };

    if (argv.alternatives) {
      structured.alternatives = argv.alternatives.split(',').map((s) => s.trim());
    }
    if (argv.rationale) {
      structured.rationale = argv.rationale;
    }
    if (argv.tradeoffs) {
      structured.tradeoffs = argv.tradeoffs.split(',').map((s) => s.trim());
    }
    if (argv.decidedBy) {
      structured.decidedBy = argv.decidedBy as 'team' | 'user' | 'inferred';
    }

    // Build content from structured data
    let content = `Decision: ${argv.decision}`;
    if (structured.rationale) {
      content += ` (${structured.rationale})`;
    }

    const obj = store.create({
      content,
      objectType: 'decision',
      reviewStatus: argv.approve ? 'approved' : 'pending',
      structured,
    });

    success(`Added decision: ${obj.id}`);
    console.log(formatMemoryObject(obj));

    // Show structured data
    console.log(colorize('\nStructured Data:', 'dim'));
    console.log(colorize(`  Decision: ${structured.decision}`, 'cyan'));
    if (structured.alternatives) {
      console.log(colorize(`  Alternatives: ${structured.alternatives.join(', ')}`, 'dim'));
    }
    if (structured.rationale) {
      console.log(colorize(`  Rationale: ${structured.rationale}`, 'dim'));
    }
    if (structured.tradeoffs) {
      console.log(colorize(`  Tradeoffs: ${structured.tradeoffs.join(', ')}`, 'dim'));
    }
  } finally {
    closeConnection();
  }
}
