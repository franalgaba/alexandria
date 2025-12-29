/**
 * Revalidate command - interactive review of stale memories
 * 
 * Shows each stale memory with options:
 * [v] verify - mark as still valid
 * [u] update - edit the content
 * [r] retire - remove from active use
 * [s] skip - review later
 * [q] quit - exit review
 */

import type { ArgumentsCamelCase, Argv } from 'yargs';
import * as readline from 'node:readline';
import { MemoryObjectStore } from '../../stores/memory-objects.ts';
import { closeConnection, getConnection } from '../../stores/connection.ts';
import { StalenessChecker } from '../../reviewer/staleness.ts';
import { generatePrompts, type RevalidationPrompt } from '../../utils/revalidation.ts';
import { colorize, success, warn, info } from '../utils.ts';

interface RevalidateArgs {
  all: boolean;
  limit: number;
}

export const command = 'revalidate';
export const describe = 'Interactive review of stale memories';

export function builder(yargs: Argv): Argv<RevalidateArgs> {
  return yargs
    .option('all', {
      alias: 'a',
      type: 'boolean',
      default: false,
      describe: 'Include all memories, not just stale ones',
    })
    .option('limit', {
      alias: 'l',
      type: 'number',
      default: 10,
      describe: 'Maximum number to review',
    }) as Argv<RevalidateArgs>;
}

export async function handler(argv: ArgumentsCamelCase<RevalidateArgs>): Promise<void> {
  const db = getConnection();
  const store = new MemoryObjectStore(db);
  const checker = new StalenessChecker(db);

  try {
    // Get memories to review
    const memories = store.list({ status: ['active'] });
    
    // Check staleness
    const stalenessResults = new Map(
      memories.map(m => [m.id, checker.check(m)])
    );
    
    // Generate prompts for stale ones
    let prompts = generatePrompts(memories, stalenessResults);
    
    if (!argv.all) {
      prompts = prompts.filter(p => p.reasons.length > 0);
    }
    
    if (prompts.length === 0) {
      success('No memories need revalidation!');
      return;
    }
    
    // Limit
    prompts = prompts.slice(0, argv.limit);
    
    console.log();
    console.log(colorize(`Found ${prompts.length} memory(ies) to review`, 'cyan'));
    console.log(colorize('─'.repeat(60), 'dim'));
    console.log();
    
    // Interactive review
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    
    let reviewed = 0;
    let verified = 0;
    let retired = 0;
    let skipped = 0;
    
    for (let i = 0; i < prompts.length; i++) {
      const prompt = prompts[i];
      const memory = prompt.memory;
      
      console.log(colorize(`[${i + 1}/${prompts.length}]`, 'dim'));
      console.log();
      
      // Show memory details
      const typeEmoji = getTypeEmoji(memory.objectType);
      console.log(`${typeEmoji} ${colorize(`[${memory.objectType}]`, 'cyan')} ${memory.content}`);
      console.log();
      
      // Show reasons
      if (prompt.reasons.length > 0) {
        console.log(colorize('⚠️  Reasons:', 'yellow'));
        for (const reason of prompt.reasons) {
          console.log(colorize(`   • ${reason}`, 'yellow'));
        }
        console.log();
      }
      
      // Show code refs
      if (memory.codeRefs.length > 0) {
        console.log(colorize('📄 Code refs:', 'dim'));
        for (const ref of memory.codeRefs) {
          console.log(colorize(`   • ${ref.path}${ref.symbol ? `:${ref.symbol}` : ''}`, 'dim'));
        }
        console.log();
      }
      
      // Show suggested action
      const actionEmoji = {
        verify: '🔍',
        update: '✏️',
        retire: '🗑️',
      }[prompt.suggestedAction];
      console.log(`${actionEmoji} Suggested: ${colorize(prompt.suggestedAction, 'cyan')}`);
      console.log();
      
      // Show options
      console.log(colorize('Options:', 'bold'));
      console.log('  [v] verify  - mark as still valid');
      console.log('  [r] retire  - remove from active use');
      console.log('  [s] skip    - review later');
      console.log('  [q] quit    - exit review');
      console.log();
      
      const answer = await askQuestion(rl, 'Choice: ');
      
      switch (answer.toLowerCase()) {
        case 'v':
        case 'verify':
          store.verify(memory.id);
          success(`Verified: ${memory.id.substring(0, 8)}`);
          verified++;
          reviewed++;
          break;
          
        case 'r':
        case 'retire':
          store.retire(memory.id);
          success(`Retired: ${memory.id.substring(0, 8)}`);
          retired++;
          reviewed++;
          break;
          
        case 's':
        case 'skip':
          info('Skipped');
          skipped++;
          break;
          
        case 'q':
        case 'quit':
          info('Exiting review');
          rl.close();
          showSummary(reviewed, verified, retired, skipped);
          return;
          
        default:
          warn('Unknown option, skipping');
          skipped++;
      }
      
      console.log();
      console.log(colorize('─'.repeat(60), 'dim'));
      console.log();
    }
    
    rl.close();
    showSummary(reviewed, verified, retired, skipped);
    
  } finally {
    closeConnection();
  }
}

function askQuestion(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

function showSummary(reviewed: number, verified: number, retired: number, skipped: number): void {
  console.log();
  console.log(colorize('Summary:', 'bold'));
  console.log(`  ✅ Verified: ${verified}`);
  console.log(`  🗑️  Retired: ${retired}`);
  console.log(`  ⏭️  Skipped: ${skipped}`);
  console.log();
}

function getTypeEmoji(type: string): string {
  return {
    decision: '🎯',
    constraint: '🚫',
    convention: '📏',
    known_fix: '✅',
    failed_attempt: '❌',
    preference: '⭐',
    environment: '⚙️',
  }[type] || '📝';
}
