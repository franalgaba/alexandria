/**
 * Show command - display detailed memory information
 */

import type { ArgumentsCamelCase, Argv } from 'yargs';
import { getConnection } from '../../stores/connection.ts';
import { MemoryObjectStore } from '../../stores/memory-objects.ts';
import { StalenessChecker } from '../../reviewer/staleness.ts';
import { 
  isDecisionStructured, 
  isContractStructured, 
  formatDecision,
  formatContract,
} from '../../types/structured.ts';
import { getConfidenceEmoji, getConfidenceLabel } from '../../utils/confidence.ts';
import { colorize } from '../utils.ts';

interface ShowArgs {
  id: string;
  json: boolean;
}

export const command = 'show <id>';
export const describe = 'Show detailed memory information';

export function builder(yargs: Argv): Argv<ShowArgs> {
  return yargs
    .positional('id', {
      type: 'string',
      describe: 'Memory ID (or prefix)',
      demandOption: true,
    })
    .option('json', {
      type: 'boolean',
      default: false,
      describe: 'Output as JSON',
    }) as Argv<ShowArgs>;
}

export async function handler(argv: ArgumentsCamelCase<ShowArgs>): Promise<void> {
  const db = getConnection();
  const store = new MemoryObjectStore(db);
  const checker = new StalenessChecker(db);
  
  // Find memory by ID or prefix
  const allMemories = store.list({});
  const memory = allMemories.find(m => 
    m.id === argv.id || m.id.startsWith(argv.id)
  );
  
  if (!memory) {
    console.error(colorize(`Memory not found: ${argv.id}`, 'red'));
    process.exit(1);
  }
  
  // Check staleness
  const stalenessResult = checker.check(memory);
  
  if (argv.json) {
    console.log(JSON.stringify({
      ...memory,
      isStale: stalenessResult.isStale,
      stalenessReasons: stalenessResult.reasons,
    }, null, 2));
    return;
  }
  
  // Format output
  const typeEmoji = {
    decision: '🎯',
    constraint: '🚫',
    convention: '📏',
    known_fix: '✅',
    failed_attempt: '❌',
    preference: '⭐',
    environment: '⚙️',
  }[memory.objectType] || '📝';
  
  const statusColor = {
    active: 'green',
    stale: 'yellow',
    superseded: 'dim',
    retired: 'dim',
  }[memory.status] as 'green' | 'yellow' | 'dim';
  
  console.log();
  console.log(`${typeEmoji} ${colorize(`[${memory.objectType}]`, 'cyan')} ${memory.content}`);
  console.log();
  const tierEmoji = getConfidenceEmoji(memory.confidenceTier);
  const tierLabel = getConfidenceLabel(memory.confidenceTier);
  
  console.log(`  ID:         ${memory.id}`);
  console.log(`  Status:     ${colorize(memory.status, statusColor)}`);
  console.log(`  Confidence: ${tierEmoji} ${tierLabel}`);
  console.log(`  Review:     ${memory.reviewStatus}`);
  console.log(`  Created:    ${memory.createdAt.toISOString()}`);
  console.log(`  Updated:    ${memory.updatedAt.toISOString()}`);
  console.log(`  Accessed:   ${memory.accessCount} times`);
  
  if (memory.lastAccessed) {
    console.log(`  Last used:  ${memory.lastAccessed.toISOString()}`);
  }
  
  if (memory.lastVerifiedAt) {
    console.log(`  Verified:   ${memory.lastVerifiedAt.toISOString()}`);
  }
  
  // Code refs
  if (memory.codeRefs.length > 0) {
    console.log();
    console.log(colorize('  Code References:', 'bold'));
    
    for (const ref of memory.codeRefs) {
      let refLine = `    📄 ${ref.path}`;
      
      if (ref.type === 'symbol' && ref.symbol) {
        refLine = `    🔧 ${ref.path}:${ref.symbol}`;
      } else if (ref.type === 'line_range' && ref.lineRange) {
        refLine = `    📍 ${ref.path}:${ref.lineRange[0]}-${ref.lineRange[1]}`;
      }
      
      console.log(refLine);
      
      if (ref.verifiedAtCommit) {
        console.log(`       Verified at: ${ref.verifiedAtCommit.substring(0, 7)}`);
      }
      if (ref.contentHash) {
        console.log(`       Content hash: ${ref.contentHash}`);
      }
    }
  }
  
  // Staleness warning
  if (stalenessResult.isStale) {
    console.log();
    console.log(colorize('  ⚠️  STALE - needs revalidation:', 'yellow'));
    for (const reason of stalenessResult.reasons) {
      console.log(colorize(`     ${reason}`, 'yellow'));
    }
    console.log();
    console.log(`  Run: alex verify ${memory.id.substring(0, 8)}`);
  }
  
  // Evidence
  if (memory.evidenceEventIds.length > 0) {
    console.log();
    console.log(colorize('  Evidence:', 'bold'));
    console.log(`    Event IDs: ${memory.evidenceEventIds.join(', ')}`);
  }
  
  if (memory.evidenceExcerpt) {
    console.log(`    Excerpt: "${memory.evidenceExcerpt.slice(0, 100)}..."`);
  }
  
  // Structured data
  if (memory.structured) {
    console.log();
    console.log(colorize('  Structured Data:', 'bold'));
    
    if (isDecisionStructured(memory.structured)) {
      const lines = formatDecision(memory.structured).split('\n');
      for (const line of lines) {
        console.log(`    ${line}`);
      }
    } else if (isContractStructured(memory.structured)) {
      const lines = formatContract(memory.structured).split('\n');
      for (const line of lines) {
        console.log(`    ${line}`);
      }
    } else {
      console.log(`    ${JSON.stringify(memory.structured, null, 2)}`);
    }
  }
  
  console.log();
}
