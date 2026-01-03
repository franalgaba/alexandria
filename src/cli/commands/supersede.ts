/**
 * Supersede command - mark an object as superseded
 */

import type { ArgumentsCamelCase, Argv } from 'yargs';
import { closeConnection, getConnection } from '../../stores/connection.ts';
import { MemoryObjectStore } from '../../stores/memory-objects.ts';
import { error, success } from '../utils.ts';

interface SupersedeArgs {
  oldId: string;
  newId: string;
}

export const command = 'supersede <old-id> <new-id>';
export const describe = 'Mark an object as superseded by another';

export function builder(yargs: Argv) {
  return yargs
    .positional('oldId', {
      type: 'string',
      demandOption: true,
      describe: 'ID of object to supersede',
    })
    .positional('newId', {
      type: 'string',
      demandOption: true,
      describe: 'ID of replacement object',
    });
}

export async function handler(argv: ArgumentsCamelCase<SupersedeArgs>): Promise<void> {
  const db = getConnection();
  const store = new MemoryObjectStore(db);

  try {
    // Verify both objects exist
    const oldObj = store.get(argv.oldId);
    if (!oldObj) {
      error(`Object not found: ${argv.oldId}`);
      process.exit(1);
    }

    const newObj = store.get(argv.newId);
    if (!newObj) {
      error(`Object not found: ${argv.newId}`);
      process.exit(1);
    }

    if (oldObj.status === 'superseded') {
      error(`Object ${argv.oldId} is already superseded`);
      process.exit(1);
    }

    if (store.supersede(argv.oldId, argv.newId)) {
      success(`Superseded ${argv.oldId} with ${argv.newId}`);
    } else {
      error('Failed to supersede');
      process.exit(1);
    }
  } finally {
    closeConnection();
  }
}
