/**
 * Heatmap command - show most frequently accessed memories
 */

import type { ArgumentsCamelCase, Argv } from 'yargs';
import { createAccessHeatmap } from '../../retriever/heatmap.ts';
import { closeConnection, getConnection } from '../../stores/connection.ts';
import { colorize } from '../utils.ts';

interface HeatmapArgs {
  limit: number;
  json: boolean;
  minAccess: number;
  types?: string[];
}

export const command = 'heatmap';
export const describe = 'Show most frequently accessed memories (access heatmap)';

export function builder(yargs: Argv): Argv<HeatmapArgs> {
  return yargs
    .option('limit', {
      alias: 'n',
      type: 'number',
      default: 10,
      describe: 'Number of memories to show',
    })
    .option('json', {
      type: 'boolean',
      default: false,
      describe: 'Output as JSON',
    })
    .option('minAccess', {
      alias: 'm',
      type: 'number',
      default: 1,
      describe: 'Minimum access count to include',
    })
    .option('types', {
      alias: 't',
      type: 'array',
      describe: 'Filter by memory types (e.g., decision, constraint)',
    }) as Argv<HeatmapArgs>;
}

export async function handler(argv: ArgumentsCamelCase<HeatmapArgs>): Promise<void> {
  const db = getConnection();
  const heatmap = createAccessHeatmap(db);

  try {
    const entries = heatmap.getHotMemories({
      limit: argv.limit,
      minAccessCount: argv.minAccess,
      types: argv.types as string[] | undefined,
    });

    if (argv.json) {
      console.log(JSON.stringify(entries, null, 2));
      return;
    }

    if (entries.length === 0) {
      console.log(colorize('No frequently accessed memories yet.', 'yellow'));
      console.log();
      console.log('Memories gain access counts when they are:');
      console.log('  • Retrieved via search');
      console.log('  • Included in context packs');
      console.log('  • Used during sessions');
      return;
    }

    console.log(colorize('🔥 ACCESS HEATMAP', 'bold'));
    console.log();

    const maxCount = Math.max(...entries.map((e) => e.accessCount));

    entries.forEach((entry, i) => {
      const flames = getFlameEmoji(entry.accessCount, maxCount);
      const typeEmoji = getTypeEmoji(entry.objectType);
      const codeRef =
        entry.codeRefs.length > 0 ? colorize(` [${entry.codeRefs.slice(0, 2).join(', ')}]`, 'dim') : '';

      // Truncate content for display
      const maxLen = 60;
      const content =
        entry.content.length > maxLen
          ? entry.content.substring(0, maxLen - 3) + '...'
          : entry.content;

      const countStr = colorize(`(${entry.accessCount})`, 'cyan');
      const score = colorize(`heat:${entry.heatScore.toFixed(1)}`, 'dim');

      console.log(`${String(i + 1).padStart(2)}. ${flames} ${countStr} ${typeEmoji} ${content}${codeRef}`);
    });

    console.log();
    console.log(colorize(`Showing top ${entries.length} memories by heat score`, 'dim'));
    console.log(colorize('Heat = access_count × recency_weight', 'dim'));
  } finally {
    closeConnection();
  }
}

function getFlameEmoji(count: number, maxCount: number): string {
  const ratio = count / maxCount;
  if (ratio >= 0.8) return '🔥🔥🔥';
  if (ratio >= 0.5) return '🔥🔥 ';
  if (ratio >= 0.3) return '🔥  ';
  return '   ';
}

function getTypeEmoji(type: string): string {
  const emojis: Record<string, string> = {
    decision: '🎯',
    preference: '⭐',
    convention: '📏',
    known_fix: '✅',
    constraint: '🚫',
    failed_attempt: '❌',
    environment: '⚙️',
  };
  return emojis[type] || '📝';
}
