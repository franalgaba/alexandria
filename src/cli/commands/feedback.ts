/**
 * Feedback command - mark memories as helpful or unhelpful
 */

import type { ArgumentsCamelCase, Argv } from 'yargs';
import { getConnection } from '../../stores/connection.ts';
import { MemoryObjectStore } from '../../stores/memory-objects.ts';
import { OutcomeStore } from '../../stores/outcomes.ts';
import { SessionStore } from '../../stores/sessions.ts';
import { colorize } from '../utils.ts';

interface FeedbackArgs {
  id: string;
  helpful: boolean;
  unhelpful: boolean;
  neutral: boolean;
  reason?: string;
  json: boolean;
}

export const command = 'feedback <id>';
export const describe = 'Mark a memory as helpful or unhelpful';

export function builder(yargs: Argv): Argv<FeedbackArgs> {
  return yargs
    .positional('id', {
      type: 'string',
      describe: 'Memory ID (or prefix)',
      demandOption: true,
    })
    .option('helpful', {
      type: 'boolean',
      default: false,
      describe: 'Mark memory as helpful',
    })
    .option('unhelpful', {
      type: 'boolean',
      default: false,
      describe: 'Mark memory as unhelpful',
    })
    .option('neutral', {
      type: 'boolean',
      default: false,
      describe: 'Mark memory as neutral',
    })
    .option('reason', {
      type: 'string',
      describe: 'Reason for the feedback',
    })
    .option('json', {
      type: 'boolean',
      default: false,
      describe: 'Output as JSON',
    })
    .check((argv) => {
      const outcomeFlags = [argv.helpful, argv.unhelpful, argv.neutral].filter(Boolean);
      if (outcomeFlags.length === 0) {
        throw new Error('Must specify --helpful, --unhelpful, or --neutral');
      }
      if (outcomeFlags.length > 1) {
        throw new Error('Cannot specify multiple outcome flags');
      }
      return true;
    }) as Argv<FeedbackArgs>;
}

export async function handler(argv: ArgumentsCamelCase<FeedbackArgs>): Promise<void> {
  const db = getConnection();
  const memoryStore = new MemoryObjectStore(db);
  const outcomeStore = new OutcomeStore(db);
  const sessionStore = new SessionStore(db);

  // Find memory by ID or prefix
  const allMemories = memoryStore.list({});
  const memory = allMemories.find((m) => m.id === argv.id || m.id.startsWith(argv.id));

  if (!memory) {
    console.error(colorize(`Memory not found: ${argv.id}`, 'red'));
    process.exit(1);
  }

  // Determine outcome
  let outcome: 'helpful' | 'unhelpful' | 'neutral';
  if (argv.helpful) {
    outcome = 'helpful';
  } else if (argv.unhelpful) {
    outcome = 'unhelpful';
  } else {
    outcome = 'neutral';
  }

  // Get current session ID (or use a placeholder)
  const currentSession = sessionStore.getCurrent();
  const sessionId = currentSession?.id ?? 'manual-feedback';

  // Record the outcome
  const outcomeRecord = outcomeStore.record(memory.id, sessionId, outcome, argv.reason);

  // Get updated memory
  const updatedMemory = memoryStore.get(memory.id);
  const stats = outcomeStore.getStats(memory.id);

  if (argv.json) {
    console.log(
      JSON.stringify(
        {
          outcome: outcomeRecord,
          memory: updatedMemory,
          stats,
        },
        null,
        2,
      ),
    );
    return;
  }

  // Format output
  const outcomeEmoji = {
    helpful: '👍',
    unhelpful: '👎',
    neutral: '😐',
  }[outcome];

  const outcomeColor = {
    helpful: 'green',
    unhelpful: 'red',
    neutral: 'yellow',
  }[outcome] as 'green' | 'red' | 'yellow';

  console.log();
  console.log(`${outcomeEmoji} Recorded ${colorize(outcome, outcomeColor)} feedback`);
  console.log();
  console.log(`  Memory: ${memory.id.substring(0, 8)}...`);
  console.log(`  Content: ${memory.content.substring(0, 50)}...`);
  if (argv.reason) {
    console.log(`  Reason: ${argv.reason}`);
  }
  console.log();
  console.log(colorize('  Outcome History:', 'bold'));
  console.log(`    👍 Helpful:   ${stats.helpful}`);
  console.log(`    👎 Unhelpful: ${stats.unhelpful}`);
  console.log(`    😐 Neutral:   ${stats.neutral}`);
  console.log();
  console.log(
    `  New outcome score: ${colorize((updatedMemory?.outcomeScore ?? 0.5).toFixed(2), 'cyan')}`,
  );
  console.log();
}
