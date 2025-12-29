/**
 * Pack command - generate context pack
 */

import type { ArgumentsCamelCase, Argv } from 'yargs';
import { Retriever } from '../../retriever/index.ts';
import { ProgressiveRetriever, type ContextLevel } from '../../retriever/progressive.ts';
import { closeConnection, getConnection } from '../../stores/connection.ts';
import { formatContextPack } from '../../utils/format.ts';
import { suggestContextLevel } from '../../utils/uncertainty.ts';
import { colorize } from '../utils.ts';

interface PackArgs {
  budget: number;
  task?: string;
  format: 'yaml' | 'json' | 'text';
  minimal: boolean;
  level?: ContextLevel;
  auto: boolean;
}

export const command = 'pack';
export const describe = 'Generate context pack for session injection';

export function builder(yargs: Argv): Argv<PackArgs> {
  return yargs
    .option('budget', {
      alias: 'b',
      type: 'number',
      default: 1500,
      describe: 'Token budget',
    })
    .option('task', {
      alias: 't',
      type: 'string',
      describe: 'Task description for relevance ranking',
    })
    .option('format', {
      alias: 'f',
      type: 'string',
      choices: ['yaml', 'json', 'text'] as const,
      default: 'yaml' as const,
      describe: 'Output format',
    })
    .option('minimal', {
      alias: 'm',
      type: 'boolean',
      default: false,
      describe: 'Generate minimal pack (constraints only)',
    })
    .option('level', {
      alias: 'l',
      type: 'string',
      choices: ['minimal', 'task', 'deep'] as const,
      describe: 'Progressive disclosure level',
    })
    .option('auto', {
      type: 'boolean',
      default: false,
      describe: 'Auto-select level based on task query',
    }) as Argv<PackArgs>;
}

export async function handler(argv: ArgumentsCamelCase<PackArgs>): Promise<void> {
  const db = getConnection();
  const retriever = new Retriever(db);

  try {
    // Use progressive retriever if level is specified
    if (argv.level || argv.auto) {
      const progressive = new ProgressiveRetriever(db);
      
      let level: ContextLevel = argv.level || 'task';
      if (argv.auto && argv.task) {
        level = suggestContextLevel(argv.task);
        console.error(colorize(`Auto-selected level: ${level}`, 'cyan'));
      }
      
      const pack = await progressive.getContext(level, { 
        query: argv.task,
        tokenBudget: argv.budget,
      });
      
      const output = formatContextPack(pack, argv.format);
      console.log(output);
      
      // Print summary to stderr if not JSON
      if (argv.format !== 'json') {
        console.error();
        console.error(colorize(`Level: ${level}`, 'dim'));
        console.error(colorize(`Objects: ${pack.totalCount}`, 'dim'));
        if (pack.metadata) {
          console.error(colorize(`Tokens: ~${pack.metadata.tokensUsed}/${pack.metadata.tokenBudget}`, 'dim'));
          const breakdown = pack.metadata.breakdown;
          if (breakdown) {
            console.error(colorize(
              `Breakdown: ${breakdown.grounded} grounded, ${breakdown.observed} observed, ${breakdown.inferred} inferred`,
              'dim'
            ));
          }
        }
      }
      return;
    }
    
    // Legacy pack compilation
    let pack: Awaited<ReturnType<typeof retriever.compilePack>>;

    if (argv.minimal) {
      pack = retriever.compileMinimalPack();
    } else {
      pack = await retriever.compilePack({
        tokenBudget: argv.budget,
        taskDescription: argv.task,
      });
    }

    const output = formatContextPack(pack, argv.format);
    console.log(output);

    // Print summary to stderr if not JSON
    if (argv.format !== 'json') {
      console.error();
      console.error(
        colorize(
          `Pack: ${pack.constraints.length} constraints, ${pack.relevantObjects.length} relevant objects`,
          'dim',
        ),
      );
      console.error(colorize(`Tokens: ${pack.tokenCount}/${pack.tokenBudget}`, 'dim'));
      if (pack.overflowCount > 0) {
        console.error(colorize(`Overflow: ${pack.overflowCount} objects not included`, 'dim'));
      }
    }
  } finally {
    closeConnection();
  }
}
