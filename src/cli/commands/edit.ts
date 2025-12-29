/**
 * Edit command - edit a memory object
 */

import type { ArgumentsCamelCase, Argv } from 'yargs';
import { VectorIndex } from '../../indexes/vector.ts';
import { closeConnection, getConnection } from '../../stores/connection.ts';
import { MemoryObjectStore } from '../../stores/memory-objects.ts';
import type { Confidence, Status } from '../../types/memory-objects.ts';
import { error, success } from '../utils.ts';

interface EditArgs {
  id: string;
  content?: string;
  status?: Status;
  confidence?: Confidence;
  json: boolean;
}

export const command = 'edit <id>';
export const describe = 'Edit a memory object';

export function builder(yargs: Argv): Argv<EditArgs> {
  return yargs
    .positional('id', {
      type: 'string',
      demandOption: true,
      describe: 'Object ID to edit',
    })
    .option('content', {
      alias: 'c',
      type: 'string',
      describe: 'New content',
    })
    .option('status', {
      alias: 's',
      type: 'string',
      choices: ['active', 'stale', 'superseded', 'retired'] as Status[],
      describe: 'New status',
    })
    .option('confidence', {
      type: 'string',
      choices: ['certain', 'high', 'medium', 'low'] as Confidence[],
      describe: 'New confidence level',
    })
    .option('json', {
      type: 'boolean',
      default: false,
      describe: 'Output as JSON',
    }) as Argv<EditArgs>;
}

export async function handler(argv: ArgumentsCamelCase<EditArgs>): Promise<void> {
  const db = getConnection();
  const store = new MemoryObjectStore(db);
  const vector = new VectorIndex(db);

  try {
    const obj = store.get(argv.id);
    if (!obj) {
      error(`Object not found: ${argv.id}`);
      process.exit(1);
    }

    const updates: { content?: string; status?: Status; confidence?: Confidence } = {};

    if (argv.content !== undefined) {
      updates.content = argv.content;
    }
    if (argv.status !== undefined) {
      updates.status = argv.status;
    }
    if (argv.confidence !== undefined) {
      updates.confidence = argv.confidence;
    }

    if (Object.keys(updates).length === 0) {
      error('No updates specified');
      process.exit(1);
    }

    const updated = store.update(argv.id, updates);

    if (!updated) {
      error('Failed to update');
      process.exit(1);
    }

    // Re-index if content changed
    if (argv.content) {
      await vector.indexObject(argv.id, argv.content);
    }

    if (argv.json) {
      console.log(JSON.stringify(updated, null, 2));
    } else {
      success(`Updated: ${argv.id}`);
    }
  } finally {
    closeConnection();
  }
}
