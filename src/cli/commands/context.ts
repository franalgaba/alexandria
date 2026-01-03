/**
 * Context command - check Claude Code context window usage
 *
 * Parses the transcript JSONL to calculate current token usage
 * and recommend checkpoint + clear when exceeding threshold.
 */

import type { ArgumentsCamelCase, Argv } from 'yargs';
import {
  calculateContextUsage,
  formatContextUsage,
  type ContextUsage,
} from '../../utils/context-monitor.ts';
import { colorize } from '../utils.ts';

interface ContextArgs {
  transcript: string;
  json: boolean;
  threshold?: number;
}

export const command = 'context';
export const describe = 'Check Claude Code context window usage from transcript';

export function builder(yargs: Argv): Argv<ContextArgs> {
  return yargs
    .option('transcript', {
      alias: 't',
      type: 'string',
      describe: 'Path to Claude Code transcript JSONL file',
      demandOption: true,
    })
    .option('json', {
      type: 'boolean',
      default: false,
      describe: 'Output as JSON',
    })
    .option('threshold', {
      type: 'number',
      describe: 'Override threshold percentage (default: 50)',
    }) as Argv<ContextArgs>;
}

export async function handler(argv: ArgumentsCamelCase<ContextArgs>): Promise<void> {
  const usage = calculateContextUsage(argv.transcript);

  if (!usage) {
    if (argv.json) {
      console.log(JSON.stringify({ error: 'Could not read transcript', path: argv.transcript }));
    } else {
      console.error(colorize(`Could not read transcript: ${argv.transcript}`, 'red'));
    }
    process.exit(1);
  }

  // Apply custom threshold if provided
  if (argv.threshold !== undefined) {
    usage.threshold = argv.threshold;
    usage.exceedsThreshold = usage.percentage >= argv.threshold;
    usage.recommendation = usage.exceedsThreshold ? 'checkpoint_and_clear' : 'continue';
  }

  if (argv.json) {
    console.log(JSON.stringify(usage, null, 2));
  } else {
    console.log(colorize('Context Window Usage', 'bold'));
    console.log();
    console.log(formatContextUsage(usage));
  }

  // Exit with code 1 if threshold exceeded (useful for scripts)
  if (usage.exceedsThreshold) {
    process.exit(1);
  }
}
