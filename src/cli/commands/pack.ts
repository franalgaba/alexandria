/**
 * Pack command - generate context pack with micro-review
 */

import type { ArgumentsCamelCase, Argv } from 'yargs';
import { Retriever } from '../../retriever/index.ts';
import { createAccessHeatmap } from '../../retriever/heatmap.ts';
import { type ContextLevel, ProgressiveRetriever } from '../../retriever/progressive.ts';
import { StalenessChecker } from '../../reviewer/staleness.ts';
import { closeConnection, getConnection } from '../../stores/connection.ts';
import { MemoryObjectStore } from '../../stores/memory-objects.ts';
import type { LegacyContextPack } from '../../types/retriever.ts';
import { formatContextPack } from '../../utils/format.ts';
import { suggestContextLevel } from '../../utils/uncertainty.ts';
import { colorize, confirm } from '../utils.ts';

interface PackArgs {
  budget: number;
  task?: string;
  format: 'yaml' | 'json' | 'text';
  minimal: boolean;
  level?: ContextLevel;
  auto: boolean;
  revalidate: boolean;
  hot: boolean;
}

export const command = 'pack';
export const describe = 'Generate context pack for session injection';

export function builder(yargs: Argv): Argv<PackArgs> {
  return yargs
    .option('budget', {
      alias: 'b',
      type: 'number',
      describe: 'Token budget (defaults: minimal=500, task=2000, deep=4000)',
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
    })
    .option('revalidate', {
      alias: 'r',
      type: 'boolean',
      default: false,
      describe: 'Prompt to revalidate stale memories',
    })
    .option('hot', {
      type: 'boolean',
      default: false,
      describe: 'Prioritize frequently accessed memories (heatmap)',
    }) as Argv<PackArgs>;
}

export async function handler(argv: ArgumentsCamelCase<PackArgs>): Promise<void> {
  const db = getConnection();
  const retriever = new Retriever(db);

  try {
    // Check for stale memories and optionally revalidate
    if (argv.revalidate) {
      await handleMicroReview(db);
    }

    // Get hot memory IDs if --hot flag is set
    let hotMemoryIds: string[] = [];
    if (argv.hot) {
      const heatmap = createAccessHeatmap(db);
      hotMemoryIds = heatmap.getHotMemoryIds(10);
      if (hotMemoryIds.length > 0) {
        console.error(colorize(`🔥 Prioritizing ${hotMemoryIds.length} hot memories`, 'cyan'));
      }
    }

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
        priorityIds: hotMemoryIds.length > 0 ? hotMemoryIds : undefined,
      });

      const output = formatContextPack(pack, argv.format);
      console.log(output);

      // Print summary to stderr if not JSON
      if (argv.format !== 'json') {
        console.error();
        console.error(colorize(`Level: ${level}`, 'dim'));
        console.error(colorize(`Objects: ${pack.totalCount}`, 'dim'));
        if (hotMemoryIds.length > 0) {
          console.error(colorize(`Hot memories: ${hotMemoryIds.length}`, 'dim'));
        }
        if (pack.metadata) {
          console.error(
            colorize(`Tokens: ~${pack.metadata.tokensUsed}/${pack.metadata.tokenBudget}`, 'dim'),
          );
          const breakdown = pack.metadata.breakdown;
          if (breakdown) {
            console.error(
              colorize(
                `Breakdown: ${breakdown.grounded} grounded, ${breakdown.observed} observed, ${breakdown.inferred} inferred`,
                'dim',
              ),
            );
          }
        }
      }
      return;
    }

    // Legacy pack compilation
    let pack: LegacyContextPack;

    if (argv.minimal) {
      pack = retriever.compileMinimalPack();
    } else {
      pack = await retriever.compilePack({
        tokenBudget: argv.budget ?? 2000, // Default for legacy mode
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

/**
 * Micro-review: prompt user to revalidate stale memories
 */
async function handleMicroReview(db: any): Promise<void> {
  const checker = new StalenessChecker(db);
  const store = new MemoryObjectStore(db);
  const summary = checker.getSummary();

  if (summary.needsReview === 0 && summary.stale === 0) {
    return;
  }

  console.error(colorize('\n📋 Micro-Review: Stale memories detected\n', 'yellow'));

  const staleResults = summary.results.slice(0, 5); // Limit to 5 at a time

  for (const result of staleResults) {
    const memory = result.memory;
    console.error(colorize(`[${memory.objectType}] ${memory.content.slice(0, 80)}...`, 'white'));
    console.error(colorize(`  Status: ${result.level}`, 'dim'));
    if (result.reasons.length > 0) {
      console.error(colorize(`  Reason: ${result.reasons[0]}`, 'dim'));
    }

    try {
      const stillValid = await confirm('  Still valid?');

      if (stillValid) {
        checker.markVerified(memory.id);
        console.error(colorize('  ✓ Verified\n', 'green'));
      } else {
        checker.markStale(memory.id, 'User marked as stale during micro-review');
        console.error(colorize('  ✗ Marked stale\n', 'red'));
      }
    } catch {
      // Non-interactive mode or user cancelled
      console.error(colorize('  ⊘ Skipped (non-interactive)\n', 'dim'));
    }
  }

  const remaining = summary.results.length - staleResults.length;
  if (remaining > 0) {
    console.error(colorize(`\n${remaining} more memories need review. Run: alex check\n`, 'dim'));
  }
}
