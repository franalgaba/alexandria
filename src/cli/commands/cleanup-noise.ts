/**
 * Cleanup noise command - retire noisy memories from the database
 */

import type { ArgumentsCamelCase, Argv } from 'yargs';
import { getConnection } from '../../stores/connection.ts';
import { MemoryObjectStore } from '../../stores/memory-objects.ts';
import type { MemoryObject } from '../../types/memory-objects.ts';

interface CleanupNoiseArgs {
  dryRun: boolean;
  pattern?: string;
  type?: string;
  duplicates: boolean;
  supersedeDuplicates: boolean;
  verbose: boolean;
}

// Known noise patterns
const NOISE_PATTERNS = [
  { pattern: /^console\.(log|error|warn|debug)\(/i, reason: 'Raw console statement' },
  { pattern: /^let me (check|look|see|try)/i, reason: 'Stream of consciousness' },
  { pattern: /^now let('s| me)/i, reason: 'Stream of consciousness' },
  { pattern: /^but let me/i, reason: 'Stream of consciousness' },
  { pattern: /^i will try/i, reason: 'Tentative statement' },
  { pattern: /^actually,/i, reason: 'Correction without context' },
  { pattern: /^"(oldText|newText)":/i, reason: 'Raw edit parameters' },
  { pattern: /^│|└|├/i, reason: 'ASCII art/table fragments' },
  { pattern: /^\/\(\?:/i, reason: 'Raw regex pattern' },
];

export const command = 'cleanup-noise';
export const describe = 'Retire noisy memories and supersede duplicates';

export function builder(yargs: Argv) {
  return yargs
    .option('dryRun', {
      alias: 'dry-run',
      type: 'boolean',
      description: 'Preview what would be retired without making changes',
      default: true,
    })
    .option('pattern', {
      type: 'string',
      description: 'Additional regex pattern to match noise',
    })
    .option('type', {
      type: 'string',
      description: 'Only check memories of this type',
    })
    .option('duplicates', {
      type: 'boolean',
      description: 'Also detect duplicate memories',
      default: true,
    })
    .option('supersedeDuplicates', {
      type: 'boolean',
      description: 'Mark duplicate memories as superseded instead of retiring them',
      default: true,
    })
    .option('verbose', {
      type: 'boolean',
      description: 'Show details of each noisy memory',
      default: false,
    });
}

interface NoiseMatch {
  memory: MemoryObject;
  reason: string;
}

function detectNoise(memory: MemoryObject, extraPattern?: RegExp): NoiseMatch | null {
  const content = memory.content;

  // Check built-in patterns
  for (const { pattern, reason } of NOISE_PATTERNS) {
    if (pattern.test(content)) {
      return { memory, reason };
    }
  }

  // Check extra pattern
  if (extraPattern && extraPattern.test(content)) {
    return { memory, reason: 'Custom pattern match' };
  }

  return null;
}

function findDuplicates(memories: MemoryObject[]): Map<string, MemoryObject[]> {
  const groups = new Map<string, MemoryObject[]>();

  for (const memory of memories) {
    // Normalize content for comparison
    const key = memory.content.toLowerCase().trim().slice(0, 200);
    const existing = groups.get(key) || [];
    existing.push(memory);
    groups.set(key, existing);
  }

  // Keep only groups with duplicates
  const duplicates = new Map<string, MemoryObject[]>();
  for (const [key, group] of groups) {
    if (group.length > 1) {
      duplicates.set(key, group);
    }
  }

  return duplicates;
}

export async function handler(args: ArgumentsCamelCase<CleanupNoiseArgs>) {
  const db = getConnection();
  const store = new MemoryObjectStore(db);

  console.log(
    args.dryRun
      ? '🔍 DRY RUN - No changes will be made\n'
      : '⚠️  EXECUTING - Memories will be retired\n',
  );

  // Get all active memories
  let memories = store.list({ status: ['active'] });

  if (args.type) {
    memories = memories.filter((m) => m.objectType === args.type);
  }

  console.log(`Scanning ${memories.length} active memories...\n`);

  // Build extra pattern if provided
  const extraPattern = args.pattern ? new RegExp(args.pattern, 'i') : undefined;

  // Detect noise
  const noiseMatches: NoiseMatch[] = [];
  for (const memory of memories) {
    const match = detectNoise(memory, extraPattern);
    if (match) {
      noiseMatches.push(match);
    }
  }

  // Detect duplicates
  const duplicates = args.duplicates ? findDuplicates(memories) : new Map();

  // Report noise findings
  if (noiseMatches.length > 0) {
    console.log(`📛 Found ${noiseMatches.length} noisy memories:\n`);

    // Group by reason
    const byReason = new Map<string, NoiseMatch[]>();
    for (const match of noiseMatches) {
      const existing = byReason.get(match.reason) || [];
      existing.push(match);
      byReason.set(match.reason, existing);
    }

    for (const [reason, matches] of byReason) {
      console.log(`  ${reason}: ${matches.length}`);
      if (args.verbose) {
        for (const match of matches.slice(0, 3)) {
          console.log(`    - [${match.memory.id}] ${match.memory.content.slice(0, 60)}...`);
        }
        if (matches.length > 3) {
          console.log(`    ... and ${matches.length - 3} more`);
        }
      }
    }
    console.log('');
  }

  // Report duplicate findings
  if (duplicates.size > 0) {
    let totalDuplicates = 0;
    for (const group of duplicates.values()) {
      totalDuplicates += group.length - 1; // Keep one, retire the rest
    }

    console.log(
      `🔁 Found ${duplicates.size} duplicate groups (${totalDuplicates} duplicates to retire):\n`,
    );

    if (args.verbose) {
      for (const [key, group] of Array.from(duplicates).slice(0, 5)) {
        console.log(`  "${key.slice(0, 50)}..." × ${group.length}`);
      }
      if (duplicates.size > 5) {
        console.log(`  ... and ${duplicates.size - 5} more groups`);
      }
      console.log('');
    }
  }

  // Calculate total to retire
  const noiseIds = new Set(noiseMatches.map((m) => m.memory.id));
  const duplicateSupersedes = new Map<string, string>();
  for (const group of duplicates.values()) {
    // Keep the newest, retire the rest
    const sorted = group.sort(
      (a: MemoryObject, b: MemoryObject) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
    const keeper = sorted[0];
    if (!keeper) continue;
    for (const memory of sorted.slice(1)) {
      duplicateSupersedes.set(memory.id, keeper.id);
    }
  }

  const allToUpdate = new Set([...noiseIds, ...duplicateSupersedes.keys()]);

  console.log(`\n📊 Summary:`);
  console.log(`   Noisy memories: ${noiseIds.size}`);
  console.log(`   Duplicate memories: ${duplicateSupersedes.size}`);
  console.log(`   Total to update: ${allToUpdate.size}`);
  console.log(`   Remaining after cleanup: ${memories.length - allToUpdate.size}`);

  if (allToUpdate.size === 0) {
    console.log('\n✅ No noise found. Database is clean!');
    return;
  }

  // Execute cleanup
  if (!args.dryRun) {
    console.log('\n🗑️  Retiring memories...');

    let retired = 0;
    for (const id of allToUpdate) {
      const supersededBy = duplicateSupersedes.get(id);
      const update =
        supersededBy && args.supersedeDuplicates && !noiseIds.has(id)
          ? { status: 'superseded' as const, supersededBy }
          : { status: 'retired' as const };
      try {
        store.update(id, update);
        retired++;
      } catch (error) {
        console.error(`Failed to update ${id}:`, error);
      }
    }

    console.log(`\n✅ Updated ${retired} memories`);
    console.log('   Run "alex stats" to see updated counts');
  } else {
    console.log('\n💡 Run with --no-dry-run to execute cleanup:');
    console.log('   alex cleanup-noise --no-dry-run');
  }
}
