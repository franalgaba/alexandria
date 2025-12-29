/**
 * Stats command - show statistics
 */

import type { ArgumentsCamelCase, Argv } from 'yargs';
import { closeConnection, getConnection } from '../../stores/connection.ts';
import { EventStore } from '../../stores/events.ts';
import { MemoryObjectStore } from '../../stores/memory-objects.ts';
import { SessionStore } from '../../stores/sessions.ts';
import { colorize, table } from '../utils.ts';

interface StatsArgs {
  json: boolean;
}

export const command = 'stats';
export const describe = 'Show database statistics';

export function builder(yargs: Argv): Argv<StatsArgs> {
  return yargs.option('json', {
    type: 'boolean',
    default: false,
    describe: 'Output as JSON',
  }) as Argv<StatsArgs>;
}

export async function handler(argv: ArgumentsCamelCase<StatsArgs>): Promise<void> {
  const db = getConnection();
  const objects = new MemoryObjectStore(db);
  const events = new EventStore(db);
  const sessions = new SessionStore(db);

  try {
    const statusCounts = objects.countByStatus();
    const eventCount = events.count();
    const sessionCount = sessions.count();

    const stats = {
      sessions: sessionCount,
      events: eventCount,
      objects: {
        total:
          statusCounts.active + statusCounts.stale + statusCounts.superseded + statusCounts.retired,
        ...statusCounts,
      },
    };

    if (argv.json) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log(colorize('Alexandria Statistics', 'bold'));
      console.log();

      console.log(colorize('Overview', 'cyan'));
      console.log(`  Sessions: ${stats.sessions}`);
      console.log(`  Events: ${stats.events}`);
      console.log(`  Memory Objects: ${stats.objects.total}`);
      console.log();

      console.log(colorize('Objects by Status', 'cyan'));
      const statusRows = [
        ['Active', String(statusCounts.active)],
        ['Stale', String(statusCounts.stale)],
        ['Superseded', String(statusCounts.superseded)],
        ['Retired', String(statusCounts.retired)],
      ];
      console.log(table(['Status', 'Count'], statusRows));
      console.log();

      // Get type distribution
      const typeDistribution = new Map<string, number>();
      const allObjects = objects.list({ limit: 1000 });
      for (const obj of allObjects) {
        typeDistribution.set(obj.objectType, (typeDistribution.get(obj.objectType) || 0) + 1);
      }

      console.log(colorize('Objects by Type', 'cyan'));
      const typeRows = Array.from(typeDistribution.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => [type, String(count)]);
      console.log(table(['Type', 'Count'], typeRows));
    }
  } finally {
    closeConnection();
  }
}
