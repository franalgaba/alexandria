/**
 * Check command - detect stale memories
 */

import type { ArgumentsCamelCase, Argv } from 'yargs';
import { StalenessChecker } from '../../reviewer/staleness.ts';
import { getConnection } from '../../stores/connection.ts';
import { colorize } from '../utils.ts';

interface CheckArgs {
  json: boolean;
  autoVerifyUnchanged: boolean;
  includeUncommitted: boolean;
}

export const command = 'check';
export const describe = 'Check memories for staleness (code changes)';

export function builder(yargs: Argv): Argv<CheckArgs> {
  return yargs.option('json', {
    type: 'boolean',
    default: false,
    describe: 'Output as JSON',
  })
    .option('auto-verify-unchanged', {
      type: 'boolean',
      default: false,
      describe: 'Auto-verify memories whose files have not changed since last commit',
    })
    .option('include-uncommitted', {
      type: 'boolean',
      default: false,
      describe: 'Include uncommitted file changes in staleness checks',
    }) as Argv<CheckArgs>;
}

export async function handler(argv: ArgumentsCamelCase<CheckArgs>): Promise<void> {
  const db = getConnection();
  const checker = new StalenessChecker(db);

  let autoVerified = 0;
  if (argv.autoVerifyUnchanged) {
    autoVerified = checker.autoVerifyUnchanged();
  }

  const summary = checker.getSummary({ includeUncommitted: argv.includeUncommitted });

  if (argv.json) {
    // Filter to only stale/needs-review items for the hook
    const staleItems = summary.results
      .filter((r) => r.level === 'stale' || r.level === 'needs_review')
      .map((r) => ({
        id: r.memoryId,
        content: r.memory.content,
        type: r.memory.objectType,
        level: r.level,
        reasons: r.reasons,
        changedRefs: r.changedRefs,
        missingRefs: r.missingRefs,
      }));

    console.log(
      JSON.stringify(
        {
          total: summary.total,
          verified: summary.verified,
          needsReview: summary.needsReview,
          staleCount: summary.stale,
          autoVerified,
          stale: staleItems, // For the Claude Code hook
        },
        null,
        2,
      ),
    );
    return;
  }

  if (summary.total === 0) {
    console.log(colorize('No memories with code references found.', 'dim'));
    console.log('Add code refs with: alex link <id> --file <path>');
    return;
  }

  if (autoVerified > 0) {
    console.log(colorize(`✓ Auto-verified ${autoVerified} memory(s)`, 'green'));
  }

  const problemCount = summary.needsReview + summary.stale;

  if (problemCount === 0) {
    console.log(colorize('✓ All memories are up to date!', 'green'));
    console.log(`Checked ${summary.total} memories with code references.`);
    return;
  }

  if (summary.needsReview > 0) {
    console.log(
      colorize(
        `⚠️  ${summary.needsReview} memory(s) need review (files changed since verification):`,
        'yellow',
      ),
    );
  }
  if (summary.stale > 0) {
    console.log(colorize(`❌ ${summary.stale} memory(s) are stale (files deleted):`, 'red'));
  }
  console.log();

  for (const result of summary.results) {
    const typeEmoji =
      {
        decision: '🎯',
        constraint: '🚫',
        convention: '📏',
        known_fix: '✅',
        failed_attempt: '❌',
        preference: '⭐',
        environment: '⚙️',
      }[result.memory.objectType] || '📝';

    console.log(
      `  ${typeEmoji} [${result.memory.objectType}] ${result.memory.content.slice(0, 60)}...`,
    );
    console.log(`     ID: ${result.memoryId}`);

    for (const reason of result.reasons) {
      console.log(colorize(`     ⚠️  ${reason}`, 'yellow'));
    }

    console.log();
  }

  console.log('Actions:');
  console.log('  alex verify <id>   - Mark as still valid');
  console.log('  alex edit <id>     - Update the memory');
  console.log('  alex retire <id>   - Mark as no longer applies');
}
