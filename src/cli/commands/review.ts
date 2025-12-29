/**
 * Review command - review pending memory objects
 */

import type { ArgumentsCamelCase, Argv } from 'yargs';
import { ReviewQueue } from '../../reviewer/queue.ts';
import { closeConnection, getConnection } from '../../stores/connection.ts';
import { formatMemoryObject } from '../../utils/format.ts';
import { colorize, confirm, getTypeEmoji, info, prompt, success, warn } from '../utils.ts';

interface ReviewArgs {
  batch: number;
  auto: boolean;
  list: boolean;
}

export const command = 'review';
export const describe = 'Review pending memory objects';

export function builder(yargs: Argv): Argv<ReviewArgs> {
  return yargs
    .option('batch', {
      alias: 'b',
      type: 'number',
      default: 5,
      describe: 'Number of items to review',
    })
    .option('auto', {
      type: 'boolean',
      default: false,
      describe: 'Auto-process items with high confidence',
    })
    .option('list', {
      alias: 'l',
      type: 'boolean',
      default: false,
      describe: 'Just list pending items',
    }) as Argv<ReviewArgs>;
}

export async function handler(argv: ArgumentsCamelCase<ReviewArgs>): Promise<void> {
  const db = getConnection();
  const queue = new ReviewQueue(db);

  try {
    if (argv.auto) {
      const result = await queue.autoProcess();
      success(`Auto-processed ${result.processed} items, skipped ${result.skipped}`);
      return;
    }

    const pending = await queue.getPending(argv.batch);

    if (pending.length === 0) {
      info('No pending items to review.');
      return;
    }

    console.log(colorize(`Found ${pending.length} pending item(s):\n`, 'dim'));

    if (argv.list) {
      for (const item of pending) {
        console.log(formatMemoryObject(item.object));
        console.log(colorize(`   Suggested: ${item.suggestedAction} - ${item.reason}`, 'dim'));
        console.log();
      }
      return;
    }

    // Interactive review
    for (const item of pending) {
      console.log(`\n${'='.repeat(60)}\n`);
      console.log(formatMemoryObject(item.object, true));

      if (item.similarObjects && item.similarObjects.length > 0) {
        console.log(colorize('\nSimilar objects:', 'yellow'));
        for (const sim of item.similarObjects) {
          console.log(`  ${getTypeEmoji(sim.objectType)} ${sim.content.slice(0, 50)}...`);
        }
      }

      console.log(colorize(`\nSuggested action: ${item.suggestedAction} - ${item.reason}`, 'cyan'));
      console.log();
      console.log('Actions:');
      console.log('  [a]pprove  - Accept as is');
      console.log('  [e]dit     - Edit content');
      console.log('  [m]erge    - Merge with similar');
      console.log('  [s]upersede - Mark another as superseded');
      console.log('  [r]eject   - Reject and retire');
      console.log('  [k]ip      - Skip for now');
      console.log('  [q]uit     - Exit review');

      const action = await prompt('\nAction: ');

      switch (action.toLowerCase()) {
        case 'a':
        case 'approve':
          await queue.processReview(item.object.id, 'approve');
          success('Approved');
          break;

        case 'e':
        case 'edit': {
          const newContent = await prompt('New content: ');
          if (newContent) {
            await queue.processReview(item.object.id, 'edit', { newContent });
            success('Edited and approved');
          } else {
            warn('No content provided, skipping');
          }
          break;
        }

        case 'm':
        case 'merge': {
          if (item.similarObjects && item.similarObjects.length > 0) {
            console.log('\nSelect objects to merge:');
            item.similarObjects.forEach((obj, i) => {
              console.log(`  ${i + 1}. ${obj.content.slice(0, 60)}...`);
            });
            const selection = await prompt('Enter numbers (comma-separated): ');
            const indices = selection
              .split(',')
              .map((s) => Number.parseInt(s.trim(), 10) - 1)
              .filter((i) => i >= 0 && i < item.similarObjects!.length);

            if (indices.length > 0) {
              const mergeWith = indices.map((i) => item.similarObjects![i].id);
              const merged = await queue.processReview(item.object.id, 'merge', { mergeWith });
              if (merged) {
                success(`Merged ${mergeWith.length + 1} objects`);
              } else {
                warn('Merge failed');
              }
            } else {
              warn('No valid selection');
            }
          } else {
            warn('No similar objects to merge with');
          }
          break;
        }

        case 's':
        case 'supersede': {
          if (item.similarObjects && item.similarObjects.length > 0) {
            console.log('\nSelect object to supersede:');
            item.similarObjects.forEach((obj, i) => {
              console.log(`  ${i + 1}. ${obj.content.slice(0, 60)}...`);
            });
            const selection = await prompt('Enter number: ');
            const index = Number.parseInt(selection.trim(), 10) - 1;

            if (index >= 0 && index < item.similarObjects.length) {
              const supersedeId = item.similarObjects[index].id;
              await queue.processReview(item.object.id, 'supersede', { supersedeId });
              success('Superseded');
            } else {
              warn('Invalid selection');
            }
          } else {
            warn('No similar objects to supersede');
          }
          break;
        }

        case 'r':
        case 'reject': {
          const confirmed = await confirm('Are you sure you want to reject?');
          if (confirmed) {
            await queue.processReview(item.object.id, 'reject');
            success('Rejected');
          }
          break;
        }

        case 'k':
        case 'skip':
          info('Skipped');
          break;

        case 'q':
        case 'quit':
          info('Exiting review');
          return;

        default:
          warn('Unknown action, skipping');
      }
    }

    const remaining = queue.getPendingCount();
    if (remaining > 0) {
      info(`\n${remaining} items still pending`);
    } else {
      success('\nAll items reviewed!');
    }
  } finally {
    closeConnection();
  }
}
