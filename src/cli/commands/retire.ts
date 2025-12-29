/**
 * Retire command - mark objects as retired
 */

import type { ArgumentsCamelCase, Argv } from 'yargs';
import { closeConnection, getConnection } from '../../stores/connection.ts';
import { MemoryObjectStore } from '../../stores/memory-objects.ts';
import { error, success } from '../utils.ts';

interface RetireArgs {
  ids: string[];
  stale: boolean;
}

export const command = 'retire <ids...>';
export const describe = 'Mark objects as retired';

export function builder(yargs: Argv): Argv<RetireArgs> {
  return yargs
    .positional('ids', {
      type: 'string',
      array: true,
      demandOption: true,
      describe: 'Object IDs to retire',
    })
    .option('stale', {
      type: 'boolean',
      default: false,
      describe: 'Mark as stale instead of retired',
    }) as Argv<RetireArgs>;
}

export async function handler(argv: ArgumentsCamelCase<RetireArgs>): Promise<void> {
  const db = getConnection();
  const store = new MemoryObjectStore(db);

  try {
    let count = 0;

    for (const id of argv.ids) {
      const obj = store.get(id);
      if (!obj) {
        error(`Object not found: ${id}`);
        continue;
      }

      if (argv.stale) {
        if (store.markStale(id)) {
          count++;
        }
      } else {
        if (store.retire(id)) {
          count++;
        }
      }
    }

    if (count > 0) {
      success(`${argv.stale ? 'Marked stale' : 'Retired'}: ${count} object(s)`);
    } else {
      error('No objects updated');
    }
  } finally {
    closeConnection();
  }
}
