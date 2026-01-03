/**
 * List command - list memory objects
 */

import type { ArgumentsCamelCase, Argv } from 'yargs';
import { closeConnection, getConnection } from '../../stores/connection.ts';
import { MemoryObjectStore } from '../../stores/memory-objects.ts';
import type { ObjectType, Status } from '../../types/memory-objects.ts';
import { formatMemoryObject } from '../../utils/format.ts';
import { colorize, info, table } from '../utils.ts';

interface ListArgs {
  type?: ObjectType;
  status: Status[];
  limit: number;
  offset: number;
  verbose: boolean;
  json: boolean;
}

export const command = 'list';
export const describe = 'List memory objects';

export function builder(yargs: Argv): Argv<ListArgs> {
  return yargs
    .option('type', {
      alias: 't',
      type: 'string',
      choices: [
        'decision',
        'preference',
        'convention',
        'known_fix',
        'constraint',
        'failed_attempt',
        'environment',
      ] as ObjectType[],
      describe: 'Filter by type',
    })
    .option('status', {
      alias: 's',
      type: 'array',
      default: ['active'] as Status[],
      describe: 'Filter by status',
    })
    .option('limit', {
      alias: 'n',
      type: 'number',
      default: 20,
      describe: 'Maximum results',
    })
    .option('offset', {
      type: 'number',
      default: 0,
      describe: 'Offset for pagination',
    })
    .option('verbose', {
      alias: 'v',
      type: 'boolean',
      default: false,
      describe: 'Show detailed information',
    })
    .option('json', {
      type: 'boolean',
      default: false,
      describe: 'Output as JSON',
    }) as Argv<ListArgs>;
}

export async function handler(argv: ArgumentsCamelCase<ListArgs>): Promise<void> {
  const db = getConnection();
  const store = new MemoryObjectStore(db);

  try {
    const objects = store.list({
      objectType: argv.type,
      status: argv.status as Status[],
      limit: argv.limit,
      offset: argv.offset,
    });

    if (argv.json) {
      console.log(JSON.stringify(objects, null, 2));
      return;
    }

    if (objects.length === 0) {
      info('No memory objects found.');
      return;
    }

    console.log(colorize(`Found ${objects.length} object(s):\n`, 'dim'));

    if (argv.verbose) {
      for (const obj of objects) {
        console.log(formatMemoryObject(obj, true));
        console.log();
      }
    } else {
      // Simple table view with confidence tier
      const headers = ['ID', 'Type', 'Content', 'Tier', 'Refs'];
      const rows = objects.map((obj) => {
        const tierEmoji =
          {
            grounded: '✅',
            observed: '👁️',
            inferred: '🤖',
            hypothesis: '💭',
          }[obj.confidenceTier] || '?';

        return [
          obj.id.slice(0, 12),
          obj.objectType,
          obj.content.slice(0, 45) + (obj.content.length > 45 ? '...' : ''),
          `${tierEmoji} ${obj.confidenceTier}`,
          obj.codeRefs.length > 0 ? `${obj.codeRefs.length} file(s)` : '-',
        ];
      });
      console.log(table(headers, rows));
    }
  } finally {
    closeConnection();
  }
}
